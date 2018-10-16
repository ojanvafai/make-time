class ViewOne extends AbstractSingleThreadView {
  constructor(threads, autoStartTimer, timeout, allowedReplyLength, contacts, setSubject, updateTitle, queuedLabelData) {
    let threadList = new ThreadList(queuedLabelData);
    super(threadList, allowedReplyLength, contacts, setSubject, updateTitle);
    this.style.display = 'block';

    this.threads_ = threads;
    this.autoStartTimer_ = autoStartTimer;
    this.timeout_ = timeout;

    this.timerPaused_ = true;

    this.toolbar_ = document.createElement('div');
    this.toolbar_.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
    `;

    let footer = document.getElementById('footer');
    footer.textContent = '';
    footer.append(this.toolbar_);

    this.addButtons_();
    this.init_();
  }

  async init_() {
    for (let thread of this.threads_.getNeedsTriage()) {
      await this.threadList.push(thread);
    }
    this.renderNext();
  }

  toggleTimer_() {
    this.timerPaused_ = !this.timerPaused_;
    if (this.timerPaused_)
      this.autoStartTimer_ = false;
    this.updatePlayButton_();
    this.clearTimerOverlay_();
    this.restartTimer_();
  }

  updatePlayButton_() {
    this.timerButton_.textContent = this.timerPaused_ ? '▶️' : '⏸️';
  }

  addButtons_() {
    this.toolbar_.textContent = '';

    this.queueSummary = document.createElement('details');

    this.timer_ = document.createElement('span');
    this.timer_.style.cssText = `
      border-radius: 5px;
    `;

    this.actions_ = new Actions(this, ViewOne.ACTIONS_, ViewOne.OVERFLOW_ACTIONS_);

    let timerContainer = document.createElement('div');
    timerContainer.style.cssText = `
      font-size: 32px;
      padding: 4px;
    `;
    this.timerButton_ = document.createElement('span');
    timerContainer.append(this.timer_, '\xa0', this.timerButton_);

    this.updatePlayButton_();
    timerContainer.onclick = () => this.toggleTimer_();

    let buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.append(this.actions_, timerContainer);
    this.toolbar_.append(buttonContainer);
  }

  resetToolbar_(opt_archive) {
    this.quickReplyOpen_ = false;
    this.toolbar_.textContent = '';
    this.toolbar_.style.backgroundColor = '';
    this.addButtons_();
    this.clearTimerOverlay_();
    this.restartTimer_();

    // Hackity hack. Check that it's actually true and not truthy because
    // sometimes opt_archive is a click event and we don't want to archive there.
    if (opt_archive === true)
      this.actions_.takeAction(Actions.ARCHIVE_ACTION);
  }

  shouldSuppressActions() {
    // Don't want key presses inside the quick reply to trigger actions, but
    // also don't want to trigger actions if the quick reply is accidentally blurred.
    if (this.quickReplyOpen_)
      return true;
    return super.shouldSuppressActions();
  }

  async takeAction(action, opt_e) {
    if (action == Actions.DONE_ACTION) {
      await router.run('/triaged');
      return;
    }

    if (action == Actions.QUICK_REPLY_ACTION) {
      this.quickReplyOpen_ = true;
      this.toolbar_.textContent = '';
      this.toolbar_.style.backgroundColor = 'white';
      this.cancelTimer_();

      this.showQuickReply(this.toolbar_, this.resetToolbar_.bind(this));
      return;
    }

    super.takeAction(action, opt_e);
  }

  async pushNeedsTriage(thread) {
    await this.threadList.push(thread);
    await this.updateQueueSummary_();

    if (!this.currentThread) {
      await this.renderNext();
    } else {
      this.prerenderNext();
    }
  }

  async onRenderNext() {
    this.resetToolbar_();
    this.updateQueueSummary_();
    this.timerPaused_ = this.autoStartTimer_ && this.currentThread;
    if (!this.currentThread)
      await router.run('/triaged');
  }

  async updateQueueSummary_() {
    if (this.currentThread) {
      let currentQueue = await this.currentThread.thread.getQueue();

      let queueData = '';
      let queues = this.threadList.queues();
      let prefetchQueue = null;
      if (this.prefetchedThread) {
        prefetchQueue = await this.prefetchedThread.thread.getQueue();
        if (!queues.includes(prefetchQueue))
          queueData += `<div>${Labels.removeNeedsTriagePrefix(prefetchQueue)}:&nbsp;1</div>`;
      }

      let currentCount = 0;
      for (let queue of queues) {
        let count = this.threadList.threadCountForQueue(queue);
        if (queue == prefetchQueue)
          count++;
        if (queue == currentQueue)
          currentCount = count;
        queueData += `<div>${Labels.removeNeedsTriagePrefix(queue)}:&nbsp;${count}</div>`;
      }

      let shortQueue = Labels.removeNeedsTriagePrefix(currentQueue);
      this.queueSummary.innerHTML = `<summary>${currentCount} left in ${shortQueue}</summary><div>${queueData}</div>`;
      this.queueSummary.style.display = '';
    } else {
      this.queueSummary.style.display = 'none';
    }
  }

  async dispatchShortcut(e) {
    this.actions_.dispatchShortcut(e);
  };

  onHide() {
    this.cancelTimer_();
    if (this.timerKey_) {
      clearTimeout(this.timerKey_);
      this.timerKey_ = null;
    }
  }

  onShow() {
    this.restartTimer_();
  }

  cancelTimer_() {
    this.timeLeft_ = -1;
  }

  restartTimer_() {
    if (this.timerOverlay_)
      return;

    if (this.timerPaused_) {
      this.timer_.textContent = '';
      return;
    }

    this.timeLeft_ = this.timeout_;
    if (this.timerKey_) {
      clearTimeout(this.timerKey_);
      this.timerKey_ = null;
    }
    this.nextTick_();
  }

  clearTimerOverlay_() {
    if (this.timerOverlay_) {
      this.timerOverlay_.remove();
      this.timerOverlay_ = null;
    }
  }

  async nextTick_() {
    if (this.timerPaused_ || this.timeLeft_ == -1) {
      this.timer_.textContent = '';
      return;
    }

    if (this.timeLeft_ == 0) {
      this.timer_.textContent = '';
      this.timerOverlay_ = document.createElement('div');
      this.timerOverlay_.style.cssText = `
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
      text.innerHTML = 'Out of time. Take an action!<br><br>The timer duration and whether it autostarts can be configured in the settings dialogs.';
      text.style.cssText = `
        position: absolute;
        padding: 5px;
        background-color: white;
      `;
      this.timerOverlay_.append(background, text);
      this.messages.append(this.timerOverlay_);
      return;
    }

    if (this.timeLeft_ > 20) {
      this.timer_.style.color = 'white';
    } else if (this.timeLeft_ > 5) {
      this.timer_.style.color = 'black';
    } else {
      this.timer_.style.color = 'red';
    }

    this.timer_.textContent = this.timeLeft_;
    this.timerKey_ = setTimeout(this.nextTick_.bind(this), 1000);
    this.timeLeft_--;
  }
}

ViewOne.ACTIONS_ = [
  Actions.ARCHIVE_ACTION,
  Actions.QUICK_REPLY_ACTION,
  Actions.BLOCKED_ACTION,
  Actions.MUTE_ACTION,
  Actions.MUST_DO_ACTION,
  Actions.URGENT_ACTION,
  Actions.NOT_URGENT_ACTION,
  Actions.DELEGATE_ACTION,
  Actions.UNDO_ACTION,
  Actions.DONE_ACTION,
];

ViewOne.OVERFLOW_ACTIONS_ = [
  Actions.SPAM_ACTION,
];

window.customElements.define('mt-view-one', ViewOne);
