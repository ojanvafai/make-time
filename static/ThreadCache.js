class ThreadCache {
  constructor() {
    this.cache_ = new Map();
  }

  get(threadData, allLabels) {
    let entry = this.cache_.get(threadData.id);
    if (entry && entry.historyId == threadData.historyId)
      return entry;

    let thread = new Thread(threadData, allLabels);
    this.cache_.set(threadData.id, thread);
    return thread;
  }
}
