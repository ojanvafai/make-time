import {defined, parseAddressList} from './Base.js';
import {Message} from './Message.js';

export class ProcessedMessageData {
  messages: Message[];
  snippet: string;
  historyId: string;
  from_: HTMLElement|null;

  constructor() {
    this.messages = [];
    this.snippet = '';
    this.historyId = '';
    this.from_ = null;
  }

  getSubject() {
    if (!this.messages.length)
      return '';
    return this.messages[0].subject || '(no subject)';
  }

  getSnippet() {
    return this.snippet;
  }

  getFrom() {
    if (!this.from_) {
      this.from_ = document.createElement('span');
      this.updateFrom_(this.from_);
    }
    // Clone so that different callers get different spans and don't reparent
    // the other's spans.
    return this.from_.cloneNode(true) as HTMLSpanElement;
  }

  updateFrom_(container: HTMLElement) {
    let read = new Set();
    let unread = new Set();

    this.messages.map(x => {
      if (!x.from)
        return;
      let set = x.isUnread ? unread : read;
      let parsed = parseAddressList(x.from);
      parsed.map(y => {
        set.add(y.name || y.address.split('@')[0]);
      });
    });

    let minify = (unread.size + read.size) > 1;

    if (unread.size) {
      let unreadContainer = document.createElement('b');
      unreadContainer.textContent =
          Message.minifyAddressNames(Array.from(unread), minify);
      container.append(unreadContainer);
    }

    let onlyReadAddresses = Array.from(read).filter(x => !unread.has(x));
    if (onlyReadAddresses.length) {
      if (container.firstChild)
        container.append(', ');

      let readContainer = document.createElement('span');
      readContainer.textContent =
          Message.minifyAddressNames(onlyReadAddresses, minify);
      container.append(readContainer);
    }

    if (!container.firstChild)
      container.append('\xa0');
  }

  process(historyId: string, rawMessages: gapi.client.gmail.Message[]) {
    this.historyId = historyId;
    this.snippet = defined(rawMessages[rawMessages.length - 1].snippet);
    this.from_ = null;

    let oldMessageCount = this.messages.length;
    for (let i = 0; i < rawMessages.length; i++) {
      let message = rawMessages[i];

      // In theory, the only thing that can change on old messages is the
      // labels, which are only stored in the rawMessage_ field of Message. To
      // avoid recomputing the message body and quote diffs, just set the raw
      // message instead of fully reprocessing.
      if (i < oldMessageCount) {
        this.messages[i].setRawMessage(message);
        continue;
      }

      let previousMessage;
      if (this.messages.length)
        previousMessage = this.messages[this.messages.length - 1];

      let processed = new Message(message, previousMessage);
      this.messages.push(processed);
    }
  }
}
