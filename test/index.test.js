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

import TaskQueue from '../src/index.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('TaskQueue', () => {
  it('should pass smoketest', async () => {
    expect(typeof TaskQueue).toBe('function');
  });

  describe('task execution and chaining', () => {
    let queue;

    it('should be instantiable via a Blob URL', async () => {
      queue = new TaskQueue();
      await queue.addModule(URL.createObjectURL(new Blob([`
        registerTask('add', class {
          process(a, b) {
            return a + b;
          }
        })
      `])));
    });

    it('should execute a single task', async () => {
      const sum1 = queue.postTask('add', 1, 2);

      await sleep(1);
      expect(sum1.state).toBe('scheduled');

      const result = await sum1.result;
      expect(sum1.state).toBe('fulfilled');
      expect(result).toBe(3);
    });

    it('should execute tasks with task dependencies', async () => {
      const sum1 = queue.postTask('add', 1, 2);
      const sum2 = queue.postTask('add', sum1, 2);

      await sleep(1);
      expect(sum1.state).toBe('scheduled');
      expect(sum2.state).toBe('scheduled');

      const result = await sum2.result;
      expect(sum1.state).toBe('fulfilled');
      expect(sum2.state).toBe('fulfilled');
      expect(result).toBe(5);
    });
  });
});
