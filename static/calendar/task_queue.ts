type Task = () => Promise<void>;

export class TaskQueue {
    private maxTasks: number;
    private tasks: Task[] = [];
    private inProgressTaskCount = 0;
    private resolves: (() => void)[] = [];

    constructor(maxTasks: number) {
        this.maxTasks = maxTasks;
    }

    public async doTasks() {
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
            this.doTasks();
        });
        this.doTasks();
    }

    public async queueTask(task: Task) {
        const shouldStart = this.tasks.length == 0;
        this.tasks.push(task);
        if (shouldStart)
            this.doTasks();
    }

    public flush() {
        return new Promise(resolve => {
            this.resolves.push(resolve);
        });
    }
}