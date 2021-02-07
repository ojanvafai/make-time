import { defined } from './Base.js';
import { Message } from './Message.js';

export class ProcessedMessageData {
  messages: Message[];
  notesToSelf: Message[];
  snippet: string;
  historyId: string;

  constructor() {
    this.messages = [];
    this.notesToSelf = [];
    this.snippet = '';
    this.historyId = '';
  }

  getSubject() {
    if (!this.messages.length) return '';
    return this.messages[0].subject || '(no subject)';
  }

  getSnippet() {
    return this.snippet;
  }

  process(historyId: string, rawMessages: gapi.client.gmail.Message[]) {
    this.historyId = historyId;
    this.snippet = defined(rawMessages[rawMessages.length - 1].snippet);

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

      if (newMessage.isNoteToSelf) {
        // Don't pass previousMessage to notesToSelf Message instances.
        this.notesToSelf.push(newMessage);
      } else {
        newMessages.push(newMessage);
        previousMessage = newMessage;
      }
    }
    this.messages = newMessages;
  }
}
