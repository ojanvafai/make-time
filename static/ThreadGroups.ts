import { Thread } from './Thread.js';
import { View } from './views/View.js';

export class ThreadGroups {
  bestEffort_: Thread[] | null;
  listener_: View | undefined;

  constructor() {
    this.bestEffort_ = [];
  }

  setListener(view: View) {
    this.listener_ = view;
  }

  processBestEffort() {
    this.setBestEffort(null);
    if (this.listener_)
      this.listener_.update();
  }
  pushBestEffort(thread: Thread) {
    if (!this.bestEffort_)
      throw 'Something went wrong. This should never happen.';

    this.bestEffort_.push(thread);
    if (this.listener_)
      this.listener_.pushBestEffort();
  }
  getBestEffort() {
    return this.bestEffort_;
  }
  setBestEffort(array: [] | null) {
    if (this.bestEffort_)
      this.bestEffort_ = array;
  }
}
