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

  get threadList() {
    return this.threadList_;
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

    // Oof. Gross hack because top-level await is not allowed.
    var destination = key == 'b' ? this.blockedLabel_ : ThreadView.KEY_TO_DESTINATION[key];
    if (destination !== undefined) {
      this.currentThread_.markTriaged(destination);
      await this.renderNext_();
    }
  };

  async renderNext_() {
    this.currentThread_ = this.threadList_.pop();
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

  renderMessage_(processedMessage) {
    var messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.classList.add(processedMessage.isUnread ? 'unread' : 'read');

    var headerDiv = document.createElement('div');
    headerDiv.classList.add('headers');
    headerDiv.textContent = `From: ${processedMessage.from}`;

    var bodyContainer = document.createElement('div');
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
};

window.customElements.define('mt-thread-view', ThreadView);
