class ThreadView extends HTMLElement {
  constructor(threadList, updateCounter, blockedLabel, timeout, allowedReplyLength) {
    super();
    this.style.display = 'block';
    this.style.position = 'relative';

    this.threadList_ = threadList;
    this.updateCounter_ = updateCounter;
    this.blockedLabel_ = blockedLabel;
    this.timeout_ = timeout;
    this.allowedReplyLength_ = allowedReplyLength;

    this.currentThread_ = null;

    this.subject_ = document.createElement('div');
    this.gmailLink_ = document.createElement('a');
    this.gmailLink_.style.cssText = `
      position: absolute;
      right: 4px;
    `;
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

    // TODO: Move this to a stylesheet.
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

    this.toolbar_.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      text-align: center;
    `;

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

    this.timer_ = document.createElement('span');
    this.timer_.style.cssText = `
      width: 1em;
      height: 1em;
      color: red;
      fill: blue;
    `;

    let timerContainer = document.createElement('div');
    timerContainer.style.cssText = `
      position: absolute;
      right: 4px;
      font-size: 32px;
      padding: 5px;
    `;
    let timerButton = document.createElement('span');
    timerContainer.append(this.timer_, timerButton);

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

    for (let key in ThreadView.KEY_TO_BUTTON_NAME) {
      let name = ThreadView.KEY_TO_BUTTON_NAME[key];
      let button = document.createElement('button');
      button.onclick = () => {
        this.dispatchShortcut(key);
      };
      button.innerHTML = `<span class="shortcut">${name.charAt(0)}</span>${name.slice(1)}`;
      this.toolbar_.append(button);
    }

    // Hack: Do this on a timer so that the ThreadView is in the DOM before renderNext_
    // is called and tries to get offsetTop. This happens when going from the Vueue back
    // to the ThreadView.
    setTimeout(this.renderNext_.bind(this));
  }

  setTimerBackground_() {
    if (this.timerPaused_) {
      this.timer_.style.backgroundImage = '';
    } else {
      this.timer_.style.backgroundImage = '';
    }
  }

  async popAllThreads() {
    let threads = [];

    if (this.prefetchedThread_)
      await this.threadList_.push(this.prefetchedThread_);

    if (this.currentThread_)
      await this.threadList_.push(this.currentThread_);

    while (this.threadList_.length) {
      threads.push(this.threadList_.pop());
    }

    return threads;
  }

  async push(thread) {
    await this.threadList_.push(thread);
    await this.updateTitle_();

    if (!this.currentThread_)
      await this.renderNext_();
    else if (!this.prefetchedThread_)
      this.prerenderNext_();
  }

  async updateTitle_() {
    let text = '';

    if (this.currentThread_) {
      let displayableQueue = await this.currentThread_.getDisplayableQueue();
      let currentThreadQueue = await this.currentThread_.getQueue();
      let leftInQueue = this.threadList_.threadCountForQueue(currentThreadQueue);
      let total = this.threadList_.length;
      if (this.prefetchedThread_) {
        let preftechQueue = await this.prefetchedThread_.getQueue();
        if (preftechQueue == currentThreadQueue)
          leftInQueue += 1;
        total += 1;
      }

      text = `${leftInQueue} more in ${displayableQueue}, ${total} total`;

      let prefetchQueue = null;
      if (this.prefetchedThread_)
        prefetchQueue = await this.prefetchedThread_.getQueue();

      let queueData = '';
      let queues = this.threadList_.queues();
      for (let queue of queues) {
        let count = this.threadList_.threadCountForQueue(queue);
        if (queue == prefetchQueue)
          count++;
        queueData += `<div>${removeTriagedPrefix(queue)}:&nbsp;${count}</div>`;
      }
      this.queueSummary_.innerHTML = queueData;
    } else {
      this.queueSummary_.innerHTML = '';
    }

    this.updateCounter_(text);
  }

  async dispatchShortcut(key) {
    // Don't want key presses inside the quick reply to trigger actions, but
    // also don't want to trigger actions if the quick reply is accidentally blurred.
    if (this.quickReply_)
      return;

    if (!navigator.onLine) {
      alert(`This action requires a network connection.`);
      return;
    }

    if (!this.currentThread_)
      return;

    if (key == 'u') {
      this.undoLastAction_();
      return;
    }

    if (key == 'q') {
      this.showQuickReply_();
      return;
    }

    // Oof. Gross hack because top-level await is not allowed.
    var destination = key == 'b' ? this.blockedLabel_ : ThreadView.KEY_TO_DESTINATION[key];
    if (destination !== undefined) {
      // renderNext_ changes this.currentThread_ so save off the thread to modify first.
      let thread = this.currentThread_;
      this.renderNext_();
      this.lastAction_ = await thread.markTriaged(destination);
    }
  };

  async undoLastAction_() {
    if (!this.lastAction_)
      return;

    showLoader(true);
    updateTitle('Undoing last action...');
    await this.threadList_.push(this.currentThread_);
    await this.renderNext_(this.lastAction_.thread);
    await this.lastAction_.thread.modify(this.lastAction_.removed, this.lastAction_.added);
    showLoader(false);
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
    if (this.quickReply_) {
      this.quickReply_.remove();
      this.quickReply_ = null;
    }
    this.restartTimer_();
  }

  showQuickReply_() {
    if (this.quickReply_)
      return;

    this.cancelTimer_();
    this.quickReply_ = document.createElement('div');
    this.quickReply_.style.cssText = `
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      background-color: white;
      display: flex;
      align-items: center;
    `;

    let text = document.createElement('input');
    text.style.cssText = `flex: 1; padding: 8px; margin: 4px;`;
    text.placeholder = 'Hit enter to send.';

    let cancel = document.createElement('button');
    cancel.textContent = 'cancel';
    cancel.onclick = this.clearQuickReply_.bind(this);

    let progress = document.createElement('progress');
    progress.style.cssText = `width: 50px;`;
    progress.max = this.allowedReplyLength_;
    progress.value = 0;

    let count = document.createElement('div');
    count.style.cssText = `
      margin: 4px;
      color: red;
    `;

    this.quickReply_.append(text, cancel, count, progress);
    this.toolbar_.append(this.quickReply_);

    text.addEventListener('keydown', async (e) => {
      switch (e.key) {
      case 'Escape':
        this.clearQuickReply_();
        return;

      case 'Enter':
        if (text.value.length >= this.allowedReplyLength_) {
          alert(`Email is longer than the allowed length of ${this.allowedReplyLength_} characters. Which is configurable in the settings spreadsheet as the allowed_reply_length setting.`);
          return;
        }
        await this.sendReply_(text.value);
        // TODO: Don't depend on 'd' being the shortcut for Done.
        this.dispatchShortcut('d');
        return;
      }
    });

    text.addEventListener('input', async (e) => {
      progress.value = text.value.length;
      let lengthDiff = this.allowedReplyLength_ - text.value.length;
      let exceedsLength = text.value.length >= (this.allowedReplyLength_ - 10);
      count.textContent = (lengthDiff < 10) ? lengthDiff : '';
    });

    text.focus();
  }

  async sendReply_(replyText) {
    let messages = await this.currentThread_.getMessages();
    let lastMessage = messages[messages.length - 1];

    // Gmail will remove dupes for us.
    let to = lastMessage.rawFrom + ',' + lastMessage.rawTo;

    let subject = lastMessage.subject;
    let replyPrefix = 'Re: ';
    if (!subject.startsWith(replyPrefix))
      subject = replyPrefix + subject;

    let email = `Subject: ${subject}
In-Reply-To: ${lastMessage.messageId}
To: ${to}
Content-Type: text/html; charset="UTF-8"
`;

    if (lastMessage.rawCc)
      email += `Cc: ${lastMessage.rawCc}\n`;

    email += `
  ${replyText}<br><br>${lastMessage.rawFrom} wrote:<br>
  <blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">
    ${lastMessage.getHtmlOrPlain()}
  </blockquote>`;

    let base64 = new Base64();
    let response = await gapiFetch(gapi.client.gmail.users.messages.send, {
      'userId': USER_ID,
      'resource': {
        'raw': base64.encode(email),
        'threadId': this.currentThread_.id,
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

    this.timer_.textContent = this.timeLeft_ + '\xa0';
    this.timerKey_ = setTimeout(this.nextTick_.bind(this), 1000);
    this.timeLeft_--;
  }

  async renderNext_(threadToRender) {
    this.clearQuickReply_();

    if (threadToRender) {
      if (this.prerenderedThread_)
        this.prerenderedThread_.remove();
      // Requeue the prefetched thread.
      if (this.prefetchedThread_) {
        this.threadList_.push(this.prefetchedThread_);
        this.clearPrefetchedThread();
      }
    }

    this.currentThread_ = threadToRender || this.prefetchedThread_ || this.threadList_.pop();

    this.updateTitle_();
    this.subject_.style.top = this.offsetTop + 'px';

    if (!this.currentThread_) {
      this.subjectText_.textContent = 'All Done! Nothing left to triage for now.';
      this.gmailLink_.textContent = '';
      this.messages_.textContent = '';
      this.timer_.textContent = '';
      return;
    }

    let messages = await this.currentThread_.getMessages();

    // In theory, linking to the threadId should work, but it doesn't for some threads.
    // Linking to the messageId seems to work reliably. The message ID listed will be expanded
    // in the gmail UI, so link to the last one since that one is definitionally always expanded.
    this.gmailLink_.textContent = 'view in gmail';
    this.gmailLink_.href = `https://mail.google.com/mail/#all/${messages[messages.length - 1].id}`;

    this.subjectText_.textContent = await this.currentThread_.getSubject() || '(no subject)';

    if (this.prerenderedThread_) {
      this.currentlyRendered_.remove();
      this.prerenderedThread_.style.left = 0;
      this.prerenderedThread_.style.height = 'auto';
      this.prerenderedThread_.style.overflow = 'visible';
    }

    this.currentlyRendered_ = this.prerenderedThread_ || await this.renderCurrent_();
    this.clearPrefetchedThread();

    var elementToScrollTo = document.querySelector('.unread') || this.currentlyRendered_.lastChild;
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
    this.prefetchedThread_ = await this.threadList_.pop();

    if (this.prefetchedThread_) {
      this.prerenderedThread_ = null;

      // Force update the list of messages in case any new messages have come in
      // since we first processed this thread.
      await this.prefetchedThread_.updateMessageDetails();
      this.prerenderedThread_ = await this.render_(this.prefetchedThread_);
      this.prerenderedThread_.style.left = '-2000px';
      this.prerenderedThread_.style.height = 0;
      this.prerenderedThread_.style.overflow = 'auto';
      this.messages_.append(this.prerenderedThread_);
    }
  }

  clearPrefetchedThread() {
    if (this.prerenderedThread_)
      this.prerenderedThread_ = null;
    this.prefetchedThread_ = null;
  }

  async updateCurrentThread() {
    let hasNewMessages = await this.currentThread_.updateMessageDetails();
    if (hasNewMessages)
      await this.renderCurrent_();
  }

  async renderCurrent_() {
    let renderedThread = await this.render_(this.currentThread_);
    if (this.currentlyRendered_)
      this.currentlyRendered_.remove();
    this.currentlyRendered_ = renderedThread;
    this.messages_.append(renderedThread);
    return renderedThread;
  }

  async render_(thread) {
    let messages = await thread.getMessages();
    let container = document.createElement('div');
    container.style.cssText = `
      background-color: white;
      position: relative;
      top: 0;
      max-width: 1000px;
    `;
    for (var message of messages) {
      container.append(this.renderMessage_(message));
    }
    return container;
  }

  dateString_(date) {
    if (date.toDateString() == new Date().toDateString())
      return date.toLocaleTimeString();
    return date.toLocaleString();
  }

  renderMessage_(processedMessage) {
    var messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.classList.add(processedMessage.isUnread ? 'unread' : 'read');

    let dateDiv = document.createElement('div');
    dateDiv.classList.add('date');
    dateDiv.textContent = this.dateString_(processedMessage.date);

    var headerDiv = document.createElement('div');
    headerDiv.classList.add('headers');

    let addresses = `from: ${processedMessage.from}`;
    if (processedMessage.to)
      addresses += `\nto: ${processedMessage.to}`;
    if (processedMessage.cc)
      addresses += `\ncc: ${processedMessage.cc}`;
    if (processedMessage.bcc)
      addresses += `\nbcc: ${processedMessage.bcc}`;
    let addressDiv = document.createElement('div');
    addressDiv.textContent = addresses;

    headerDiv.append(dateDiv, addressDiv)

    var bodyContainer = document.createElement('div');
    bodyContainer.classList.add('message-body');
    bodyContainer.style.overflow = 'auto';
    bodyContainer.innerHTML = processedMessage.getProcessedHtml();

    messageDiv.append(headerDiv, bodyContainer);
    return messageDiv;
  }
}

ThreadView.KEY_TO_DESTINATION = {
  d: null, // No destination label for DONE
  t: READ_LATER_LABEL,
  r: NEEDS_REPLY_LABEL,
  m: MUTED_LABEL,
  a: ACTION_ITEM_LABEL,
};

ThreadView.KEY_TO_BUTTON_NAME = {
  d: 'Done',
  t: 'TL;DR',
  r: 'Reply Needed',
  q: 'Quick Reply',
  b: 'Blocked',
  m: 'Mute',
  a: 'Action Item',
  u: 'Undo',
};

window.customElements.define('mt-thread-view', ThreadView);
