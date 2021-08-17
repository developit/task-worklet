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

import WorkerTaskQueue from '../src/index';
import Worker from 'web-worker';
global.Worker = Worker;

const tick = () => new Promise((r) => process.nextTick(r));

describe('TaskQueue', () => {
  it('should pass smoketest', async () => {
    expect(typeof WorkerTaskQueue).toBe('function');
  });

  describe('task execution and chaining', () => {
    let queue;

    it('should be instantiable via relative path', async () => {
      queue = new WorkerTaskQueue(require.resolve('./worker.js'), { size: 4 });
    });

    it('should execute a single task', async () => {
      const sum1 = queue.postTask('add', 1, 2);

      await tick();
      expect(sum1.state).toBe('scheduled');

      const result = await sum1.result;
      expect(sum1.state).toBe('fulfilled');
      expect(result).toBe(3);
    });

    it('should execute tasks with task dependencies', async () => {
      const sum1 = queue.postTask('add', 1, 2);
      const sum2 = queue.postTask('add', sum1, 2);

      await tick();
      expect(sum1.state).toBe('scheduled');
      expect(sum2.state).toBe('scheduled');

      const result = await sum2.result;
      expect(sum1.state).toBe('fulfilled');
      expect(sum2.state).toBe('fulfilled');
      expect(result).toBe(5);
    });

    it('should terminate workers when destroy() is called', () => {
      expect(() => {
        queue.destroy();
      }).not.toThrow();
    });
  });
});
