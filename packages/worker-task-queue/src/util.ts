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

export type Key = string | number;

type Reducer<T> = (
  accumulator: Partial<T> | void,
  obj: any,
  index: Key,
  parent: any
) => Partial<T> | void;

export function walkReduce<T = any>(
  obj: any,
  reducer: Reducer<T>,
  accumulator?: Partial<T> | void,
  index?: Key,
  parent?: any
) {
  let result = reducer(accumulator, obj, index, parent);
  if (result === undefined) result = accumulator;
  if (typeof obj === 'object' && obj) {
    for (let i in obj) {
      walkReduce<T>(obj[i], reducer, result, i, obj);
    }
  }
  return result;
}

type Transferrables = ArrayBuffer | MessagePort | ImageBitmap;

export function collectTransferrables<T = any>(xfer: Transferrables[], value: T) {
  if (
    value instanceof ArrayBuffer ||
    value instanceof MessagePort ||
    value instanceof ImageBitmap
  ) {
    xfer.push(value);
  }
}
