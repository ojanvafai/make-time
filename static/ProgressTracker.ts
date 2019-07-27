import {assert} from './Base.js';

export let COMPLETED_EVENT_NAME = 'progress-completed';
export class CompletedEvent extends Event {
  constructor() {
    super(COMPLETED_EVENT_NAME);
  }
}

export class ProgressTracker extends HTMLElement {
  private total_: number;
  private completedCount_: number;

  constructor() {
    super();

    this.style.marginLeft = '4px';

    this.total_ = 0;
    this.completedCount_ = 0;
  }

  addToTotal(count: number) {
    this.total_ += count;
    // Can't show meaningful progress with < 3 items.
    if (this.total_ < 3) {
      this.style.display = 'none';
    } else {
      this.style.display = 'inline-block';
      this.render_();
    }
  }

  incrementProgress() {
    assert(this.total_ !== 0);

    this.completedCount_++;
    if (this.completedCount_ === this.total_)
      this.complete_();
    else
      this.render_();
  }

  private complete_() {
    this.dispatchEvent(new CompletedEvent());
    this.total_ = 0;
    this.completedCount_ = 0;
    this.style.display = 'none';
  }

  private render_() {
    assert(this.completedCount_ <= this.total_);
    this.textContent =
        `${Math.floor(100 * this.completedCount_ / this.total_)}%`;
  }
}
window.customElements.define('mt-progress-tracker', ProgressTracker);
