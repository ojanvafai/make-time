type Task = () => Promise<void>;

export let TaskCountChangedEventName = 'task-queue-tasks-changed';

export class TaskCountChangedEvent extends Event {
  constructor(public count: number) {
    super(TaskCountChangedEventName);
  }
}

export class TaskQueue extends EventTarget {
  private maxTasks: number;
  private tasks: Task[] = [];
  private inProgressTaskCount = 0;
  private resolves: (() => void)[] = [];

  constructor(maxTasks: number) {
    super();
    this.maxTasks = maxTasks;
  }

  public doTasks() {
    if (this.inProgressTaskCount >= this.maxTasks)
      return;
    let task = this.tasks.pop();
    if (task === undefined) {
      for (let resolve of this.resolves)
        resolve();
      return;
    }
    this.inProgressTaskCount++;

    task().then(() => {
      this.inProgressTaskCount--;
      this.dispatchTaskCountEvent();
      this.doTasks();
    });
    this.doTasks();
  }

  public queueTask(task: Task) {
    const shouldStart = this.tasks.length == 0;
    this.tasks.push(task);
    this.dispatchTaskCountEvent();
    if (shouldStart)
      this.doTasks();
  }

  dispatchTaskCountEvent() {
    // This is kinda wonky. Want to show some progress for in progress tasks,
    // but don't want them to appear completed. Otherwise, with 3 tasks, we lose
    // most sense of progress in RadialProgress since all tasks happen in
    // parallel.
    let count = this.tasks.length + this.inProgressTaskCount / 2;
    this.dispatchEvent(new TaskCountChangedEvent(count));
  }

  public flush() {
    return new Promise(resolve => {
      if (!this.tasks.length && this.inProgressTaskCount == 0)
        resolve();
      this.resolves.push(resolve);
    });
  }
}
