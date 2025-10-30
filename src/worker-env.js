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
  // Get the code as a string
  let code;
  if (typeof codeBlob === 'string') {
    code = codeBlob;
  } else if (isBrowser && codeBlob instanceof Blob) {
    // In browser with a Blob, create a URL
    const url = URL.createObjectURL(codeBlob);
    return new Worker(url);
  } else {
    code = String(codeBlob);
  }

  if (isBrowser) {
    // In browser, create a blob from the code string
    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    return new Worker(url);
  }

  if (isNode) {
    // In Node.js, use web-worker with data URL
    try {
      const WebWorker = require('web-worker');
      // Use data URL - web-worker supports this!
      const dataUrl = `data:text/javascript,${encodeURIComponent(code)}`;
      return new WebWorker(dataUrl);
    } catch (e) {
      throw new Error('web-worker package is required for Node.js environment. Install it with: npm install web-worker. Error: ' + e.message);
    }
  }

  throw new Error('Unable to create worker in this environment');
}

export { isBrowser, isNode };
