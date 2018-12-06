import { Thread } from './Thread.js';
import { AbstractThreadListView } from './views/AbstractThreadListView.js';

export class ThreadGroups {
  bestEffort_: Thread[];
  listener_: AbstractThreadListView;

  constructor() {
    this.bestEffort_ = [];
    this.listener_;
  }

  setListener(view) {
    this.listener_ = view;
  }

  processBestEffort() {
    this.setBestEffort(null);
    if (this.listener_.update)
      this.listener_.update();
  }
  pushBestEffort(thread) {
    this.bestEffort_.push(thread);
    if (this.listener_ && this.listener_.pushBestEffort)
      this.listener_.pushBestEffort(thread);
  }
  getBestEffort() {
    return this.bestEffort_;
  }
  setBestEffort(array) {
    if (this.bestEffort_)
      this.bestEffort_ = array;
  }
}
