import {defined} from './Base.js';
import {CancelEvent, EmailCompose, SubmitEvent} from './EmailCompose.js';
import {RadialProgress} from './RadialProgress.js';
import {SendAs} from './SendAs.js';
import {ReplyType, Thread} from './Thread.js';
import {AppShell} from './views/AppShell.js';

export class ReplyCloseEvent extends Event {
  static NAME = 'close';
  constructor() {
    super(ReplyCloseEvent.NAME);
  }
}

export class ShowLastMessageEvent extends Event {
  static NAME = 'show-last-message';
  constructor() {
    super(ShowLastMessageEvent.NAME);
  }
}

export class ReplyScrollEvent extends Event {
  static NAME = 'reply-scroll';
  constructor() {
    super(ReplyScrollEvent.NAME);
  }
}

export class QuickReply extends HTMLElement {
  private isSending_?: boolean;
  private compose_: EmailCompose;
  private replyType_: HTMLSelectElement;
  private senders_?: HTMLSelectElement;
  private progress_: RadialProgress;
  private count_: HTMLElement;

  constructor(
      public thread: Thread, private allowedReplyLength_: number,
      private sendAs_: SendAs) {
    super();
    this.style.cssText = `
      display: flex;
      flex-direction: column;
      flex-wrap: wrap;
      width: 100%;
    `;

    this.compose_ = this.createCompose_();

    this.replyType_ = document.createElement('select');
    this.replyType_.innerHTML = `
      <option>${ReplyType.ReplyAll}</option>
      <option>${ReplyType.Reply}</option>
      <option>${ReplyType.Forward}</option>
    `;

    let sendAs = defined(this.sendAs_);
    if (sendAs.senders && sendAs.senders.length > 1) {
      let messages = this.thread.getMessages();
      let lastMessage = messages[messages.length - 1];
      let deliveredTo = lastMessage.deliveredTo;

      this.senders_ = document.createElement('select');
      for (let sender of sendAs.senders) {
        let option = document.createElement('option');
        let email = defined(sender.sendAsEmail);
        option.value = email;
        option.append(`From: ${email}`);
        if (deliveredTo ? email === deliveredTo : sender.isDefault)
          option.setAttribute('selected', 'true');
        this.senders_.append(option);
      }
    }

    this.progress_ = new RadialProgress(true);
    this.progress_.addToTotal(this.allowedReplyLength_);

    this.count_ = document.createElement('button');
    this.count_.style.cssText = `
      color: red;
      display: none;
    `;
    this.count_.addEventListener('click', () => this.handleAllowMore_());

    let cancel = document.createElement('button');
    cancel.textContent = 'cancel';
    cancel.onclick = () => this.dispatchEvent(new ReplyCloseEvent());

    // Group these together so they wrap atomically.
    let controls = document.createElement('div');
    controls.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
    `;
    if (this.senders_)
      controls.append(this.senders_);
    controls.append(this.replyType_, cancel, this.count_, this.progress_);

    this.append(this.compose_, controls);
  }

  private createCompose_() {
    let compose = new EmailCompose(true);
    compose.style.cssText = `
      flex: 1;
      margin: 4px;
      display: flex;
      background-color: white;
    `;
    compose.placeholder =
        'Hit <enter> to send, <esc> to cancel. Allowed length is configurable in Settings.';
    compose.addEventListener(
        CancelEvent.NAME, () => this.dispatchEvent(new ReplyCloseEvent()));
    compose.addEventListener(SubmitEvent.NAME, () => this.handleSubmit_());
    compose.addEventListener('input', () => this.updateProgress_());
    return compose;
  }

  private updateProgress_() {
    let textLength = this.compose_.plainText.length;
    this.progress_.setProgress(textLength);
    let lengthDiff = this.allowedReplyLength_ - textLength;
    if (lengthDiff < 10) {
      this.count_.style.display = '';
      this.count_.textContent = String(lengthDiff);
    } else {
      this.count_.style.display = 'none';
    }
  }

  private handleAllowMore_() {
    if (confirm(`Allow ${this.allowedReplyLength_} more characters?`) &&
        confirm(`Are you sure?`) &&
        confirm(
            `Yes, this is annoying on purpose to help you resist the verbosity urge! Still want to move forward`) &&
        confirm(`Last one! You sure?`)) {
      alert(`JK lol. Ok...really last one now. Enjoy!`);
      this.progress_.addToTotal(this.allowedReplyLength_);
      this.allowedReplyLength_ += this.allowedReplyLength_;
      this.updateProgress_();
    }
  }

  private async handleSubmit_() {
    let textLength = this.compose_.plainText.length;
    if (!textLength)
      return;

    if (textLength > this.allowedReplyLength_) {
      alert(`Email is longer than the allowed length of ${
          this.allowedReplyLength_} characters. Allowed length is configurable in Settings.`);
      return;
    }

    if (this.isSending_)
      return;
    this.isSending_ = true;
    let progress = AppShell.updateLoaderTitle(
        'ThreadListView.sendReply', 1, 'Sending reply...');

    let sendAs = defined(this.sendAs_);
    let sender: gapi.client.gmail.SendAs|undefined;
    if (sendAs.senders && sendAs.senders.length) {
      // Even if there's only one sendAs sender, we should use it
      // since it could have a custom reply-to.
      if (sendAs.senders.length == 1) {
        sender = sendAs.senders[0];
      } else {
        let sendAsEmail = defined(this.senders_).selectedOptions[0].value;
        sender =
            defined(sendAs.senders.find(x => x.sendAsEmail == sendAsEmail));
      }
    }

    let type = this.replyType_.selectedOptions[0].value as ReplyType;
    try {
      // TODO: Handle if sending fails in such a way that the user can
      // at least save their message text.
      await this.thread.sendReply(
          this.compose_.value, this.compose_.getEmails(), type,
          defined(sender));
    } finally {
      this.isSending_ = false;
      progress.incrementProgress();
    }

    this.dispatchEvent(new ReplyCloseEvent());
    if (type !== ReplyType.Forward)
      this.dispatchEvent(new ReplyScrollEvent());
  }

  focus() {
    this.compose_.focus();
  }
}
window.customElements.define('mt-quick-reply', QuickReply);
