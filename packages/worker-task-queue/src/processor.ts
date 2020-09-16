/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { collectTransferrables, walkReduce, Key } from './util';

// promise status resolvers
const enum Status {
  RESOLVE,
  REJECT
}

// strings less than this length can be inlined into high priority result listings
const SMALL_STRING_MAX = 512;

// for task options bitmask
const RETURN_RESULT = 1;

// sentinel key passed from coordinating thread for Task identification
let SPECIAL: string;

const resolved = Promise.resolve();

export interface Task<T = any> {
  id: number;
  $$taskIdentifier: string;
  $$taskResult?: T;
}

export interface Result<T = any, E = string | Error> extends Promise<T> {
  state?: Status;
  fulfilled?: boolean;
  value?: T;
  error?: E;
}

export interface Processor<T = any> {
  new (): Processor;
  process(...args: any[]): T;
}

export function registerTask(name: string, processor: Processor) {
  tasks[name] = processor;
  descs[name] = Object.assign({}, processor);
}

type OptionsMask = 0 | 1 | 2;
// Holds incoming flat task queue jobs
type TaskDesc = [number, OptionsMask, string, ...any[]];
// Holds outgoing serializable task results
type TaskResultDesc = [number, OptionsMask, Status, any];

const queue: TaskDesc[] = [];

const results: Record<string, Result> = {};

const tasks: Record<string, Processor> = {};

const descs: Record<string, Partial<Processor>> = {};

const instances: Record<string, InstanceType<Processor>> = {};

const cancellations: Record<number, boolean> = {};

const gotResults: TaskResultDesc[] = [];

const api = {
  init(ident: string) {
    SPECIAL = ident;
    return Promise.all(Object.values(tasks)).then(() => descs);
  },
  task(id: string) {
    const data = [].slice.call(arguments);
    if (id in cancellations) {
      console.log('Skipping cancelled task: ' + id);
      return;
    }
    if (queue.push(data) === 1) next();
  },
  getresult(id: number) {
    // @todo: could this set task options and flushResultStatuses()?
    for (let i = gotResults.length; i--; ) {
      if (gotResults[i][0] === id) {
        gotResults.splice(i, 1);
        break;
      }
    }

    if (!(id in results)) throw Error(`Result ${id} not found.`);

    const result = results[id];
    gotResults.push([id, RETURN_RESULT, result.state, result.value]);
    flushResultStatuses();
  },
  cancel(id: number) {
    cancellations[id] = true;
  }
};

addEventListener('message', (e) => {
  let index = -1;
  function next() {
    if (++index === e.data.length) return;
    const item = e.data[index];
    resolved
      .then(() => api[item[0]].apply(null, item.slice(2)))
      .then(
        (ret) => {
          if (ret !== undefined) postMessage([0, item[1], ret]);
          next();
        },
        (err) => {
          postMessage([1, item[1], '' + err]);
        }
      );
  }
  next();
});

function isTaskValue(value) {
  if (typeof value !== 'object' || !value) return false;
  if (!('$$taskIdentifier' in value)) return false;
  const sentinel = SPECIAL + ':';
  return value.$$taskIdentifier === sentinel + value.id;
}

function walkTaskValues<T>(
  obj: T,
  action: (value: any, i?: Key, parent?: object) => void
) {
  walkReduce(obj, (acc, value, i, obj) => {
    if (isTaskValue(value)) {
      action(value, i, obj);
    }
  });
}

function countPendingTasks(task: Task) {
  if ('$$taskResult' in task) return;
  const result = results[task.id];
  if (result == null || !result.fulfilled) pendingTasks++;
}

function replaceTaskIdWithResult<T>(task: Task<T>, property: Key, obj: any) {
  let value: T;
  if ('$$taskResult' in task) {
    value = task.$$taskResult;
  } else {
    const result = results[task.id];
    value = result.error || result.value;
  }
  obj[property] = value;
}

let pendingTasks = 0;
let flushTimer: ReturnType<typeof setTimeout>;

function next() {
  clearTimeout(flushTimer);
  if (queue.length === 0) {
    flushTimer = setTimeout(flushResultStatuses, 50);
    return;
  }

  let taskDesc: TaskDesc;
  for (let i = 0; i < queue.length; i++) {
    pendingTasks = 0;
    walkTaskValues(queue[i], countPendingTasks);
    if (pendingTasks === 0) {
      taskDesc = queue[i];
      queue.splice(i, 1);
      break;
    }
  }

  // queue has tasks, but all are pending
  if (taskDesc == null) {
    console.error(
      `Queue deadlocked: all ${queue.length} tasks have unresolved dependencies.`
    );
    // this is dead time, flush any pending results
    flushResultStatuses();
    return;
  }

  const [id, options, name, ...args] = taskDesc;

  walkTaskValues(args, replaceTaskIdWithResult);

  delete cancellations[id];
  const processor = tasks[name];
  const result: Result = resolved
    .then(() => {
      if (typeof processor !== 'function')
        throw Error(`Unknown task processor "${name}".`);
      const instance = instances[name] || (instances[name] = new processor());
      return instance.process(...args);
    })
    .then(
      (value) => {
        result.state = Status.RESOLVE;
        result.fulfilled = true;
        result.value = value;
        gotResults.push([id, options, Status.RESOLVE, value]);
        next();
      },
      (err) => {
        result.state = Status.REJECT;
        result.fulfilled = true;
        result.error = err;
        gotResults.push([id, options, Status.REJECT, '' + err]);
        next();
      }
    );
  results[id] = result;
}

function isInlineReturn(data) {
  const type = typeof data;
  return (
    data == null ||
    type === 'boolean' ||
    type === 'number' ||
    (type === 'string' && data.length < SMALL_STRING_MAX)
  );
}

function flushResultStatuses() {
  clearTimeout(flushTimer);
  if (gotResults.length === 0) return;

  let statuses = [];
  const returnStatuses = [];
  const transferrables = [];
  let priorityResultCount = 0;
  let resultCount = 0;
  for (let i = 0; i < gotResults.length; i++) {
    if (gotResults[i] == null) continue;
    resultCount++;

    const [id, options, state, data] = gotResults[i];
    let status = [id, state];
    // if requested, we'll return the result along with the status:
    let returnResult = options & RETURN_RESULT;
    // if there are any priority returns in the queue, drop low-priority returns as we switch modes:
    if (returnResult) priorityResultCount++;

    // preemptively pass nearly-free result types to the coordinating thread.
    const transferrablesBefore = transferrables.length;
    if (data) {
      walkReduce(data, collectTransferrables, transferrables);
    }
    const hasTransferrables = transferrables.length > transferrablesBefore;

    if (returnResult || hasTransferrables || isInlineReturn(data)) {
      status.push(data);
      returnStatuses.push(status);
      gotResults[i] = null;
    }
    statuses.push(status);
  }

  if (priorityResultCount !== 0) statuses = returnStatuses;

  // low-priority/normal return clears the entire queue
  if (resultCount === 0 || statuses.length === resultCount) {
    gotResults.length = 0;
  } else {
    flushTimer = setTimeout(flushResultStatuses, 50);
  }

  if (statuses.length !== 0) {
    postMessage(['status', 0, statuses], transferrables);
  }
}
