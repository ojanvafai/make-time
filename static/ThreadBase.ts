import {defined, getCurrentWeekNumber, USER_ID} from './Base.js';
import {IDBKeyVal} from './idb-keyval.js';
import {Labels} from './Labels.js';
import {Message} from './Message.js';
import {gapiFetch} from './Net.js';

export let DEFAULT_QUEUE = 'inbox';

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

export class ThreadBase {
  private fetchPromise_:
      Promise<gapi.client.Response<gapi.client.gmail.Thread>>|null = null;

  constructor(
      public id: string, public historyId: string,
      protected allLabels: Labels) {}

  protected getKey(weekNumber: number) {
    return `thread-${weekNumber}-${this.historyId}`;
  }

  async fetch() {
    if (!this.fetchPromise_) {
      this.fetchPromise_ = gapiFetch(gapi.client.gmail.users.threads.get, {
        userId: USER_ID,
        id: this.id,
      })
    }
    let resp = await this.fetchPromise_;
    this.fetchPromise_ = null;

    // If modifications have come in since we first created this Thread
    // instance then the historyId will have changed.
    this.historyId = defined(resp.result.historyId);

    let messages = defined(resp.result.messages);
    await this.serializeMessageData(messages);
    return messages;
  }

  protected async serializeMessageData(messages: gapi.client.gmail.Message[]) {
    let key = this.getKey(getCurrentWeekNumber());
    try {
      await IDBKeyVal.getDefault().set(key, JSON.stringify(messages));
    } catch (e) {
      console.log('Fail storing message details in IDB.', e);
    }
  }

  protected async processMessages(
      messages: gapi.client.gmail.Message[], oldMessages: Message[]) {
    let processed =
        new ProcessedMessageData(messages, oldMessages, this.allLabels);
    await processed.processLabelNames();
    return processed;
  }
}
