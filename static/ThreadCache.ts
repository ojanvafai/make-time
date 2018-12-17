import { Thread } from './Thread.js';
import { getLabels } from './BaseMain.js';

export class ThreadCache {
  cache_: Map<Number, Thread>;

  constructor() {
    this.cache_ = new Map();
  }

  async get(threadData: any) {
    let entry = this.cache_.get(threadData.id);
    if (entry && entry.historyId == threadData.historyId)
      return entry;

    let thread = new Thread(threadData, await getLabels());
    this.cache_.set(threadData.id, thread);
    return thread;
  }
}
