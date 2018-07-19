class ThreadView extends HTMLElement {
  constructor(threadList, updateCounter, blockedLabel) {
    super();
    this.style.display = 'block';

    this.threadList_ = threadList;
    this.updateCounter_ = updateCounter;
    this.blockedLabel_ = blockedLabel;

    this.currentThread_ = null;

    this.subject_ = document.createElement('div');
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
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    `;
    this.toolbar_.style.cssText = `
      position: sticky;
      bottom: 0;
      left: 0;
      right: 0;
      text-align: center;
    `;
    this.append(this.subject_, this.messages_, this.toolbar_);

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
      this.renderNext_();
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

  async renderNext_(threadToRender) {
    this.currentThread_ = threadToRender || this.threadList_.pop();
    this.updateTitle_();

    this.subject_.style.top = this.offsetTop + 'px';

    if (!this.currentThread_) {
      this.subject_.textContent = 'All Done! Nothing left to triage for now.';
      this.messages_.textContent = '';
      return;
    }

    let subject = await this.currentThread_.getSubject() || '(no subject)';
    let url = `https://mail.google.com/mail/#inbox/${this.currentThread_.id}`;
    this.subject_.innerHTML = `<a href="${url}">${subject}</a>`;

    this.messages_.textContent = '';
    let messages = await this.currentThread_.getMessages();
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
  b: 'Blocked',
  m: 'Mute',
  a: 'Action Item',
  u: 'Undo',
};

window.customElements.define('mt-thread-view', ThreadView);
