export class Timer extends HTMLElement {
  static autoStart_: boolean|undefined;
  static activeTimers_: Timer[];
  paused_: boolean = false;
  timeDisplay_: HTMLElement;
  timerButton_: HTMLElement;
  timerKey_: number|null = null;
  timeLeft_: number = 0;
  overlay_: HTMLElement|null = null;

  constructor(
      autoStart: boolean, private countDown_: boolean, private duration_: number,
      private overlayContainer_: HTMLElement) {
    super();

    this.style.cssText = `
      display: block;
      font-size: 32px;
      padding: 4px;
    `;


    if (countDown_) {
      // Never autostart the timer on the first thread.
      if (Timer.autoStart_ === undefined) {
        Timer.autoStart_ = autoStart;
        this.paused_ = true;
      } else {
        this.paused_ = !Timer.autoStart_;
      }
    }

    this.timeDisplay_ = document.createElement('span');
    this.timeDisplay_.style.cssText = `
      border-radius: 5px;
    `;

    this.timerButton_ = document.createElement('span');
    this.timerButton_.style.cssText = `user-select: none;`;
    this.append(this.timeDisplay_, '\xa0', this.timerButton_);

    this.updatePlayButton_();
    this.timerButton_.onclick = () => this.toggleTimer_();
  }

  connectedCallback() {
    Timer.activeTimers_.push(this);
    if (Timer.autoStart_)
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

  toggleTimer_() {
    this.paused_ = !this.paused_;
    if (this.paused_)
      Timer.autoStart_ = false;
    this.updatePlayButton_();
  }

  updatePlayButton_() {
    this.timerButton_.textContent = this.paused_ ? '▶️' : '⏸️';
    this.clearOverlay_();
    this.restartTimer_();
  }

  restartTimer_() {
    if (this.paused_) {
      this.timeDisplay_.textContent = '';
      return;
    }

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
      background-color: black;
      opacity: 0.5;
    `;
    let text = document.createElement('div');
    text.innerHTML =
        'Out of time. Take an action!<br><br>The timer duration and whether it autostarts can be configured in the settings dialogs.';
    text.style.cssText = `
      position: absolute;
      padding: 5px;
      background-color: white;
    `;
    this.overlay_.append(background, text);
    this.overlayContainer_.append(this.overlay_);
  }

  async nextTick_() {
    if (this.overlay_)
      return;

    if (this.paused_) {
      this.timeDisplay_.textContent = '';
      return;
    }

    if (this.countDown_ && this.timeLeft_ == 0) {
      this.showOverlay_();
      return;
    }

    if (this.countDown_) {
      this.timeLeft_--;
      if (this.timeLeft_ > 20) {
        this.timeDisplay_.style.color = 'white';
      } else if (this.timeLeft_ > 5) {
        this.timeDisplay_.style.color = 'black';
      } else {
        this.timeDisplay_.style.color = 'red';
      }
    } else {
      this.timeLeft_++;
      if (this.timeLeft_ > 300) {
        this.timeDisplay_.style.color = 'red';
      } else if (this.timeLeft_ > 150) {
        this.timeDisplay_.style.color = 'black';
      } else {
        this.timeDisplay_.style.color = 'white';
      }
    }

    this.timeDisplay_.textContent = String(this.timeLeft_);
    this.timerKey_ = window.setTimeout(this.nextTick_.bind(this), 1000);
  }
}

Timer.activeTimers_ = [];

window.customElements.define('mt-timer', Timer);

document.addEventListener('visibilitychange', () => {
  for (let timer of Timer.activeTimers_) {
    timer.visibilityChanged(document.visibilityState == 'hidden');
  }
});
