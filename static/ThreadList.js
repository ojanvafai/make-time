class ThreadList {
  constructor(queuedLabelData) {
    this.threads_ = {};
    this.length = 0;
    this.queueNames_ = [];
    this.queuedLabelData_ = queuedLabelData;
  }

  createQueue_(queue) {
    if (this.threads_[queue])
      return;
    this.threads_[queue] = [];
    this.queueNames_.push(queue);

    let queueDatas = this.queuedLabelData_.getSorted(this.queueNames_);
    this.queueNames_ = queueDatas.map((item) => item[0]);
  }

  async push(thread) {
    let queue = await thread.getQueue();
    this.createQueue_(queue);
    let list = this.threads_[queue];
    list.push(thread);
    this.length++;
  }

  currentQueue() {
    return this.queueNames_[0];
  }

  queues() {
    return this.queueNames_;
  }

  threadCountForQueue(queue) {
    let list = this.threads_[queue];
    if (!list)
      return 0;
    return list.length;
  }

  pop() {
    if (!this.length)
      return null;

    let queue = this.currentQueue();
    let list = this.threads_[queue];
    // Clear out the queue if it will be empty after this call.
    if (list.length == 1) {
      delete this.threads_[queue];
      this.queueNames_.shift();
    }
    this.length--;
    return list.pop();
  }
}
