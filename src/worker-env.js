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

/**
 * Detects the environment and provides the appropriate Worker implementation
 */

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

// Check if we're in a Node.js environment
const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

/**
 * Create a worker from code blob/string
 * @param {Blob|string} codeBlob - The code blob (browser) or string (Node.js)
 * @returns {Worker} Worker instance
 */
export function createWorker(codeBlob) {
  if (isBrowser) {
    // In browser, use native Worker API
    if (codeBlob instanceof Blob) {
      const url = URL.createObjectURL(codeBlob);
      return new Worker(url);
    } else if (typeof codeBlob === 'string') {
      const blob = new Blob([codeBlob], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      return new Worker(url);
    }
  }

  if (isNode) {
    // In Node.js, use worker_threads
    try {
      const { Worker } = require('worker_threads');
      const code = typeof codeBlob === 'string' ? codeBlob : String(codeBlob);

      // worker_threads requires eval: true option for code strings
      const worker = new Worker(code, { eval: true });

      // Add Web Worker compatibility layer to Node.js Worker
      // Convert worker.on('message') to worker.onmessage setter
      Object.defineProperty(worker, 'onmessage', {
        set: function(handler) {
          if (handler) {
            this.on('message', function(data) {
              // Wrap the message in an event-like object
              handler({ data: data });
            });
          }
        }
      });

      // Override postMessage to match Web Worker signature
      const originalPostMessage = worker.postMessage.bind(worker);
      worker.postMessage = function(data, transferList) {
        originalPostMessage(data, transferList);
      };

      return worker;
    } catch (e) {
      throw new Error('worker_threads is required for Node.js environment. Make sure you are using Node.js 10.5.0 or higher. Error: ' + e.message);
    }
  }

  throw new Error('Unable to create worker in this environment');
}

export { isBrowser, isNode };
