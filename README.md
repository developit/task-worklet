# Task Worklet

A polyfill for Task Worklet - a proposed API for defining and invoking coordinated, threadpooled background tasks with minimal transfer overhead.

## Motivation

A lot of what we do in modern web applications touches the DOM in some way.
Improving the performance of DOM-bound code is difficult because issues generally stem from layout and paint cost rather than actual script execution overhead.
Task Worklet attempts to define a highly ergonomic way to offload all of the work an application needs to do that _doesn't_ rely on the DOM, while making it incredibly easy to move data between the UI thread and background threads.

In addition to ergonomics, the design of Task Worklet allows for an implicit data flow graph to be formed based on how tasks are linked together to form dependencies on one another.  When combined with pooling and a centralized registry for task processors, this enables an algorithm to distribute work across multiple threads, automatically maximizing concurrency and minimizing transfer overhead.

**Demo:** [Realtime JS compilation, bundling & compression](https://jsfiddle.net/developit/wfLsxgy0/179/)

## Usage

First, install the script via `npm install task-worklet` or grab it from [unpkg](https://unpkg.com/task-worklet).

By default, the `task-worklet` ships as an npm module that exports the `TaskQueue` interface.

If you'd prefer to "install" it as `window.TaskQueue`, go for `task-worklet/polyfill`:

```html
<script src="https://unpkg.com/task-worklet/polyfill"></script>
```

Once you have it imported/installed, we can start interacting with the `TaskQueue`:

```js
// create a queue a max threadpool size of 1:
const queue = new TaskQueue();

// add a Task Worklet:
queue.addModule('/fetch-worklet.js').then(() => { /* loaded */ })

const task = queue.postTask('fetch', 'https://example.com/data.json');

console.log(task.state);  // pending

await sleep(1);

console.log(task.state);  // scheduled

// now we'll ask for the result back. This bumps up the priority
// of the task and sends its result to the main thread once complete:
const result = await task.result;
console.log(result)  // { ..some data.. }
```

**Here's the key:**  `task.result` is a lazy getter. If you don't ask for a Task's result by accessing `.result`, it will be kept in whatever background thread ran the task until it's needed.

Why keep task results in the thread that ran the task?
That's the best part: we can pass `Task` instances to `postTask()`, and instead of "pulling" the result of a task back to the main thread and sending it on to the thread that's running that second task, the second task will be routed to the thread that already has the first's result waiting:

```js
const data = q.postTask('fetch', 'https://example.com/data.json');

const subset = q.postTask('filter', data, ['items', 'count']);

// we only end up with the subsetted data on the main thread:
console.log(await subset.result);
```
