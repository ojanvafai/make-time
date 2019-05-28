export class Timer extends HTMLElement {
  static activeTimers_: Timer[];
  timeDisplay_: HTMLElement;
  timerButton_: HTMLElement;
  timerKey_: number|null = null;
  startTime_: number = 0;
  overlay_: HTMLElement|null = null;

  constructor(
      private countDown_: boolean, private duration_: number,
      private overlayContainer_: HTMLElement) {
    super();

    this.style.cssText = `
      display: block;
      font-size: 32px;
      padding: 4px;
      position: absolute;
      right: 0;
    `;

    this.timeDisplay_ = document.createElement('span');
    this.timeDisplay_.style.cssText = `
      border-radius: 5px;
    `;

    this.timerButton_ = document.createElement('span');
    this.timerButton_.style.cssText = `user-select: none;`;
    this.timerButton_.textContent = '\u{1F501}';
    this.append(this.timeDisplay_, '\xa0', this.timerButton_);

    this.restartTimer_();
    this.timerButton_.onclick = () => this.restartTimer_();
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
      background-color: #000000;
      opacity: 0.5;
    `;
    let text = document.createElement('div');
    text.innerHTML =
        'Out of time. Take an action!<br><br>The timer duration can be configured in the settings dialogs.';
    text.style.cssText = `
      position: absolute;
      padding: 5px;
      background-color: #ffffff;
      text-align: center;
    `;

    let resetButton = this.timerButton_.cloneNode(true) as HTMLElement;
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
