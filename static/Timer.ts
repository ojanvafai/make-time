export class Timer extends HTMLElement {
  static activeTimers_: Timer[];
  timeDisplay_: HTMLElement;
  timerButton_: HTMLElement;
  timerKey_: number|null = null;
  timeLeft_: number = 0;
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
    this.timerButton_.textContent = '🗘';
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
      this.nextTick_();
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
    this.timeLeft_ = this.countDown_ ? this.duration_ : 0;
    this.clearTimer_();
    this.nextTick_();
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

  async nextTick_() {
    if (this.overlay_)
      return;

    let timeLeft = this.timeLeft_;

    if (this.countDown_ && timeLeft == 0) {
      this.timeDisplay_.textContent = '';
      this.showOverlay_();
      return;
    }

    this.timeDisplay_.style.opacity = '1';

    if (this.countDown_) {
      this.timeLeft_--;
      if (timeLeft > 30) {
        this.timeDisplay_.style.color = '#ddd';
      } else if (timeLeft > 9) {
        this.timeDisplay_.style.color = 'black';
      } else if (timeLeft === 0) {
        this.timeDisplay_.style.animation = '';
      } else {
        this.timeDisplay_.style.color = 'red';
        window.setTimeout(() => this.timeDisplay_.style.opacity = '0', 500);
      }
    } else {
      this.timeLeft_++;
      if (timeLeft > 5) {
        this.timeDisplay_.style.color = 'red';
      } else if (timeLeft > 2) {
        this.timeDisplay_.style.color = 'black';
      } else {
        this.timeDisplay_.style.color = '#ddd';
      }
    }

    this.timeDisplay_.textContent = this.countDown_ ?
        String(timeLeft) :
        (timeLeft ? `${timeLeft} min` : '');

    this.timerKey_ = window.setTimeout(
        this.nextTick_.bind(this), this.countDown_ ? 1000 : 60000);
  }
}

Timer.activeTimers_ = [];

window.customElements.define('mt-timer', Timer);

document.addEventListener('visibilitychange', () => {
  for (let timer of Timer.activeTimers_) {
    timer.visibilityChanged(document.visibilityState == 'hidden');
  }
});
