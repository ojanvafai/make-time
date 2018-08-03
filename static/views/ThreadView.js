class ThreadView extends HTMLElement {
  constructor(threadList, updateCounter, blockedLabel, timeout, allowedReplyLength) {
    super();
    this.style.display = 'block';

    this.threadList_ = threadList;
    this.updateCounter_ = updateCounter;
    this.blockedLabel_ = blockedLabel;
    this.timeout_ = timeout;
    this.allowedReplyLength_ = allowedReplyLength;

    this.currentThread_ = null;

    this.subject_ = document.createElement('div');
    this.gmailLink_ = document.createElement('a');
    this.subjectText_ = document.createElement('div');
    this.subjectText_.style.cssText = `
      flex: 1;
      margin-right: 25px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    `;
    this.subject_.append(this.subjectText_, this.gmailLink_);

    this.messages_ = document.createElement('div');
    this.toolbar_ = document.createElement('div');

    // TODO: Move this to a stylesheet.
    this.subject_.style.cssText = `
      position: sticky;
      left: 0;
      right: 0;
      background-color: white;
      font-size: 18px;
      padding: 2px;
      background-color: #eee;
      display: flex;
    `;
    this.toolbar_.style.cssText = `
      position: sticky;
      bottom: 0;
      left: 0;
      right: 0;
      text-align: center;
    `;

    this.timer_ = document.createElement('div');
    this.timer_.style.cssText = `
      width: 1em;
      height: 1em;
      color: red;
      fill: blue;
    `;

    let timerContainer = document.createElement('div');
    timerContainer.style.cssText = `
      position: fixed;
      right: 0;
      bottom: 0;
      font-size: 36px;
      padding: 5px;
    `;
    let timerButton = document.createElement('div');
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

    this.append(this.subject_, this.messages_, this.toolbar_, timerContainer);

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
  }

  async updateTitle_() {
    let text = '';

    if (this.currentThread_) {
      let displayableQueue = await this.currentThread_.getDisplayableQueue();
      let queue = await this.currentThread_.getQueue();
      let leftInQueue = this.threadList_.threadCountForQueue(queue);
      text = `${leftInQueue} threads left in ${displayableQueue}, ${this.threadList_.length} total`;
    }

    this.updateCounter_(text);
  }

  async dispatchShortcut(key) {
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

    this.quickReply_.append(text, cancel, progress, count);
    this.toolbar_.append(this.quickReply_);

    text.addEventListener('keydown', async (e) => {
      e.stopPropagation();

      if (e.key == 'Escape') {
        this.clearQuickReply_();
        return;
      }

      if (e.key == 'Enter') {
        if (text.value.length >= this.allowedReplyLength_) {
          alert(`Email is longer than the allowed length of ${this.allowedReplyLength_} characters. Which is configurable in the settings spreadsheet as the allowed_reply_length setting.`);
          return;
        }
        await this.sendReply_(text.value);
        // TODO: Don't depend on 'd' being the shortcut for Done.
        this.dispatchShortcut('d');
        return;
      }

      let lengthDiff = this.allowedReplyLength_ - text.value.length;
      let exceedsLength = text.value.length >= (this.allowedReplyLength_ - 10);
      count.textContent = (lengthDiff < 10) ? lengthDiff : '';

      progress.value = text.value.length;
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
    ${lastMessage.html || lastMessage.plain}
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

    this.timer_.textContent = this.timeLeft_;
    this.timerKey_ = setTimeout(this.nextTick_.bind(this), 1000);
    this.timeLeft_--;
  }

  async renderNext_(threadToRender) {
    this.clearQuickReply_();
    this.currentThread_ = threadToRender || this.threadList_.pop();
    this.updateTitle_();

    this.subject_.style.top = this.offsetTop + 'px';

    if (!this.currentThread_) {
      this.subjectText_.textContent = 'All Done! Nothing left to triage for now.';
      this.gmailLink_.textContent = '';
      this.messages_.textContent = '';
      this.timer_.textContent = '';
      return;
    }

    this.subjectText_.textContent = await this.currentThread_.getSubject() || '(no subject)';

    let messages = await this.currentThread_.getMessages();

    // In theory, linking to the threadId should work, but it doesn't for some threads.
    // Linking to the messageId seems to work reliably. The message ID listed will be expanded
    // in the gmail UI, so link to the last one since that one is definitionally always expanded.
    this.gmailLink_.textContent = 'view in gmail';
    this.gmailLink_.href = `https://mail.google.com/mail/#all/${messages[messages.length - 1].id}`;

    this.messages_.textContent = '';
    var lastMessageElement;
    for (var message of messages) {
      lastMessageElement = this.renderMessage_(message);
      this.messages_.append(lastMessageElement);
    }

    var elementToScrollTo = document.querySelector('.unread') || lastMessageElement;
    elementToScrollTo.scrollIntoView();
    // Make sure that there's at least 50px of space above for showing that there's a
    // previous message.
    let y = elementToScrollTo.getBoundingClientRect().y;
    if (y < 70)
      document.documentElement.scrollTop -= 70 - y;

    this.threadList_.prefetchFirst();
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
    bodyContainer.innerHTML = processedMessage.processedHtml;

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
