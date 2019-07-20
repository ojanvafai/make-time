import {createSvgButton} from './Base.js';

export class Timer extends HTMLElement {
  static activeTimers_: Timer[];
  timeDisplay_: HTMLElement;
  timerButton_: SVGSVGElement;
  timerKey_: number|null = null;
  startTime_: number = 0;
  overlay_: HTMLElement|null = null;

  constructor(
      private countDown_: boolean, private duration_: number,
      private overlayContainer_: HTMLElement) {
    super();

    this.style.cssText = `
      display: flex;
      font-size: 32px;
      padding: 4px;
      position: absolute;
      right: 0;
    `;

    this.timeDisplay_ = document.createElement('span');
    this.timeDisplay_.style.cssText = `
      border-radius: 3px;
    `;

    let timerButtonContents =
        `<path d="M 22 2 L 19.058594 4.9414062 C 16.865786 2.7436807 13.666769 1.5536385 10.212891 2.15625 C 6.1828906 2.86025 2.9227344 6.0746563 2.1777344 10.097656 C 1.0007344 16.443656 5.864 22 12 22 C 17.134 22 21.3785 18.109094 21.9375 13.121094 C 22.0045 12.525094 21.5375 12 20.9375 12 C 20.4375 12 20.007125 12.368234 19.953125 12.865234 C 19.520125 16.870234 16.119 20 12 20 C 7.059 20 3.1501562 15.498859 4.1601562 10.380859 C 4.7681562 7.3008594 7.2335937 4.8107812 10.308594 4.1757812 C 13.170804 3.5850239 15.832013 4.545023 17.642578 6.3574219 L 15 9 L 22 9 L 22 2 z"></path>`;
    this.timerButton_ = createSvgButton(
        '0 0 24 24', () => this.restartTimer_(), timerButtonContents);
    this.append(this.timeDisplay_, this.timerButton_);

    this.restartTimer_();
  }

  connectedCallback() {
    Timer.activeTimers_.push(this);
    this.restartTimer_();
  }

  disconnectedCallback() {
    Timer.activeTimers_ = Timer.activeTimers_.filter(item => item != this);
    this.clearTimer_();
    this.clearOverlay_();
  }

  visibilityChanged(isHidden: boolean) {
    if (!isHidden) {
      this.render_();
      return;
    }
    this.clearTimer_();
  }

  clearTimer_() {
    if (this.timerKey_) {
      clearTimeout(this.timerKey_);
      this.timerKey_ = null;
    }
  }

  restartTimer_() {
    this.clearOverlay_();
    this.startTime_ = Date.now();
    this.clearTimer_();
    this.render_();
  }

  clearOverlay_() {
    if (this.overlay_) {
      this.overlay_.remove();
      this.overlay_ = null;
    }
  }

  showOverlay_() {
    this.overlay_ = document.createElement('div');
    this.overlay_.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    let background = document.createElement('div');
    background.style.cssText = `
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      background-color: var(--inverted-overlay-background-color);
      opacity: 0.5;
    `;
    let text = document.createElement('div');
    text.innerHTML =
        'Out of time. Take an action!<br><br>The timer duration can be configured in the settings dialogs.';
    text.style.cssText = `
      position: absolute;
      padding: 5px;
      background-color: var(--overlay-background-color);
      border-radius: 4px;
      text-align: center;
      display: flex;
      align-items: center;
    `;

    let resetButton = this.timerButton_.cloneNode(true) as SVGSVGElement;
    resetButton.style.cssText = `
      display: block;
      font-size: 32px;
    `;
    resetButton.addEventListener('click', () => this.restartTimer_());
    text.append(resetButton);

    this.overlay_.append(background, text);
    this.overlayContainer_.append(this.overlay_);
  }

  async render_() {
    if (this.overlay_)
      return;

    let timeExpiredSec = Math.floor((Date.now() - this.startTime_) / 1000);

    if (this.countDown_ && timeExpiredSec > this.duration_) {
      this.timeDisplay_.textContent = '';
      this.timeDisplay_.style.animation = '';
      this.showOverlay_();
      return;
    }

    this.timeDisplay_.style.opacity = '1';

    let newText;
    let newColor;
    if (this.countDown_) {
      let timeLeft = this.duration_ - timeExpiredSec;
      if (timeLeft > 30) {
        newColor = '#ddd';
      } else if (timeLeft > 9) {
        newColor = 'black';
      } else {
        newColor = 'red';
        window.setTimeout(() => this.timeDisplay_.style.opacity = '0', 500);
      }
      newText = String(timeLeft);
    } else {
      let timeExpiredMin = Math.floor(timeExpiredSec / 60);
      if (timeExpiredMin > 5) {
        newColor = 'red';
      } else if (timeExpiredMin > 2) {
        newColor = 'black';
      } else {
        newColor = '#ddd';
      }
      newText = timeExpiredMin ? `${timeExpiredMin} min` : '';
    }

    this.timeDisplay_.style.color = newColor;
    this.timeDisplay_.textContent = newText;
    this.timerKey_ = window.setTimeout(
        this.render_.bind(this), this.countDown_ ? 1000 : 60000);
  }
}

Timer.activeTimers_ = [];

window.customElements.define('mt-timer', Timer);

document.addEventListener('visibilitychange', () => {
  for (let timer of Timer.activeTimers_) {
    timer.visibilityChanged(document.visibilityState == 'hidden');
  }
});
