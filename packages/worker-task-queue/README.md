# `worker-task-queue`

This is a standalone implementation of the cooperative multithreading model from [Task Worklet](https://github.com/developit/task-worklet) as a zero-dependency library for Web and Node.

```js
import WorkerTaskQueue from 'worker-task-queue';

// Set up the worker pool
const queue = new WorkerTaskQueue({
  // URL/path for our worker script:
  workerUrl: '/path/to/worker.js',
  // max pool size:
  size: 4
});

function demo(image) {
  // allocates a thread in the pool doesn't have one free:
  const cropped = postTask('crop', image, { box: [10, 20, 30, 40] });

  // subsequent tasks run on the same thread to eliminate data transfer:
  let large = postTask('resize', cropped, { width: 1000, height: 1000 });
  large = postTask('compress', large, quality);

  // ... except when they get automatically parallelized by moving the input to a second thread:
  let thumb = postTask('resize', cropped, { width: 200, height: 200 });
  thumb = postTask('compress', thumb, quality);

  // At this point we've only transferred one image to a background thread,
  // and transferred another image between two threads.

  // Only the final results are transferred back here, and only when we ask for them:
  showPreview(await large.result, await thumb.result);
}

demo();
```
