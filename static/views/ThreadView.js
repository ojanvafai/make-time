class ThreadView extends HTMLElement {
  constructor(threadList, cleanupDelegate, updateCounter, timeout, allowedReplyLength, contacts, showSummary, allLabels) {
    super();
    this.style.display = 'block';
    this.style.position = 'relative';

    this.threadList_ = threadList;
    this.cleanupDelegate_ = cleanupDelegate;
    this.updateCounter_ = updateCounter;
    this.timeout_ = timeout;
    this.allowedReplyLength_ = allowedReplyLength;
    this.contacts_ = contacts;
    this.showSummary_ = showSummary;
    this.allLabels_ = allLabels;

    this.gmailLink_ = new ViewInGmailButton();
    this.gmailLink_.style.position = 'absolute';
    this.gmailLink_.style.right = '4px';

    this.subject_ = document.createElement('div');
    this.subjectText_ = document.createElement('div');
    this.subjectText_.style.cssText = `
      flex: 1;
      margin-right: 25px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    `;
    this.subject_.append(this.gmailLink_, this.subjectText_);

    this.messages_ = document.createElement('div');
    this.messages_.style.cssText = `
      position: relative;
    `;

    this.toolbar_ = document.createElement('div');

    // Take up space for the position:fixed subject.
    let subjectPlaceholder = document.createElement('div');
    subjectPlaceholder.textContent = '\xa0';

    subjectPlaceholder.style.cssText = this.subject_.style.cssText = `
      position: fixed;
      left: 0;
      right: 0;
      font-size: 18px;
      padding: 2px;
      background-color: #ccc;
      text-align: center;
      z-index: 100;
    `;
    subjectPlaceholder.style.position = 'static';

    this.toolbar_.className = 'footer';

    this.queueSummary_ = document.createElement('div');
    this.queueSummary_.style.cssText = `
      background-color: white;
      position: fixed;
      bottom: 50px;
      font-size: 10px;
      right: 4px;
      text-align: right;
      opacity: 0.5;
    `;

    this.append(this.subject_, subjectPlaceholder, this.messages_, this.toolbar_, this.queueSummary_);

    this.addButtons_();

    // Hack: Do this on a timer so that the ThreadView is in the DOM before renderNext_
    // is called and tries to get offsetTop. This happens when going from the Vueue back
    // to the ThreadView.
    setTimeout(this.renderNext_.bind(this));
  }

  finishedInitialLoad() {}

  addButtons_() {
    this.timer_ = document.createElement('span');
    this.timer_.style.cssText = `
      border-radius: 5px;
    `;

    let timerContainer = document.createElement('div');
    timerContainer.style.cssText = `
      position: absolute;
      right: 4px;
      font-size: 32px;
      padding: 5px;
    `;
    let timerButton = document.createElement('span');
    timerContainer.append(this.timer_, '\xa0', timerButton);

    this.timerPaused_ = true;
    let updatePlayButton = () => {
      timerButton.textContent = this.timerPaused_ ? '▶️' : '⏸️';
    }
    updatePlayButton();
    timerContainer.onclick = () => {
      this.timerPaused_ = !this.timerPaused_;
      updatePlayButton();
      this.restartTimer_();
    }

    this.toolbar_.append(timerContainer);
    this.actions_ = new Actions(this, ThreadView.ACTIONS_);
    this.toolbar_.append(this.actions_);
  }

  async popAllThreads() {
    let threads = [];

    if (this.prefetchedThread_)
      await this.threadList_.push(this.prefetchedThread_.thread);

    if (this.currentThread_)
      await this.threadList_.push(this.currentThread_.thread);

    while (this.threadList_.length) {
      threads.push(this.threadList_.pop());
    }

    return threads;
  }

  async push(thread) {
    await this.threadList_.push(thread);
    await this.updateTitle_();

    if (!this.currentThread_) {
      // When transitioning from all done to having messages again, clear the all
      // done links.
      this.messages_.textContent = '';
      await this.renderNext_();
    } else {
      this.prerenderNext_();
    }
  }

  async cleanup() {
    let threads = await currentView_.popAllThreads();
    this.cleanupDelegate_(threads);
  }

  async updateTitle_() {
    let title = [];

    if (this.currentThread_) {
      let displayableQueue = await this.currentThread_.thread.getDisplayableQueue();
      let currentThreadQueue = await this.currentThread_.thread.getQueue();
      let leftInQueue = this.threadList_.threadCountForQueue(currentThreadQueue);
      let total = this.threadList_.length;

      let queueData = '';
      let queues = this.threadList_.queues();
      let prefetchQueue = null;
      if (this.prefetchedThread_) {
        prefetchQueue = await this.prefetchedThread_.thread.getQueue();
        if (!queues.includes(prefetchQueue))
          queueData += `<div>${Labels.removeNeedsTriagePrefix(prefetchQueue)}:&nbsp;1</div>`;
        if (prefetchQueue == currentThreadQueue)
          leftInQueue += 1;
        total += 1;
      }

      title.push(`${leftInQueue} more in ${displayableQueue}, `);
      let viewAllLink = document.createElement('a');
      viewAllLink.textContent = `view all ${total}`;
      viewAllLink.onclick = (e) => {
        e.preventDefault();
        this.cleanup();
      };
      title.push(viewAllLink);

      for (let queue of queues) {
        let count = this.threadList_.threadCountForQueue(queue);
        if (queue == prefetchQueue)
          count++;
        queueData += `<div>${Labels.removeNeedsTriagePrefix(queue)}:&nbsp;${count}</div>`;
      }
      this.queueSummary_.innerHTML = queueData;
    } else {
      this.queueSummary_.innerHTML = '';
    }

    this.updateCounter_(title);
  }

  async dispatchShortcut(e) {
    this.actions_.dispatchShortcut(e);
  };

  shouldSuppressActions() {
    // Don't want key presses inside the quick reply to trigger actions, but
    // also don't want to trigger actions if the quick reply is accidentally blurred.
    if (this.quickReplyOpen_)
      return true;
    if (!this.currentThread_)
      return true;
    return false;
  }

  async takeAction(action, opt_e) {
    if (action == Actions.UNDO_ACTION) {
      this.undoLastAction_();
      return;
    }

    if (action == Actions.QUICK_REPLY_ACTION) {
      this.showQuickReply_();
      return;
    }

    // renderNext_ changes this.currentThread_ so save off the thread to modify first.
    let thread = this.currentThread_.thread;
    this.renderNext_();
    this.lastAction_ = await thread.markTriaged(action.destination);
  }

  async undoLastAction_() {
    if (!this.lastAction_) {
      alert('Nothing left to undo.');
      return;
    }

    updateTitle('undoLastAction_', 'Undoing last action...', true);

    let lastAction = this.lastAction_;
    this.lastAction_ = null;

    await this.requeuePrefetchedThread_();
    await this.threadList_.push(this.currentThread_.thread);
    await this.renderNext_(lastAction.thread);
    await lastAction.thread.modify(lastAction.removed, lastAction.added);

    updateTitle('undoLastAction_');
  }

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

  clearQuickReply_() {
    this.quickReplyOpen_ = false;
    this.toolbar_.textContent = '';
    this.toolbar_.style.backgroundColor = '';
    this.addButtons_();
    this.restartTimer_();
  }

  showQuickReply_() {
    this.quickReplyOpen_ = true;
    this.toolbar_.textContent = '';
    this.toolbar_.style.backgroundColor = 'white';
    this.cancelTimer_();

    let compose = new Compose(this.contacts_);
    compose.style.cssText = `
      flex: 1;
      margin: 4px;
      display: flex;
    `;
    compose.placeholder = 'Hit enter to send.';

    let cancel = document.createElement('button');
    cancel.textContent = 'cancel';
    cancel.onclick = this.clearQuickReply_.bind(this);

    let sideBar = document.createElement('div');
    sideBar.style.cssText = `margin: 4px;`;

    let replyAllLabel = document.createElement('label');
    let replyAll = document.createElement('input');
    replyAll.type = 'checkbox';
    replyAll.checked = true;
    replyAllLabel.append(replyAll, 'reply all');

    let progressContainer = document.createElement('div');
    progressContainer.style.cssText = `
      display: flex;
      align-items: center;
    `;

    let progress = document.createElement('progress');
    progress.style.cssText = `
      flex: 1;
      width: 0;
    `;
    progress.max = this.allowedReplyLength_;
    progress.value = 0;

    let count = document.createElement('div');
    count.style.cssText = `
      margin: 4px;
      color: red;
    `;

    progressContainer.append(count, progress);

    sideBar.append(replyAllLabel, progressContainer);

    this.toolbar_.append(compose, cancel, sideBar);

    compose.addEventListener('cancel', this.clearQuickReply_.bind(this));

    compose.addEventListener('submit', async (e) => {
      if (!compose.value.length)
        return;

      if (compose.value.length > this.allowedReplyLength_) {
        alert(`Email is longer than the allowed length of ${this.allowedReplyLength_} characters. Allowed length is configurable in the settings spreadsheet as the allowed_reply_length setting.`);
        return;
      }

      if (this.isSending_)
        return;
      this.isSending_ = true;
      updateTitle('sendReply', 'Sending reply...', true);

      await this.sendReply_(compose.value, compose.getEmails(), replyAll.checked);
      this.clearQuickReply_();
      this.actions_.takeAction(Actions.DONE_ACTION);

      updateTitle('sendReply');
      this.isSending_ = false;
    })

    compose.addEventListener('input', (e) => {
      progress.value = compose.value.length;
      let lengthDiff = this.allowedReplyLength_ - compose.value.length;
      let exceedsLength = compose.value.length >= (this.allowedReplyLength_ - 10);
      count.textContent = (lengthDiff < 10) ? lengthDiff : '';
    });

    compose.focus();
  }

  async sendReply_(replyText, extraEmails, shouldReplyAll) {
    let messages = await this.currentThread_.thread.getMessages();
    let lastMessage = messages[messages.length - 1];

    // Gmail will remove dupes for us.
    let to = lastMessage.from
    if (shouldReplyAll)
      to += ',' + lastMessage.to;

    if (extraEmails.length)
      to += ',' + extraEmails.join(',');

    let subject = lastMessage.subject;
    let replyPrefix = 'Re: ';
    if (!subject.startsWith(replyPrefix))
      subject = replyPrefix + subject;

    let email = `Subject: ${subject}
In-Reply-To: ${lastMessage.messageId}
To: ${to}
Content-Type: text/html; charset="UTF-8"
`;

    if (shouldReplyAll && lastMessage.cc)
      email += `Cc: ${lastMessage.cc}\n`;

    email += `
  ${replyText}<br><br>${lastMessage.from} wrote:<br>
  <blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">
    ${lastMessage.getHtmlOrPlain()}
  </blockquote>`;

    let base64 = new Base64();
    let response = await gapiFetch(gapi.client.gmail.users.messages.send, {
      'userId': USER_ID,
      'resource': {
        'raw': base64.encode(email),
        'threadId': this.currentThread_.thread.id,
      }
    });
  }

  async nextTick_() {
    if (this.timerPaused_ || this.timeLeft_ == -1) {
      this.timer_.textContent = '';
      return;
    }

    if (this.timeLeft_ == 0) {
      this.timer_.textContent = '';
      let overlay = document.createElement('div');
      overlay.style.cssText = `
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
      text.innerHTML = 'Out of time. Take an action!<br><br>Use the "timeout" setting in the config sheet to configure this. Use -1 to disable.';
      text.style.cssText = `
        position: absolute;
        padding: 5px;
        background-color: white;
      `;
      overlay.append(background, text);
      this.messages_.append(overlay);
      return;
    }

    if (this.timeLeft_ > 5) {
      this.timer_.style.color = 'black';
      this.timer_.style.backgroundColor =  'white';
    } else {
      this.timer_.style.color = 'white';
      this.timer_.style.backgroundColor =  'red';
    }

    this.timer_.textContent = this.timeLeft_;
    this.timerKey_ = setTimeout(this.nextTick_.bind(this), 1000);
    this.timeLeft_--;
  }

  async renderAllDone_() {
    this.subjectText_.textContent = 'All Done! Nothing left to triage for now.';
    this.gmailLink_.style.display = 'none';
    this.messages_.textContent = '';
    this.timer_.textContent = '';

    if (this.showSummary_)
      this.messages_.append(new TriagedQueues(this.allLabels_));
  }

  async requeuePrefetchedThread_() {
    if (!this.prefetchedThread_)
      return;

    if (this.prefetchedThread_.rendered)
      this.prefetchedThread_.rendered.remove();
    await this.threadList_.push(this.prefetchedThread_.thread);
    this.prefetchedThread_ = null;
  }

  async renderNext_(threadToRender) {
    this.clearQuickReply_();

    if (threadToRender)
      await this.requeuePrefetchedThread_();

    if (this.currentThread_ && this.currentThread_.rendered)
      this.currentThread_.rendered.remove();

    this.currentThread_ = null;

    if (threadToRender) {
      this.currentThread_ = new RenderedThread(threadToRender);
    } else if (this.prefetchedThread_) {
      this.currentThread_ = this.prefetchedThread_;
      this.prefetchedThread_ = null;
    } else {
      let nextThread = this.threadList_.pop();
      if (nextThread)
        this.currentThread_ = new RenderedThread(nextThread);
    }

    this.updateTitle_();
    this.subject_.style.top = this.offsetTop + 'px';

    if (!this.currentThread_) {
      await this.renderAllDone_();
      return;
    }

    let messages = await this.currentThread_.thread.getMessages();

    this.gmailLink_.display = 'flex';
    this.gmailLink_.setMessageId(messages[messages.length - 1].id);

    this.subjectText_.textContent = await this.currentThread_.thread.getSubject() || '(no subject)';

    let rendered = await this.currentThread_.render();
    if (rendered.parentNode) {
      // Adjust visibility if this was previously prerendered offscreen.
      this.currentThread_.rendered.style.bottom = '';
      this.currentThread_.rendered.style.visibility = 'visible';
    } else {
      this.messages_.append(rendered);
    }

    var elementToScrollTo = document.querySelector('.unread') || this.currentThread_.rendered.lastChild;
    elementToScrollTo.scrollIntoView();
    // Make sure that there's at least 50px of space above for showing that there's a
    // previous message.
    let y = elementToScrollTo.getBoundingClientRect().y;
    if (y < 70)
      document.documentElement.scrollTop -= 70 - y;

    await this.updateCurrentThread();
    this.prerenderNext_();
  }

  async prerenderNext_() {
    if (this.prefetchedThread_)
      return;

    let thread = await this.threadList_.pop();
    if (thread) {
      this.prefetchedThread_ = new RenderedThread(thread);
      let dom = await this.prefetchedThread_.render();
      dom.style.bottom = '0';
      dom.style.visibility = 'hidden';
      this.messages_.append(dom);
    }
  }

  async updateCurrentThread() {
    if (!this.currentThread_)
      return;

    let hasNewMessages = await this.currentThread_.thread.updateMessageDetails();
    if (hasNewMessages) {
      let renderedThread = await this.currentThread_.render(true);
      this.messages_.append(renderedThread);
    }
  }
}

ThreadView.ACTIONS_ = [
  Actions.DONE_ACTION,
  Actions.TLDR_ACTION,
  Actions.REPLY_NEEDED_ACTION,
  Actions.QUICK_REPLY_ACTION,
  Actions.BLOCKED_ACTION,
  Actions.MUTE_ACTION,
  Actions.ACTION_ITEM_ACTION,
  Actions.SPAM_ACTION,
  Actions.UNDO_ACTION,
];

window.customElements.define('mt-thread-view', ThreadView);
