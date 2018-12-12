import { Thread } from './Thread.js';
import { Labels } from './Labels.js';

export class ThreadCache {
  cache_: Map<Number, Thread>;

  constructor() {
    this.cache_ = new Map();
  }

  get(threadData: any, allLabels: Labels) {
    let entry = this.cache_.get(threadData.id);
    if (entry && entry.historyId == threadData.historyId)
      return entry;

    let thread = new Thread(threadData, allLabels);
    this.cache_.set(threadData.id, thread);
    return thread;
  }
}
