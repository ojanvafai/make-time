class ThreadList {
  constructor() {
    this.threads_ = {};
    this.length = 0;
    this.queues_ = [];
  }

  createQueue_(queue) {
    if (this.threads_[queue])
      return;
    this.threads_[queue] = [];
    this.queues_.push(queue);
    this.queues_.sort(LabelUtils.compareLabels);
  }

  push(thread) {
    this.createQueue_(thread.queue);
    let list = this.threads_[thread.queue];
    list.push(thread);
    this.length++;
  }

  currentQueue() {
    return this.queues_[0];
  }

  pop() {
    if (!this.length)
      return null;

    let queue = this.currentQueue();
    let list = this.threads_[queue];
    // Clear out the queue if it will be empty after this call.
    if (list.length == 1) {
      delete this.threads_[queue];
      this.queues_.shift();
    }
    this.length--;
    return list.pop();
  }
}
