import { EventTargetPolyfill } from './EventTargetPolyfill';

type Task = () => Promise<void>;

export let TASK_COMPLETED_EVENT_NAME = 'task-queue-tasks-changed';

export class TaskCompletedEvent extends Event {
  constructor() {
    super(TASK_COMPLETED_EVENT_NAME);
  }
}

export class TaskQueue extends EventTargetPolyfill {
  private maxTasks: number;
  private tasks: Task[] = [];
  private inProgressTaskCount = 0;
  private resolves: (() => void)[] = [];

  constructor(maxTasks: number) {
    super();
    this.maxTasks = maxTasks;
  }

  public doTasks() {
    if (this.inProgressTaskCount >= this.maxTasks) return;
    let task = this.tasks.shift();
    if (task === undefined) {
      for (let resolve of this.resolves) resolve();
      return;
    }
    this.inProgressTaskCount++;

    task().then(() => {
      this.inProgressTaskCount--;
      this.dispatchTaskCompletedEvent();
      this.doTasks();
    });
    this.doTasks();
  }

  public queueTask(task: Task) {
    const shouldStart = this.tasks.length == 0;
    this.tasks.push(task);
    if (shouldStart) this.doTasks();
  }

  dispatchTaskCompletedEvent() {
    this.dispatchEvent(new TaskCompletedEvent());
  }

  flush() {
    return new Promise((resolve) => {
      if (!this.tasks.length && this.inProgressTaskCount == 0) resolve();
      this.resolves.push(resolve);
    });
  }

  async cancel() {
    this.tasks = [];
    // Flush the in progress tasks.
    await this.flush();
  }
}
