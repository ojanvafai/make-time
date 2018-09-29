class AbstractSingleThreadView extends HTMLElement {
  constructor(threadList, allowedReplyLength, contacts, setSubject, updateTitle) {
    super();

    this.threadList = threadList;
    this.allowedReplyLength_ = allowedReplyLength;
    this.contacts_ = contacts;
    this.setSubject = setSubject;
    this.updateTitle_ = updateTitle;

    this.queueSummary = '';

    this.messages = document.createElement('div');
    this.messages.style.cssText = `
      position: relative;
    `;

    this.append(this.messages);
  }

  async tearDown() {
    this.setSubject('');

    threads_.setNeedsTriage([]);

    if (this.prefetchedThread)
      await this.threadList.push(this.prefetchedThread.thread);

    if (this.currentThread)
      await this.threadList.push(this.currentThread.thread);

    while (this.threadList.length) {
      threads_.pushNeedsTriage(this.threadList.pop());
    }
  }

  shouldSuppressActions() {
    if (!this.currentThread)
      return true;
    return false;
  }

  async takeAction(action, opt_e) {
    if (action == Actions.UNDO_ACTION) {
      this.undoLastAction_();
      return;
    }

    // renderNext changes this.currentThread so save off the thread to modify first.
    let thread = this.currentThread.thread;
    this.renderNext();

    this.lastAction_ = await thread.markTriaged(action.destination);
  }

  async undoLastAction_() {
    if (!this.lastAction_) {
      new ErrorDialog('Nothing left to undo.');
      return;
    }

    this.updateTitle_('undoLastAction_', 'Undoing last action...');

    let lastAction = this.lastAction_;
    this.lastAction_ = null;

    await this.requeuePrefetchedThread_();
    await this.threadList.push(this.currentThread.thread);
    await this.renderNext(lastAction.thread);
    await lastAction.thread.modify(lastAction.removed, lastAction.added);

    this.updateTitle_('undoLastAction_');
  }

  showQuickReply(container, opt_onClose) {
    let compose = new Compose(this.contacts_);
    compose.style.cssText = `
      flex: 1;
      margin: 4px;
      display: flex;
    `;
    compose.placeholder = 'Hit enter to send.';
    container.append(compose);

    if (opt_onClose) {
      let cancel = document.createElement('button');
      cancel.textContent = 'cancel';
      cancel.onclick = opt_onClose;
      container.append(cancel);

      compose.addEventListener('cancel', opt_onClose);
    }

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
    container.append(sideBar);

    compose.addEventListener('submit', async (e) => {
      if (!compose.value.length)
        return;

      if (compose.value.length > this.allowedReplyLength_) {
        new ErrorDialog(`Email is longer than the allowed length of ${this.allowedReplyLength_} characters. Allowed length is configurable in the settings spreadsheet as the allowed_reply_length setting.`);
        return;
      }

      if (this.isSending_)
        return;
      this.isSending_ = true;
      this.updateTitle_('sendReply', 'Sending reply...');

      await this.sendReply_(compose.value, compose.getEmails(), replyAll.checked);

      if (opt_onClose)
        opt_onClose(true);

      this.updateTitle_('sendReply');
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
    let messages = await this.currentThread.thread.getMessages();
    let lastMessage = messages[messages.length - 1];

    // Gmail will remove dupes for us.
    let to = lastMessage.from
    if (shouldReplyAll)
      to += ',' + lastMessage.to;

    if (extraEmails.length)
      to += ',' + extraEmails.join(',');

    let subject = lastMessage.subject;
    let replyPrefix = 'Re: ';
    if (subject && !subject.startsWith(replyPrefix))
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
        'threadId': this.currentThread.thread.id,
      }
    });
  }

  async requeuePrefetchedThread_() {
    if (!this.prefetchedThread)
      return;

    if (this.prefetchedThread.rendered)
      this.prefetchedThread.rendered.remove();
    await this.threadList.push(this.prefetchedThread.thread);
    this.prefetchedThread = null;
  }

  async renderNext(threadToRender) {
    if (threadToRender)
      await this.requeuePrefetchedThread_();

    if (this.currentThread && this.currentThread.rendered)
      this.currentThread.rendered.remove();

    this.currentThread = null;

    if (threadToRender) {
      this.currentThread = new RenderedThread(threadToRender);
    } else if (this.prefetchedThread) {
      this.currentThread = this.prefetchedThread;
      this.prefetchedThread = null;
    } else {
      let nextThread = this.threadList.pop();
      if (nextThread)
        this.currentThread = new RenderedThread(nextThread);
    }

    if (this.onRenderNext)
      this.onRenderNext();

    if (!this.currentThread)
      return;

    let messages = await this.currentThread.thread.getMessages();
    let subject = await this.currentThread.thread.getSubject();

    let viewInGmailButton = new ViewInGmailButton();
    viewInGmailButton.setMessageId(messages[messages.length - 1].id);
    viewInGmailButton.style.display = 'inline-flex';

    let subjectText = document.createElement('div');
    subjectText.style.flex = 1;
    subjectText.append(subject, viewInGmailButton);
    this.setSubject(subjectText, this.queueSummary);

    let rendered = await this.currentThread.render();
    if (rendered.parentNode) {
      // Adjust visibility if this was previously prerendered offscreen.
      this.currentThread.rendered.style.bottom = '';
      this.currentThread.rendered.style.visibility = 'visible';
    } else {
      this.messages.append(rendered);
    }

    var elementToScrollTo = document.querySelector('.unread') || this.currentThread.rendered.lastChild;
    elementToScrollTo.scrollIntoView();
    // Make sure that there's at least 50px of space above for showing that there's a
    // previous message.
    let y = elementToScrollTo.getBoundingClientRect().y;
    if (y < 70)
      document.documentElement.scrollTop -= 70 - y;

    await this.updateCurrentThread();
    this.prerenderNext();
  }

  async prerenderNext() {
    if (this.prefetchedThread)
      return;

    let thread = await this.threadList.pop();
    if (thread) {
      this.prefetchedThread = new RenderedThread(thread);
      let dom = await this.prefetchedThread.render();
      dom.style.bottom = '0';
      dom.style.visibility = 'hidden';
      this.messages.append(dom);
    }
  }

  async updateCurrentThread() {
    if (!this.currentThread)
      return;

    let hasNewMessages = await this.currentThread.thread.updateMessageDetails();
    if (hasNewMessages) {
      let renderedThread = await this.currentThread.render(true);
      this.messages.append(renderedThread);
    }
  }
}