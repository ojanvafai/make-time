class ThreadGroups {
  constructor() {
    this.triaged_ = [];
    this.needsTriage_ = [];
    this.bestEffort_ = [];
    this.listener_;
  }

  setListener(view) {
    this.listener_ = view;
  }

  pushNeedsTriage(thread) {
    this.needsTriage_.push(thread);
    if (this.listener_ && this.listener_.pushNeedsTriage)
      this.listener_.pushNeedsTriage(thread);
  }
  getNeedsTriage() {
    return this.needsTriage_;
  }
  setNeedsTriage(array) {
    this.needsTriage_ = array;
  }

  processBestEffort() {
    let threads = this.getNeedsTriage().concat(this.getBestEffort());
    this.setNeedsTriage(threads);
    // Null this out before to avoid adding more threads to threads_.bestEffort_
    // once we've started triaging best effort threads.
    threads_.setBestEffort(null);
  }
  pushBestEffort(thread) {
    // After we've started triaging best effort threads, no longer push things
    // to the best effort queue.
    if (!this.bestEffort_) {
      this.pushNeedsTriage(thread);
      return;
    }

    this.bestEffort_.push(thread);
    if (this.listener_ && this.listener_.pushBestEffort)
      this.listener_.pushBestEffort(thread);
  }
  getBestEffort() {
    return this.bestEffort_;
  }
  setBestEffort(array) {
    this.bestEffort_ = array;
  }
}
