import {defined, parseAddressList} from './Base.js';
import {Message} from './Message.js';

export class ProcessedMessageData {
  messages: Message[];
  snippet: string;
  historyId: string;

  constructor() {
    this.messages = [];
    this.snippet = '';
    this.historyId = '';
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
    if (!this.messages.length)
      return '';

    let addresses = new Set();
    this.messages.map(x => {
      if (!x.from)
        return;
      let parsed = parseAddressList(x.from);
      parsed.map(y => addresses.add(y.name || y.address));
    });
    return Array.from(addresses).join(',');
  }

  process(historyId: string, rawMessages: gapi.client.gmail.Message[]) {
    this.historyId = historyId;
    this.snippet = defined(rawMessages[rawMessages.length - 1].snippet);

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
