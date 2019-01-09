export let COMPLETED_EVENT_NAME = 'radial-progress-completed';
export class CompletedEvent extends Event {
  constructor() {
    super(COMPLETED_EVENT_NAME);
  }
}

export class RadialProgress extends HTMLElement {
  private total_: number;
  private completed_: number;
  private slice1_: HTMLElement;
  private slice2_: HTMLElement;

  constructor() {
    super();

    this.total_ = 0;
    this.completed_ = 0;

    this.slice1_ = document.createElement('div');
    this.slice2_ = document.createElement('div');

    let size = 16;

    this.style.cssText = `
      background-color: grey;
      width: ${size}px;
      height: ${size}px;
      border-radius: ${size / 2}px;
      position: relative;
    `;

    let clipCss = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${size}px;
      height: ${size}px;
    `;

    let clip1 = document.createElement('div');
    clip1.style.cssText = `
      ${clipCss}
      clip: rect(0px, ${size}px, ${size}px, ${size / 2}px);
    `;
    this.append(clip1);

    let clip2 = document.createElement('div');
    clip2.style.cssText = `
      ${clipCss}
      clip: rect(0, ${size / 2}px, ${size}px, 0px);
    `;
    this.append(clip2);

    let sliceCss = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      border-radius: ${size / 2}px;
      background-color: white;
      border-color: white;
      transform: rotate(0);
    `;

    this.slice1_ = document.createElement('div');
    this.slice1_.style.cssText = `
      ${sliceCss}
      clip: rect(0px, ${size / 2}px, ${size}px, 0px);
    `;
    clip1.append(this.slice1_);

    this.slice2_ = document.createElement('div');
    this.slice2_.style.cssText = `
      ${sliceCss}
      clip: rect(0px, ${size}px, ${size}px, ${size / 2}px);
    `;
    clip2.append(this.slice2_);
  }

  addToTotal(count: number) {
    this.total_ += count;

    // Can't show meaningful progress with < 3 items.
    if (this.total_ < 3) {
      this.style.display = 'none';
      return;
    }
  }

  countDown() {
    if (this.total_ === 0)
      throw 'This should never happen.';

    this.completed_++;
    if (this.completed_ == this.total_) {
      this.dispatchEvent(new CompletedEvent());
      this.total_ = 0;
      this.completed_ = 0;
    }

    this.style.display = 'inline-block';

    let firstHalfAngle;
    let secondHalfAngle;

    let ratio = this.completed_ / this.total_;
    // Always have some of the progress indicated.
    let drawAngle = Math.max(10, ratio * 360);
    if (drawAngle <= 180) {
      firstHalfAngle = drawAngle;
      secondHalfAngle = 0;
    } else {
      firstHalfAngle = 180;
      secondHalfAngle = drawAngle - 180;
    }

    this.slice1_.style.transform = `rotate(${firstHalfAngle}deg)`;
    this.slice2_.style.transform = `rotate(${secondHalfAngle}deg)`;
  }
}
window.customElements.define('mt-radial-progress', RadialProgress);