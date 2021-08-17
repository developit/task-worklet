const { registerTask } = require('worker-task-queue/processor');

registerTask(
  'add',
  class {
    process(a, b) {
      return a + b;
    }
  }
);
