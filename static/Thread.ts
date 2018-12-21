import { gapiFetch } from './Net.js';
import { IDBKeyVal } from './idb-keyval.js';
import { Labels } from './Labels.js';
import { send } from './Mail.js';
import { Message } from './Message.js';
import { USER_ID, getCurrentWeekNumber } from './Base.js';

export class Thread {
  id: string;
  historyId: string;
  snippet: string;
  private allLabels_: Labels;

  // These are all set in resetState_, which is called from the constructor.
  private hasMessageDetails_!: boolean;
  private labelIds_!: Set<string>;
  private labelNames_!: Set<string>;
  private priority_!: string;
  private muted_!: boolean;
  private queue_!: string;
  private processedMessages_!: Message[];

  // TODO: Give this a non-any value once we import gapi types.
  private fetchPromise_: Promise<any> | null = null;

  constructor(thread: any, allLabels: Labels) {
    this.id = thread.id;
    this.historyId = thread.historyId;
    this.snippet = thread.snippet;
    this.allLabels_ = allLabels;

    this.resetState_();

    if (thread.messages) {
      this.processMessages_(thread.messages);
      // When the messages are included, the snippet isn't (i.e. for thread.get calls).
      if (!this.snippet)
        this.snippet = thread.messages[thread.messages.length - 1].snippet;
    }
  }

  resetState_() {
    this.hasMessageDetails_ = true;

    this.labelIds_ = new Set();
    this.labelNames_ = new Set();
    this.priority_ = '';
    this.muted_ = false;
    this.queue_ = '';
    this.processedMessages_ = [];
  }

  processLabels_(messages: any[]) {
    for (var message of messages) {
      for (let labelId of message.labelIds) {
        this.labelIds_.add(labelId);
      }
    }

    for (let id of this.labelIds_) {
      let name = this.allLabels_.getName(id);
      if (!name) {
        console.log(`Label id does not exist. WTF. ${id}`);
        continue;
      }

      if (Labels.isNeedsTriageLabel(name))
        this.setQueue(name);
      else if (Labels.isPriorityLabel(name))
        this.priority_ = name;
      else if (name == Labels.MUTED_LABEL)
        this.muted_ = true;

      this.labelNames_.add(name);
    }

    if (!this.queue_)
      this.setQueue('inbox');
  }

  processMessages_(messages: any[]) {
    this.hasMessageDetails_ = false;

    this.processLabels_(messages);
    let newMessages = messages.slice(this.processedMessages_.length);
    // Only process new messages.
    let newProcessedMessages: Message[] = [];
    for (let message of newMessages) {
      let previousMessage;
      if (this.processedMessages_.length)
        previousMessage = this.processedMessages_[this.processedMessages_.length - 1];
      let processed = new Message(message, previousMessage);
      this.processedMessages_.push(processed);
      newProcessedMessages.push(processed);
    }
    return newProcessedMessages;
  }

  async modify(addLabelIds: string[], removeLabelIds: string[], skipHasLabelsCheck?: boolean, messageIds?: string[]) {
    // Need the message details to get the list of current applied labels,
    // as well as the message IDs of all the messages to modify.
    // Almost always we will have alread fetched this since we're showing the
    // thread to the user already.
    if (!messageIds || !skipHasLabelsCheck)
      await this.fetchMessageDetails();

    // Only remove labels that are actually on the thread. That way
    // undo will only reapply labels that were actually there.
    // Make sure that any added labels are not also removed.
    // Gmail API will fail if you try to add and remove the same label.
    // Also, request will fail if the removeLabelIds list is too long (>100).
    // However, for cases where we know we haven't fetch the labels for this thread,
    // like dequeueing, we want to be able to skip the labelIds_.has check.
    removeLabelIds = removeLabelIds.filter((item) => !addLabelIds.includes(item) && (skipHasLabelsCheck || this.labelIds_.has(item)));

    if (!messageIds)
      messageIds = this.processedMessages_.map((message) => message.id);

    // Once a modify has happened the stored message details are stale.
    this.resetState_();

    let request = {
      'userId': USER_ID,
      'ids': messageIds,
      'addLabelIds': addLabelIds,
      'removeLabelIds': removeLabelIds,
    };
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let response = await gapiFetch(gapi.client.gmail.users.messages.batchModify, request);
    // TODO: Handle response.status != 200.
    return {
      added: addLabelIds,
      removed: removeLabelIds,
      thread: this,
      messageIds: messageIds,
    }
  }

  async markTriaged(destination: string | null) {
    // Need the message details to get the list of current applied labels.
    // Almost always we will have alread fetched this since we're showing the
    // thread to the user already.
    await this.fetchMessageDetails();

    if (destination && this.labelNames_.has(destination))
      return null;

    var addLabelIds: string[] = [];
    if (destination)
      addLabelIds.push(await this.allLabels_.getId(destination));

    var removeLabelIds = ['UNREAD', 'INBOX'];
    // If archiving, remove all make-time labels except unprocessed. Don't want
    // archiving a thread to remove this label without actually processing it.
    let unprocessedId = await this.allLabels_.getId(Labels.UNPROCESSED_LABEL);
    let makeTimeIds = this.allLabels_.getMakeTimeLabelIds().filter((item) => {
      return item != unprocessedId && !addLabelIds.includes(item);
    });
    removeLabelIds = removeLabelIds.concat(makeTimeIds);

    return await this.modify(addLabelIds, removeLabelIds);
  }

  async isInInbox() {
    await this.fetchMessageDetails();
    return this.labelIds_.has('INBOX');
  }

  async getLabelIds() {
    await this.fetchMessageDetails();
    return this.labelIds_;
  }

  async getLabelNames() {
    await this.fetchMessageDetails();
    return this.labelNames_;
  }

  async getSubject() {
    await this.fetchMessageDetails();
    return this.processedMessages_[0].subject || '(no subject)';
  }

  async getMessages() {
    await this.fetchMessageDetails();
    return this.processedMessages_;
  }

  setQueue(queue: string) {
    this.queue_ = queue;
  }

  async getDisplayableQueue() {
    let queue = await this.getQueue();
    return Labels.removeNeedsTriagePrefix(queue);
  }

  async getQueue() {
    // fetchThreads sets the queue as a performance optimization in some cases,
    // so don't fetch message details if we don't need to.
    if (!this.queue_)
      await this.fetchMessageDetails();
    return this.queue_;
  }

  async getPriority() {
    await this.fetchMessageDetails();
    return this.priority_;
  }

  async isMuted() {
    await this.fetchMessageDetails();
    return this.muted_;
  }

  async fetchMessageDetails_(forceNetwork?: boolean) {
    let key = `thread-${getCurrentWeekNumber()}-${this.historyId}`;

    if (!forceNetwork) {
      let localData = await IDBKeyVal.getDefault().get(key);
      if (localData)
        return JSON.parse(localData);
    }

    if (!this.fetchPromise_) {
      // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
      this.fetchPromise_ = gapiFetch(gapi.client.gmail.users.threads.get, {
        userId: USER_ID,
        id: this.id,
      })
    }
    let resp = await this.fetchPromise_;
    this.fetchPromise_ = null;

    let messages = resp.result.messages;
    try {
      await IDBKeyVal.getDefault().set(key, JSON.stringify(messages));
    } catch (e) {
      console.log('Fail storing message details in IDB.', e);
    }
    return messages;
  }

  async updateMessageDetails(forceNetwork?: boolean) {
    let messages = await this.fetchMessageDetails_(forceNetwork);
    return this.processMessages_(messages);
  }

  async fetchMessageDetails() {
    if (!this.hasMessageDetails_)
      return null;
    return await this.updateMessageDetails();
  }

  async sendReply(replyText: string, extraEmails: string[], shouldReplyAll: boolean) {
    let messages = await this.getMessages();
    let lastMessage = messages[messages.length - 1];

    // Gmail will remove dupes for us.
    let to = lastMessage.from || '';
    if (shouldReplyAll && lastMessage.to)
      to += ',' + lastMessage.to;

    if (extraEmails.length)
      to += ',' + extraEmails.join(',');

    let subject = lastMessage.subject || '';
    let replyPrefix = 'Re: ';
    if (subject && !subject.startsWith(replyPrefix))
      subject = replyPrefix + subject;

    let headers = `In-Reply-To: ${lastMessage.messageId}\n`;
    if (shouldReplyAll && lastMessage.cc)
      headers += `Cc: ${lastMessage.cc}\n`;

    let text = `${replyText}<br><br>${lastMessage.from} wrote:<br>
  <blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">
    ${lastMessage.getHtmlOrPlain()}
  </blockquote>`;

    await send(text, to, subject, headers, this.id);
  }
}
