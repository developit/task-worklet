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

function prop(obj, key, value) {
	Object.defineProperty(obj, key, { value });
}

export default class TaskQueue {
	constructor(options) {
		const size = options && parseInt(options.size, 10) || 1;
		prop(this, '$$pool', new TaskQueuePool({ size }));
	}

	postTask(taskName, ...args) {
		const task = new Task();
		task.id = ++COUNT;
		// Object.defineProperty(this, 'id', {
		// 	enumerable: true,
		// 	configurable: false,
		// 	writable: false,
		// 	value: ++COUNT
		// });
		this.$$pool.exec(task, taskName, args);
		prop(task, '$$queue', this);
		return task;
	}

	addModule(moduleURL, taskWorkletOptions) {
		return fetch(moduleURL).then(r => r.text()).then(code => {
			this.$$pool.addWorklet(code);
		})
	}
}

const workerUrl = URL.createObjectURL(new Blob(['(' + (() => {
	// codepen hack
	const window = {CP:{shouldStopExecution:()=>false,exitedLoop(){}}};

	function realm(code, scope) {
		scope.eval = self.eval;
		scope.self = scope;
		const keys = Object.keys(scope);
		return self.eval(`(function(${keys},scope,code,keys,realm){\n${code}\n})`).apply(scope, keys.map(k=>scope[k]));
	}
	(() => {
		// function walk(obj, action) {
		// 	const sentinel = SPECIAL + ':';
		// 	const len = sentinel.length + 1;
		// 	if (typeof obj==='object' && obj) {
		// 		for (let i in obj) {
		// 			const value = obj[i];
		// 			// if (typeof value==='string' && value.indexOf(sentinel)===0) {
		// 			// 	const taskId = value.substring(len);
		// 			// 	action(obj, i, taskId);
		// 			// }
		// 			if (typeof value==='object' && value && '$$taskIdentifier' in value && value.$$taskIdentifier===sentinel+value.id) {
		// 				action(value, i, obj);
		// 			}
		// 		}
		// 	}
		// }

		function walk(obj, action) {
			const sentinel = SPECIAL + ':';
			const len = sentinel.length + 1;
			walkReduce(obj, (acc, value, i, obj) => {
				if (typeof value==='object' && value && '$$taskIdentifier' in value && value.$$taskIdentifier===sentinel+value.id) {
					action(value, i, obj);
				}
			});
		}

		function walkReduce(obj, reducer, accumulator, index, parent) {
			const f = reducer(accumulator, obj, index, parent);
			if (f!==undefined) accumulator = f;
			if (typeof obj==='object' && obj) {
				for (let i in obj) {
					walkReduce(obj[i], reducer, accumulator, i, obj);
				}
			}
			return accumulator;
		}

		function collectTransferrables(xfer, value) {
			if (
				(value instanceof ArrayBuffer) ||
				(value instanceof MessagePort) ||
				(value instanceof ImageBitmap)
			) {
				xfer.push(value);
			}
		}

		function countPendingTasks(task, property, obj) {
			if ('$$taskResult' in task) return;
			const result = results[task.id];
			if (result==null || !result.fulfilled) pendingTasks++;
		}
		function replaceTaskIdWithResult(task, property, obj) {
			let value;
			if ('$$taskResult' in task) {
				value = task.$$taskResult;
			}
			else {
				const result = results[task.id];
				value = result.error || result.value;
			}
			obj[property] = value;
		}

		// promise status resolvers
		const RESOLVE = 0;
		const REJECT = 1;
		// strings less than this length can be inlined into high priority result listings
		const SMALL_STRING_MAX = 512;
		// for task options bitmask
		const RETURN_RESULT = 1;

		const resolved = Promise.resolve();
		let pendingTasks = 0;
		let flushTimer;

		function next() {
			clearTimeout(flushTimer);
			if (queue.length===0) {
				flushTimer = setTimeout(flushResultStatuses, 50);
				return;
			}

			let taskDesc;
			for (let i=0; i<queue.length; i++) {
				pendingTasks = 0;
				walk(queue[i], countPendingTasks);
				// console.log(`Task #${queue[i][0]} has ${pendingTasks} pending Task dependencies.`);
				if (pendingTasks===0) {
					taskDesc = queue[i];
					queue.splice(i, 1);
					break;
				}
			}

			// queue has tasks, but all are pending
			if (taskDesc==null) {
				console.error(`Queue deadlocked: all ${queue.length} tasks have unresolved dependencies.`);
				// this is dead time, flush any pending results
				flushResultStatuses();
				return;
			}

			const id = taskDesc[0];
			const options = taskDesc[1];
			const name = taskDesc[2];
			const args = taskDesc.slice(3);

			// console.log('walk(',args,')');
			walk(args, replaceTaskIdWithResult);

			// console.log('executing task: ' + id);
			delete cancellations[id];
			const processor = tasks[name];
			const result = results[id] = resolved.then(() => {
				if (typeof processor!=='function') throw Error(`Unknown task processor "${name}".`);
				const instance = instances[name] || (instances[name] = new processor());
				return instance.process.apply(instance, args);
			}).then(
				value => {
					result.state = RESOLVE;
					result.fulfilled = true;
					result.value = value;
					gotResults.push([id, options, RESOLVE, value]);
					next();
				},
				err => {
					result.state = REJECT;
					result.fulfilled = true;
					result.error = err;
					gotResults.push([id, options, REJECT, '' + err]);
					next();
				}
			);
		}
		function flushResultStatuses() {
			clearTimeout(flushTimer);
			// console.log('flushing queue', gotResults.slice());
			if (gotResults.length===0) return;

			const transferrables = [];
			let statuses = [];
			const returnStatuses = [];
			let priorityResultCount = 0;
			let resultCount = 0;
			// const isSmallSet = gotResults.length < 10;
			// const isSmallSet = false;
			let allResultsLength = 0;
			for (let i=0; i<gotResults.length; i++) {
				if (gotResults[i]==null) continue;
				resultCount++;
				const [id, options, state, data] = gotResults[i];
				let status = [id, state];
				// if requested, we'll return the result along with the status:
				let returnResult = options & RETURN_RESULT;
				// if there are any priority returns in the queue, drop low-priority returns as we switch modes:
				if (returnResult) priorityResultCount++;
				// if (returnResult && 0===priorityResultCount++) {
				// 	statuses.length = 0;
				// 	// statuses = returnStatuses;
				// }
				// only return high-priority results, and remove them individually from the queue:
				// if (priorityResultCount!==0) {
				// 	if (!returnResult) continue;
				// }
				// preemptively pass nearly-free result types to the coordinating thread.

				const transferrablesBefore = transferrables.length;
				if (data) {
					walkReduce(data, collectTransferrables, transferrables);
				}
				const hasTransferrables = transferrables.length > transferrablesBefore;

				const type = typeof data;
				if (returnResult || data==null || hasTransferrables || type==='boolean' || type==='number' || (type==='string' && data.length<SMALL_STRING_MAX)) {
					status.push(data);
					returnStatuses.push(status);
					gotResults[i] = null;
				}
				statuses.push(status);
			}
			if (priorityResultCount!==0) statuses = returnStatuses;
			// low-priority/normal return clears the entire queue
			if (resultCount===0 || statuses.length === resultCount) {
				gotResults.length = 0;
			}
			else {
				// console.log(`flushed ${priorityResultCount} priority results, but ${resultCount-priorityResultCount} low priority results remain.`);
				flushTimer = setTimeout(flushResultStatuses, 50);
			}

			// let statuses = {};
			// const highPriorityStatuses = {};
			// let priorityResultCount = 0;
			// let returnedResultCount = 0;
			// const resultCount = gotResults.length;
			// for (let i=0; i<resultCount; i++) {
			// 	if (gotResults[i]==null) continue;
			// 	const [id, options, state, data] = gotResults[i];
			// 	let status = state;
			// 	// if requested, we'll return the result along with the status:
			// 	const isHighPriority = options & 1;
			// 	// for high priority, or tiny/empty return values, treat as high priority:
			// 	let returnResult = isHighPriority || data==null || typeof data==='boolean' || typeof data==='number';
			// 	if (returnResult) returnedResultCount++;
			// 	// if there are any priority returns in the queue, drop low-priority returns as we switch modes:
			// 	if (isHighPriority && 0===priorityResultCount++) {
			// 		// statuses = {};
			// 		statuses = highPriorityStatuses;
			// 	}
			// 	// only return high-priority results, and remove them individually from the queue:
			// 	if (priorityResultCount!==0) {
			// 		if (!returnResult) continue;
			// 		gotResults[i] = null;
			// 	}
			// 	// preemptively pass nearly-free result types to the coordinating thread.
			// 	if (returnResult) {
			// 		status = [state, data];
			// 		highPriorityStatuses[id] = status;
			// 	}
			// 	statuses[id] = status;
			// }
			// // low-priority/normal return clears the entire queue
			// if (priorityResultCount===0 || returnedResultCount===resultCount) {
			// 	gotResults.length = 0;
			// }
			// else {
			// 	console.log(`flushed ${returnedResultCount} priority results, but ${resultCount-returnedResultCount} low priority results remain.`);
			// 	flushTimer = setTimeout(flushResultStatuses, 50);
			// }

			// const ids = gotResults.reduce((obj, arr) => {
			// 	obj[arr[0]] = arr[1];
			// 	return obj;
			// });
			if (statuses.length!==0) {
				postMessage(['status', 0, statuses], transferrables);
			}
		}
		let SPECIAL;
		const queue = [];
		const results = {};
		const tasks = {};
		const instances = {};
		const cancellations = {};
		const gotResults = [];
		const api = {
			init(ident, worklets) {
				SPECIAL = ident;
				if (Array.isArray(worklets)) worklets.forEach(api.eval);
			},
			eval(code) {
				const descs = {};
				realm(code, {
					registerTask(name, processor) {
						tasks[name] = processor;
						descs[name] = Object.assign({}, processor);
					}
				});
				return descs;
			},
			task(id) {
				const data = [].slice.call(arguments);
				// console.log('queue task data: ', data);
				if (id in cancellations) {
					console.log('Skipping cancelled task: ' + id);
					return;
				}
				if (queue.push(data) === 1) next();
			},
			getresult(id) {
				// @TODO - could this set task options and flushResultStatuses()?

				// console.log('getting result: ' + id, results[id]);
				for (let i=gotResults.length; i--; ) {
					if (gotResults[i][0]===id) {
						gotResults.splice(i, 1);
						break;
					}
				}

				if (!id in results) throw Error(`Result ${id} not found.`);
				const result = results[id];
				gotResults.push([id, RETURN_RESULT, result.state, result.value]);
				flushResultStatuses();
			},
			cancel(id) {
				// console.log('cancelling task: ' + id);
				cancellations[id] = true;
			}
		};
		addEventListener('message', e => {
			let index = -1;
			function next() {
				if (++index===e.data.length) return;
				const item = e.data[index];
				resolved
					.then(() => api[item[0]].apply(null, item.slice(2)))
					.then(ret => {
						if (ret!==undefined) postMessage([0, item[1], ret]);
						next();
					}, err => {
						postMessage([1, item[1], '' + err]);
					});
			}
			next();
			// Promise.resolve()
			// 	.then(() => api[e.data[0]].apply(null, e.data.slice(2)))
			// 	.then(ret => {
			// 		if (ret!==undefined) postMessage([0, e.data[1], ret]);
			// 	});
				// .catch(err => {
				// 	postMessage([1, e.data[1], ''+err]);
				// });
		});
	})();
}) + ')()']));

// All ID's are generated by incrementing a shared counter
let COUNT = 0;
// used to verify that a task was serialized by TaskQueuePool
const SPECIAL = '$'+Math.random().toString(36).substring(2)
// for task options bitmask
const RETURN_RESULT = 1;
// let STRINGIFY_TASKS = false;


function walkTaskArgs(obj, walker) {
	for (let i in obj) {
		const value = obj[i];
		if (typeof value==='object' && value) {
			if (value instanceof Task) {
				walker(value, i, obj);
				// obj[i] = SPECIAL + ':' + obj[i].id;
			}
			else {
				walk(value);
			}
		}
	}
};


class TaskQueuePool {
	constructor({ size }) {
		this.workers = [];
		this.worklets = [];
		this.tasks = {};
		this.results = {};
		this.workerTaskAssignments = {};
		this.poolSize = size || 1;
	}

	exec(task, taskName, args) {
		const worker = this.getTaskWorker(taskName, args) || this.getNextWorker();
		this.workerTaskAssignments[task.id] = worker.id;
		this.tasks[task.id] = task;
		task.state = 'scheduled';
		worker.pending++;
		const resultController = this.results[task.id] = {
			// is the task waiting to be sent to a worker?
			pending: true,
			// has the task been cancelled?
			cancelled: false,
			// has the task been marked as completed by its worker?
			completed: false,
			// has the task result been obtained from the worker?
			fulfilled: false,
			// has the task result been requested from the worker?
			requested: false
		};
		resultController.result = new Promise((resolve, reject) => {
			resultController[0] = resolve;
			resultController[1] = reject;
		});
		const tasksToResolveIndices = [];
		const tasksToResolve = [];
		const tasks = [];
		// const walk = obj => {
		// 	for (let i in obj) {
		// 		const value = obj[i];
		// 		if (typeof value==='object' && value) {
		// 			if (value instanceof Task) {
		// 				// obj[i] = SPECIAL + ':' + obj[i].id;
		// 				value.$$taskIdentifier = SPECIAL + ':' + value.id;
		// 				if (this.getWorkerForTask(value.id) !== worker) {
		// 					tasksToResolveIndices.push(tasks.length);
		// 					tasksToResolve.push(value.result);
		// 				}
		// 				tasks.push(value);
		// 			}
		// 			else {
		// 				walk(value);
		// 			}
		// 		}
		// 	}
		// };

		// @TODO it would be better to serialize tasks to their $$taskIdentifier String representation here.
		// However doing so cannot mutate args in-place, as it would reveal the identifier secret.

		walkTaskArgs(args, (value, i, obj) => {
			if (this.getWorkerForTask(value.id) !== worker) {
				const resultController = this.results[value.id];
				console.warn(`Task#${value.id} passed to ${taskName}[${task.id}] was invoked in a different context. The result will be ${resultController.fulfilled?'':'materialized & '}transferred.`);
				tasksToResolveIndices.push(tasks.length);
				tasksToResolve.push(resultController.result);
			}
			tasks.push(value);
		});
		Promise.all(tasksToResolve).then(taskValues => {
			resultController.pending = false;
			if (resultController.cancelled) return;

			for (let i=tasks.length; i--; ) {
				const task = tasks[i];
				task.$$taskIdentifier = SPECIAL + ':' + task.id;
			}

			for (let i=taskValues.length; i--; ) {
				const task = tasks[tasksToResolveIndices[i]];
				task.$$taskResult = taskValues[i];
			}
			let options = 0;
			// if we need a result right away, mark the task as requiring a return
			// value. // This handles common cases like `await q.postTask().result`.
			if (resultController.requested) {
				// console.log('result requested for ', taskName, args);
				options |= 1;
			}
			// STRINGIFY_TASKS = true;
			// console.log(JSON.stringify(args));
			worker.call('task', [task.id, options, taskName].concat(args));
		})
		.then(() => {
			// STRINGIFY_TASKS = false;
			for (const task of tasks) {
				delete task.$$taskIdentifier;
				delete task.$$taskResult;
			}
			// .then(result => {
			// 	task.state = 'completed';
			// 	new Promise(resolve => {
			// 		this.results[task.id] = resolve;
			// 	});
			// 	this.tasks[task.id] = task;
			// });
		});
	}

	addWorklet(code) {
		this.worklets.push(code);
		return Promise.all(this.workers.map(worker => worker.call('eval', [code])));
	}

	/** cancellation isn't guaranteed, however cancellation of an already-completed task will attempt to return `true`. */
	cancel(taskId) {
		const task = this.tasks[tasksId];
		const resultController = this.results[taskId];
		if (resultController.completed || task.state==='completed') {
			return false;
		}
		task.state = 'cancelled';
		resultController.cancelled = true;
		if (!resultController.pending) {
			const workerId = this.workerTaskAssignments[taskId];
			const worker = this.getWorker(workerId);
			worker.call('cancel', [taskId]);
		}
	}

	getResult(taskId) {
		const resultController = this.results[taskId];
		// console.log('getResult: ', taskId, resultController);
		if (!resultController) {
			// this should never happen!
			throw Error(`Unknown result for Task: ${id}`);
		}
		if (resultController.pending===true) {
			resultController.requested = true;
		}
		else if (resultController.fulfilled===false && resultController.requested===false) {
			resultController.requested = true;
			const workerId = this.workerTaskAssignments[taskId];
			const worker = this.getWorker(workerId);
			worker.call('getresult', [taskId]);
		}
		return resultController.result;
	}

	freeWorkerTask(worker) {
		if (--worker.pending === 0) {
			// @todo: the worker now has no pending tasks.
			// Should we reallocate any pending idempotent tasks from other workers in the pool?
			// This may be impossible since tasks are scheduled by we don't know their instantaneous queuing status at any given point in time.
		}
	}

	// resultReceived(worker, result) {
	// 	const task = this.tasks[result.id];
	// 	if (task.state==='scheduled') {
	// 		this.freeWorkerTask(worker);
	// 	}
	// 	task.state = 'completed';
	// 	// @todo fire event?
	// 	const resultController = this.results[task.id];
	// 	resultController.fulfilled = true;
	// 	resultController[result.action || 0](result.data);
	// 	// this.results[result.id](result.data);
	// 	// delete this.results[result.id];
	// }

	statusReceived(worker, statuses) {
		// console.log('got statuses: ', statuses);
		// const statuses = Array.isArray(status) ? status : [status];
		// this.tasks[status.id].state = status.state;
		for (let i=0; i<statuses.length; i++) {
			const status = statuses[i];
			const id = status[0];
			const task = this.tasks[id];
			const resultController = this.results[id];
			if (task.state==='scheduled') {
				const workerId = this.workerTaskAssignments[id];
				const worker = this.getWorker(workerId);
				// console.log(task, id, workerId, worker);
				this.freeWorkerTask(worker);
			}
			// current only a fulfillment triggers status updates, so we assume an update fulfills its task:
			task.state = 'completed';
			resultController.completed = true;
			// task.state = 'fulfilled';

			// [id,status,data] denotes a task with an eager return value (forced/numbers/booleans):
			if (status.length===3) {
				task.state = 'fulfilled';
				// resolve/reject the status
				resultController.fulfilled = true;
				resultController[status[1]](status[2]);
			}
		}
	}

	getWorker(id) {
		for (const worker of this.workers) if (worker.id==id) return worker;
	}

	addWorker() {
		const worker = new Worker(workerUrl);
		worker.id = ++COUNT;
		worker.pending = 0;
		const callbacks = {};
		worker.onmessage = e => {
			const [type, id, data] = e.data;
			const got = `${type}Received`;
			if (this[got]) return this[got](worker, data);
			callbacks[id][type](data);
			delete callbacks[id];
		};
		let q = [];
		const resolved = Promise.resolve();
		function process() {
			worker.postMessage(q);
			q = [];
		}
		worker.call = (method, params) => new Promise(function() {
			const id = ++COUNT;
			callbacks[id] = arguments;
			if (q.push([method, id].concat(params)) === 1) {
				resolved.then(process);
			}
			// worker.postMessage([[method, id].concat(params)]);
			// worker.postMessage([method, id].concat(params));
		});
		// worker.call = (method, params) => new Promise(function() {
		// 	const id = ++COUNT;
		// 	callbacks[id] = arguments;
		// 	worker.postMessage([method, id].concat(params));
		// });
		this.workers.push(worker);
		worker.call('init', [SPECIAL, this.worklets]);
		// for (const code of this.worklets) worker.call('eval', [code]);
		return worker;
	}

	getWorkerForTask(taskId) {
		const id = this.workerTaskAssignments[taskId];
		for (const worker of this.workers) if (worker.id==id) return worker;
	}

	getTaskDependencies(args) {
		const tasks = [];
		walkTaskArgs(args, value => { tasks.push(value); });
		return tasks;
		// return args.filter(arg => arg instanceof Task);
	}

	getTaskWorker(taskName, args) {
		const tasks = this.getTaskDependencies(args);
		const usage = {};
		let highest = 0;
		let best;  // id of best worker

		for (const task of tasks) {
			const workerId = this.workerTaskAssignments[task.id];
			let c = usage[workerId] = (usage[workerId] || 0) + 1;
			if (c > highest) {
				highest = c;
				best = workerId;
			}
		}

		// console.log('BEST for '+taskName+'(',tasks,'): ', best, ' = ', this.getWorker(best));

		// if (best!=null) return this.workers[best];
		if (best!=null) return this.getWorker(best);
	}

	getNextWorker() {
		const size = this.workers.length;
		if (size===0) return this.addWorker();
		let best = this.workers[0];
		for (let i=1; i<size; i++) {
			const worker = this.workers[i];
			if (worker.pending < best.pending) {
				best = worker;
			}
		}
		if (best.pending && size < this.poolSize) {
			return this.addWorker();
		}
		return best;
	}
}

class Task {
	construtor() {
		this.state = 'pending';
	}
}
Object.defineProperties(Task.prototype, {
	$$taskIdentifier: {
		configurable: false,
		enumerable: true,
		writable: true,
		value: undefined,
		// get() {
		// 	if (STRINGIFY_TASKS===true) {
		// 		return `${SPECIAL}:${this.id}`;
		// 	}
		// }
	},
	state: {
		writable: true,
		value: 'pending'
	},
	result: {
		get() {
			let c = this.$$result;
			if (!c) prop(this, '$$result', c = this.$$queue.$$pool.getResult(this.id));
			return c;
		}
	},
	cancel: {
		value() {
			this.$$queue.$$pool.cancel(this.id);
		}
	}
});
