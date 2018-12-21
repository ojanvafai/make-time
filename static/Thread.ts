import { gapiFetch } from './Net.js';
import { IDBKeyVal } from './idb-keyval.js';
import { Labels } from './Labels.js';
import { send } from './Mail.js';
import { Message } from './Message.js';
import { USER_ID, getCurrentWeekNumber, getPreviousWeekNumber } from './Base.js';

let staleThreadError = 'Thread was modified before message details were fetched.';

export class Thread {
  id: string;
  historyId: string;
  private allLabels_: Labels;
  private hasMessageDetails_: boolean = false;

  // These are all set in resetState, which is called from the constructor.
  // and they shouldn't be undefined because we fetch the thread details
  // immediately after constructing the Thread. Technically there's a race
  // there though since fetching the thread details involves a network fetch.
  snippet: string | undefined;
  private labelIds_: Set<string> | undefined;
  private labelNames_: Set<string> | undefined;
  private priority_: string | null | undefined;
  private muted_: boolean | undefined;
  private queue_: string | undefined;
  private processedMessages_: Message[] | undefined;

  // TODO: Give this a non-any value once we import gapi types.
  private fetchPromise_: Promise<any> | null = null;

  constructor(thread: any, allLabels: Labels) {
    this.id = thread.id;
    this.historyId = thread.historyId;
    this.allLabels_ = allLabels;

    this.resetState();

    if (thread.messages)
      this.processMessages_(thread.messages);
  }

  resetState() {
    this.hasMessageDetails_ = false;
    // Set these to undefined so we can be sure to never read uninitialized
    // values. processLabels_ will set some of these to null to indicated
    // that it's initialized but null.
    this.snippet = undefined;
    this.labelIds_ = undefined;
    this.labelNames_ = undefined;
    this.priority_ = undefined;
    this.muted_ = undefined;
    this.queue_ = undefined;
    this.processedMessages_ = undefined;
  }

  private processLabels_(messages: any[]) {
    this.labelIds_ = new Set();
    this.labelNames_ = new Set();
    this.priority_ = null;
    this.muted_ = false;

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
        this.queue_ = name;
      else if (Labels.isPriorityLabel(name))
        this.priority_ = name;
      else if (name == Labels.MUTED_LABEL)
        this.muted_ = true;

      this.labelNames_.add(name);
    }

    if (this.queue_ === undefined)
      this.queue_ = 'inbox';
  }

  private processMessages_(messages: any[]) {
    this.hasMessageDetails_ = true;
    if (this.processedMessages_ === undefined)
      this.processedMessages_ = [];

    this.snippet = messages[messages.length - 1].snippet;

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

  async modify(addLabelIds: string[], removeLabelIds: string[], skipFetching?: boolean, messageIds?: string[]) {
    // Need the message details to get the list of current applied labels,
    // as well as the message IDs of all the messages to modify.
    // Almost always we will have alread fetched this since we're showing the
    // thread to the user already or we'll all least have it on disk.
    if (!skipFetching)
      await this.fetch();

    // This undefined-check is to satisfy the typscript compiler that the this.labelIds_
    // call below can't be undefined.
    if (!skipFetching && this.labelIds_ === undefined)
      throw staleThreadError;

    // Only remove labels that are actually on the thread. That way
    // undo will only reapply labels that were actually there.
    // Make sure that any added labels are not also removed.
    // Gmail API will fail if you try to add and remove the same label.
    // Also, request will fail if the removeLabelIds list is too long (>100).
    // However, for cases where we know we haven't fetch the labels for this thread,
    // like dequeueing, we want to be able to skip the labelIds_.has check.
    removeLabelIds = removeLabelIds.filter((item) => !addLabelIds.includes(item) && (skipFetching || this.labelIds_!.has(item)));

    if (!skipFetching && !messageIds) {
      if (this.processedMessages_ === undefined)
        throw staleThreadError;
      messageIds = this.processedMessages_.map((message) => message.id);
    }

    // Once a modify has happened the stored message details are stale.
    this.resetState();

    let request: any = {
      'userId': USER_ID,
      'addLabelIds': addLabelIds,
      'removeLabelIds': removeLabelIds,
    };

    if (skipFetching) {
      request.id = this.id;
      // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
      await gapiFetch(gapi.client.gmail.users.thread.modify, request);
      // Return value isn't used for any of the skipFetching codepaths, so make it
      // error in case it is accidentaly used.
      return null;
    }

    request.ids = messageIds;
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    await gapiFetch(gapi.client.gmail.users.messages.batchModify, request);
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
    await this.fetch();

    if (this.labelNames_ === undefined)
      throw staleThreadError;

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

  // TODO: make all these sync now that they don't fetch.
  async isInInbox() {
    if (this.labelIds_ === undefined)
      throw staleThreadError;
    return this.labelIds_.has('INBOX');
  }

  async getLabelIds() {
    if (this.labelIds_ === undefined)
      throw staleThreadError;
    return this.labelIds_;
  }

  async getLabelNames() {
    if (this.labelNames_ === undefined)
      throw staleThreadError;
    return this.labelNames_;
  }

  async getSubject() {
    if (this.processedMessages_ === undefined)
      throw staleThreadError;
    return this.processedMessages_[0].subject || '(no subject)';
  }

  async getMessages() {
    if (this.processedMessages_ === undefined)
      throw staleThreadError;
    return this.processedMessages_;
  }

  async getDisplayableQueue() {
    let queue = await this.getQueue();
    return Labels.removeNeedsTriagePrefix(queue);
  }

  async getQueue() {
    if (this.queue_ === undefined)
      throw staleThreadError;
    return this.queue_;
  }

  async getPriority() {
    if (this.priority_ === undefined)
      throw staleThreadError;
    return this.priority_;
  }

  async isMuted() {
    if (this.muted_ === undefined)
      throw staleThreadError;
    return this.muted_;
  }

  private async getThreadDataFromDisk_() {
    let currentKey = this.getKey_(getCurrentWeekNumber());
    let localData = await IDBKeyVal.getDefault().get(currentKey);

    if (!localData) {
      let previousKey = this.getKey_(getPreviousWeekNumber());
      localData = await IDBKeyVal.getDefault().get(previousKey);
      if (localData) {
        await IDBKeyVal.getDefault().set(currentKey, localData);
        await IDBKeyVal.getDefault().del(previousKey);
      }
    }

    if (localData)
      return JSON.parse(localData);
    return null;
  }

  private getKey_(weekNumber: number) {
    return `thread-${weekNumber}-${this.historyId}`;
  }

  async fetch(forceNetwork?: boolean) {
    if (this.hasMessageDetails_ && !forceNetwork)
      return null;

    let messages : any;
    if (!forceNetwork)
      messages = await this.getThreadDataFromDisk_();

    if (!messages) {
      if (!this.fetchPromise_) {
        // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
        this.fetchPromise_ = gapiFetch(gapi.client.gmail.users.threads.get, {
          userId: USER_ID,
          id: this.id,
        })
      }
      let resp = await this.fetchPromise_;
      this.fetchPromise_ = null;

      messages = resp.result.messages;

      // If modifications have come in since we first created this Thread instance
      // then the historyId and the snippet may have changed.
      // TODO: Should we delete the old entry in IDB if the historyId changes or
      // just let gcLocalStorage delete it eventually?
      this.historyId = resp.result.historyId;

      try {
        let key = this.getKey_(getCurrentWeekNumber());
        await IDBKeyVal.getDefault().set(key, JSON.stringify(messages));
      } catch (e) {
        console.log('Fail storing message details in IDB.', e);
      }
    }

    return this.processMessages_(messages);
  }

  async update() {
    return await this.fetch(true);
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
