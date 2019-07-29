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
    let read: Set<string> = new Set();
    let unread: Set<string> = new Set();

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

    let newMessages = [];
    let previousMessage;
    for (let i = 0; i < rawMessages.length; i++) {
      let message = rawMessages[i];
      let oldMessage = this.messages[i];

      // If the ids are the same, we don't need to reprocess the message data,
      // but we may need to update labels if the historyIds changed.
      let newMessage;
      if (!oldMessage || oldMessage.rawMessage.id !== message.id) {
        newMessage = new Message(message, previousMessage);
      } else {
        newMessage = oldMessage;
        if (oldMessage.rawMessage.historyId === message.historyId)
          oldMessage.updateLabels(message.labelIds || []);
      }

      newMessages.push(newMessage);
      previousMessage = newMessage;
    }
    this.messages = newMessages;
  }
}
