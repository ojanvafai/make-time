import {defined} from './Base.js';
import {Labels} from './Labels.js';
import {Message} from './Message.js';

let DEFAULT_QUEUE = 'inbox';

export class ProcessedMessageData {
  ids: Set<string>;
  names: Set<string>;
  priority: string|null;
  muted: boolean;
  queue: string;
  messages: Message[];
  snippet: string;

  constructor(
      rawMessages: gapi.client.gmail.Message[], oldMessages: Message[],
      private allLabels_: Labels) {
    // Need to reset all the label state in case the new set of messages has
    // different labels.
    this.ids = new Set(rawMessages.flatMap(x => defined(x.labelIds)));
    this.names = new Set();
    this.priority = null;
    this.muted = false;
    this.queue = DEFAULT_QUEUE;
    this.messages = oldMessages;
    this.snippet = defined(rawMessages[rawMessages.length - 1].snippet);
    this.processMessages_(rawMessages);
  }

  hasDefaultQueue() {
    return this.queue == DEFAULT_QUEUE;
  }

  async processLabelNames() {
    for (let id of this.ids) {
      let name = await this.allLabels_.getName(id);
      if (!name) {
        console.log(`Label id does not exist. WTF. ${id}`);
        continue;
      }

      this.names.add(name);

      if (Labels.isNeedsTriageLabel(name))
        this.queue = name;
      else if (Labels.isPriorityLabel(name))
        this.priority = name;
      else if (name == Labels.MUTED_LABEL)
        this.muted = true;
    }
  }

  private processMessages_(messages: gapi.client.gmail.Message[]) {
    let oldMessageCount = this.messages.length;

    for (let i = 0; i < messages.length; i++) {
      let message = messages[i];

      // In theory, the only thing that can change on old messages is the
      // labels, which are only stored in the rawMessage_ field of Message. To
      // avoid recomputing the message body and quote diffs, just set the raw
      // message instead of fully reprocessing.
      if (i < oldMessageCount) {
        this.messages[i].rawMessage = message;
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
