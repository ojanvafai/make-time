class ThreadView extends HTMLElement {
  constructor(threadList, cleanupDelegate, updateCounter, blockedLabel, timeout, allowedReplyLength, contacts, showSummary) {
    super();
    this.style.display = 'block';
    this.style.position = 'relative';

    this.threadList_ = threadList;
    this.cleanupDelegate_ = cleanupDelegate;
    this.updateCounter_ = updateCounter;
    this.blockedLabel_ = blockedLabel;
    this.timeout_ = timeout;
    this.allowedReplyLength_ = allowedReplyLength;
    this.contacts_ = contacts;
    this.showSummary_ = showSummary;

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

  addButtons_() {
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
        let e = new Event('keydown');
        e.key = key;
        this.dispatchShortcut(e);
      };
      button.innerHTML = `<span class="shortcut">${name.charAt(0)}</span>${name.slice(1)}`;
      this.toolbar_.append(button);
    }
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
    else
      this.prerenderNext_();
  }

  async cleanup() {
    let threads = await currentView_.popAllThreads();
    this.cleanupDelegate_(threads);
  }

  async updateTitle_() {
    let title = [];

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

      title.push(`${leftInQueue} more in ${displayableQueue}, `);
      let viewAllLink = document.createElement('a');
      viewAllLink.textContent = `view all ${total}`;
      viewAllLink.onclick = (e) => {
        e.preventDefault();
        this.cleanup();
      };
      title.push(viewAllLink);

      let prefetchQueue = null;
      if (this.prefetchedThread_)
        prefetchQueue = await this.prefetchedThread_.getQueue();

      let queueData = '';
      let queues = this.threadList_.queues();

      if (!queues.includes(prefetchQueue))
        queueData += `<div>${removeTriagedPrefix(prefetchQueue)}:&nbsp;1</div>`;

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

    this.updateCounter_(title);
  }

  async dispatchShortcut(e) {
    // Don't want key presses inside the quick reply to trigger actions, but
    // also don't want to trigger actions if the quick reply is accidentally blurred.
    if (this.quickReplyOpen_)
      return;

    if (!navigator.onLine) {
      alert(`This action requires a network connection.`);
      return;
    }

    if (!this.currentThread_)
      return;

    if (e.key == 'u') {
      this.undoLastAction_();
      return;
    }

    if (e.key == 'q') {
      e.preventDefault();
      this.showQuickReply_();
      return;
    }

    // Oof. Gross hack because top-level await is not allowed.
    var destination = e.key == 'b' ? this.blockedLabel_ : ThreadView.KEY_TO_DESTINATION[e.key];
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

      await this.sendReply_(compose.value, compose.getEmails(), replyAll.checked);
      this.clearQuickReply_();
      // TODO: Don't depend on 'd' being the shortcut for Done.
      this.dispatchShortcut('d');

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
    let messages = await this.currentThread_.getMessages();
    let lastMessage = messages[messages.length - 1];

    // Gmail will remove dupes for us.
    let to = lastMessage.rawFrom
    if (shouldReplyAll)
      to += ',' + lastMessage.rawTo;

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

    if (shouldReplyAll && lastMessage.rawCc)
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

  async renderAllDone_() {
    this.currentThread_ = null;
    this.subjectText_.textContent = 'All Done! Nothing left to triage for now.';
    this.gmailLink_.textContent = '';
    this.messages_.textContent = '';
    this.timer_.textContent = '';

    if (!this.showSummary_)
      return;

    let labels = await getTheadCountForLabels(await getSettings(), (settings, labelId, labelName) => {
      return labelName != MUTED_LABEL && labelName.startsWith(TRIAGED_LABEL + '/');
    });

    for (let label of labels) {
      let link = document.createElement('a');
      link.className = 'label-button';
      link.href = `https://mail.google.com/mail/#label/${label.name}`;
      link.textContent = `${label.name}(${label.count})`;
      this.messages_.append(link);
    }
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

    // When transitioning from all done to having messages again, clear the all
    // done links.
    if (!this.currentThread_)
      this.messages_.textContent = '';

    this.currentThread_ = threadToRender || this.prefetchedThread_ || this.threadList_.pop();

    this.updateTitle_();
    this.subject_.style.top = this.offsetTop + 'px';

    if (!this.currentThread_) {
      await this.renderAllDone_();
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
      this.prerenderedThread_.style.bottom = '';
      this.prerenderedThread_.style.visibility = 'visible';
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
    if (this.prefetchedThread_)
      return;

    let thread = await this.threadList_.pop();
    this.prefetchedThread_ = thread;

    if (thread) {
      this.prerenderedThread_ = null;

      // Force update the list of messages in case any new messages have come in
      // since we first processed this thread.
      await thread.updateMessageDetails();

      // The await above can call this.prefetchedThread_ to actually be a later thread
      // if threads are being archived very quickly.
      if (thread != this.prefetchedThread_)
        return;

      this.prerenderedThread_ = await this.render_(thread);
      this.prerenderedThread_.style.bottom = '0';
      this.prerenderedThread_.style.visibility = 'hidden';
      this.messages_.append(this.prerenderedThread_);
    }
  }

  clearPrefetchedThread() {
    if (this.prerenderedThread_)
      this.prerenderedThread_ = null;
    this.prefetchedThread_ = null;
  }

  async updateCurrentThread() {
    if (!this.currentThread_)
      return;

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
      position: absolute;
      left: 0;
      right: 0;
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
    bodyContainer.append(processedMessage.getQuoteElidedMessage().getDom());

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
