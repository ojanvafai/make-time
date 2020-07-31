import {Shortcut} from './Actions.js';
import {createMktimeButton, defined} from './Base.js';
import {CancelEvent, EmailCompose, SubmitEvent} from './EmailCompose.js';
import {SendAs} from './SendAs.js';
import {ReplyType, Thread} from './Thread.js';
import {Toast} from './Toast.js';
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

const LENGTHS = ['Tweet', 'Short story', 'Novella', 'Novel'];

export class QuickReply extends HTMLElement {
  private isSending_?: boolean;
  private compose_: EmailCompose;
  private controls_: HTMLElement;
  private sendButton_: HTMLElement;
  private replyType_: HTMLSelectElement;
  private senders_?: HTMLSelectElement;
  private lengthIndex_: number;

  constructor(public thread: Thread, private sendAs_: SendAs) {
    super();
    this.className =
        'flex flex-column flex-wrap mx-auto reading-max-width fill-available-width';

    this.compose_ = this.createCompose_();
    this.lengthIndex_ = 0;

    this.replyType_ = document.createElement('select');
    this.replyType_.classList.add('button');

    let replyTypes = Object.values(ReplyType).map(x => {
      let option = document.createElement('option');
      option.append(x);
      return option;
    });
    this.replyType_.append(...replyTypes);

    let sendAs = defined(this.sendAs_);
    if (sendAs.senders && sendAs.senders.length > 1) {
      let messages = this.thread.getMessages();
      let lastMessage = messages[messages.length - 1];
      let deliveredTo = lastMessage.deliveredTo;

      this.senders_ = document.createElement('select');
      // Shrink this button if we can't fit the whole toolbar on one row, but
      // don't shrink below 100px;
      this.senders_.className = 'flex-expand-1';
      this.senders_.style.cssText = `
        width: 100px;
        max-width: max-content;
      `;
      this.senders_.classList.add('button');
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

    let cancel = createMktimeButton(
        () => this.dispatchEvent(new ReplyCloseEvent()), 'cancel');
    this.sendButton_ = createMktimeButton(() => this.handleSubmit_(), 'send');

    // Group these together so they wrap atomically.
    this.controls_ = document.createElement('div');
    this.controls_.className = 'flex flex-wrap items-center justify-center';
    this.controls_.append(this.sendButton_, cancel, this.replyType_);
    if (this.senders_)
      this.controls_.append(this.senders_);

    this.updateProgress_();

    this.append(this.compose_, this.controls_);
  }

  private createCompose_() {
    let compose = new EmailCompose(true);
    compose.classList.add(
        'fill-available-width', 'theme-max-width', 'self-center');
    compose.placeholder =
        new Shortcut('Enter', true).toString() + ' to send, <esc> to cancel.';
    compose.addEventListener(
        CancelEvent.NAME, () => this.dispatchEvent(new ReplyCloseEvent()));
    compose.addEventListener(SubmitEvent.NAME, () => this.handleSubmit_());
    compose.addEventListener('input', () => this.updateProgress_());
    return compose;
  }

  private exceedsLengthIndex_() {
    let count = this.compose_.plainText.length;
    if (count < 280)
      return 0;
    if (count < 750)
      return 1;
    if (count < 2500)
      return 2;
    return 3;
  }

  private updateProgress_() {
    let index = this.exceedsLengthIndex_();
    if (this.lengthIndex_ === index)
      return;

    // Don't show the toast when we first open QuickReply and show it whenever
    // the length grows.
    if (index > 0 && this.lengthIndex_ < index)
      this.append(new Toast(`Length: ${LENGTHS[index]}`));

    this.lengthIndex_ = index;
  }

  private async handleSubmit_() {
    let textLength = this.compose_.plainText.length;
    if (!textLength)
      return;

    if (this.isSending_)
      return;
    this.isSending_ = true;
    this.classList.add('noevents-important', 'quieter');
    this.sendButton_.textContent = 'sending...'
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
      this.classList.remove('noevents-important', 'quieter');
      this.sendButton_.textContent = 'send'
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
