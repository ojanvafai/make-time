import {ASSERT_STRING, getCurrentWeekNumber, getMyEmail, getPreviousWeekNumber, parseAddress, serializeAddress, USER_ID} from './Base.js';
import {IDBKeyVal} from './idb-keyval.js';
import {Labels} from './Labels.js';
import {send} from './Mail.js';
import {Message} from './Message.js';
import {gapiFetch} from './Net.js';

let noMessagesError =
    'Attempted to operate on messages before they were fetched';
let staleThreadError =
    'Thread was modified before message details were fetched.';
let staleAfterFetchError =
    'Thread is still stale after fetch. This should never happen.';

export let DEFAULT_QUEUE = 'inbox';

export class Thread {
  id: string;
  historyId: string;
  hasMessageDetails: boolean = false;

  snippet: string|undefined;
  private labelIds_: Set<string>|undefined;
  private labelNames_: Set<string>|undefined;
  private priority_: string|null|undefined;
  private muted_: boolean|undefined;
  private queue_: string|undefined;
  private processedMessages_: Message[]|undefined;

  // TODO: Give this a non-any value once we import gapi types.
  private fetchPromise_: Promise<any>|null = null;

  constructor(thread: any, private allLabels_: Labels) {
    this.id = thread.id;
    this.historyId = thread.historyId;
  }

  equals(other: Thread) {
    return this.id == other.id && this.historyId == other.historyId;
  }

  private async processLabels_() {
    if (!this.processedMessages_)
      throw noMessagesError;

    // Need to reset all the label state in case the new set of messages has
    // different labels.
    this.labelIds_ =
        new Set(this.processedMessages_.flatMap(x => x.getLabelIds()));
    this.labelNames_ = new Set();
    this.priority_ = null;
    this.muted_ = false;
    this.queue_ = DEFAULT_QUEUE;

    for (let id of this.labelIds_) {
      let name = await this.allLabels_.getName(id);
      if (!name) {
        console.log(`Label id does not exist. WTF. ${id}`);
        continue;
      }

      this.labelNames_.add(name);

      if (Labels.isNeedsTriageLabel(name))
        this.queue_ = name;
      else if (Labels.isPriorityLabel(name))
        this.priority_ = name;
      else if (name == Labels.MUTED_LABEL)
        this.muted_ = true;
    }
  }

  private async processMessages_(messages: any[]) {
    this.hasMessageDetails = true;
    if (this.processedMessages_ === undefined)
      this.processedMessages_ = [];

    this.snippet = messages[messages.length - 1].snippet;

    let oldMessageCount = this.processedMessages_.length;
    let newProcessedMessages: Message[] = [];

    for (let i = 0; i < messages.length; i++) {
      let message = messages[i];

      // In theory, the only thing that can change on old messages is the
      // labels, which are only stored in the rawMessage_ field of Message. To
      // avoid recomputing the message body and quote diffs, just set the raw
      // message instead of fully reprocessing.
      if (i < oldMessageCount) {
        this.processedMessages_[i].rawMessage = message;
        continue;
      }

      let previousMessage;
      if (this.processedMessages_.length)
        previousMessage =
            this.processedMessages_[this.processedMessages_.length - 1];

      let processed = new Message(message, previousMessage);
      this.processedMessages_.push(processed);
      newProcessedMessages.push(processed);
    }

    await this.processLabels_();
    return newProcessedMessages;
  }

  async modify(
      addLabelIds: string[], removeLabelIds: string[],
      expectedNewMessageCount: number = 0) {
    // Need the message details to get the list of currently applied labels.
    // Almost always we will have already fetched this since we're showing the
    // thread to the user already or we'll all least have it on disk.
    if (!this.hasMessageDetails)
      await this.fetch();

    if (this.labelIds_ === undefined)
      throw staleThreadError;
    let currentLabelIds = this.labelIds_;

    // Only remove labels that are actually on the thread. That way
    // undo will only reapply labels that were actually there.
    // Make sure that any added labels are not also removed.
    // Gmail API will fail if you try to add and remove the same label.
    // Also, request will fail if the removeLabelIds list is too long (>100).
    removeLabelIds = removeLabelIds.filter(
        (item) => !addLabelIds.includes(item) && (currentLabelIds.has(item)));

    // In theory this can happen legitimately due to race conditions, but
    // usually represents a bug, so log a warning to the console instead of
    // something user visible.
    if (!removeLabelIds.length && !addLabelIds.length) {
      console.warn(
          `Modify call didn't remove or add any Labels for thread with subject: ${
              this.getSubjectSync()}`)
      return null;
    }

    let request: any = {
      'userId': USER_ID,
      'id': this.id,
      'addLabelIds': addLabelIds,
      'removeLabelIds': removeLabelIds,
    };
    let response =
        await gapiFetch(gapi.client.gmail.users.threads.modify, request);

    if (this.processedMessages_ === undefined)
      throw staleThreadError;

    // If the number of messages has changed from when we got the message
    // details for this thread and when we did the modify call, that can be one
    // of two causes:
    //   1. The thread got a new messages in the interim and we need to mark the
    // thread to be processed.
    //   2. We are hitting a gmail bug, and should just ignore it. See
    // https://issuetracker.google.com/issues/122167541. If not for this bug, we
    // could just use messages.batchModify to only modify the messages we know
    // about and avoid the race condition for cause #1 entirely.
    let newMessageMetadata = response.result.messages;
    if (!newMessageMetadata)
      throw ASSERT_STRING;
    let hasUnexpectedNewMessages = newMessageMetadata.length >
        this.processedMessages_.length + expectedNewMessageCount;

    // The response to modify doesn't include historyIds, so we need to do a
    // fetch to get the new historyId. While doing so, we also fetch the new
    // labels in the very rare case when something else may also have modified
    // the labels on this thread.
    //
    // It's frustrating to wait on this network roundtrip before proceeding, but
    // better to have updated historyIds before we do anything like serializing
    // to disk than to get in an inconsistent state and see need the count of
    // new messages to identify if we're in the gmail bug case mentioned above.
    await this.fetchMetadataOnly_();

    // In the bug case, there will be more messages in the response from the
    // modify call than in the response to the fetchMetadataOnly_ call. If we
    // wanted to be 100% sure we could fetch the individual messages that are
    // new and see that they 404, but that seems like overkill.
    if (hasUnexpectedNewMessages &&
        newMessageMetadata.length <= this.processedMessages_.length) {
      // TODO: Handle the case where this network request fails.
      await gapiFetch(gapi.client.gmail.users.threads.modify, {
        'userId': USER_ID,
        'id': this.id,
        'addLabelIds': ['INBOX'],
        'removeLabelIds': [await this.allLabels_.getId(Labels.PROCESSED_LABEL)],
      });
    }

    return {
      added: addLabelIds, removed: removeLabelIds, thread: this,
    }
  }

  async markTriaged(
      destination: string|null, expectedNewMessageCount?: number) {
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

    return await this.modify(
        addLabelIds, removeLabelIds, expectedNewMessageCount);
  }

  async getLastMessage() {
    await this.fetch();
    if (this.processedMessages_ === undefined)
      throw staleAfterFetchError;
    return this.processedMessages_[this.processedMessages_.length - 1];
  }

  // TODO: make all these sync now that they don't fetch.
  async isInInbox() {
    await this.fetch();
    if (this.labelIds_ === undefined)
      throw staleAfterFetchError;
    return this.labelIds_.has('INBOX');
  }

  async getLabelIds() {
    await this.fetch();
    if (this.labelIds_ === undefined)
      throw staleAfterFetchError;
    return this.labelIds_;
  }

  async getLabelNames() {
    await this.fetch();
    if (this.labelNames_ === undefined)
      throw staleAfterFetchError;
    return this.labelNames_;
  }

  async getDate() {
    await this.fetch();
    return this.getDateSync();
  }

  getDateSync() {
    if (this.processedMessages_ === undefined)
      throw staleAfterFetchError;
    let lastMessage =
        this.processedMessages_[this.processedMessages_.length - 1];
    return lastMessage.date;
  }

  async getSubject() {
    await this.fetch();
    return this.getSubjectSync();
  }

  getSubjectSync() {
    if (this.processedMessages_ === undefined)
      throw staleAfterFetchError;
    return this.processedMessages_[0].subject || '(no subject)';
  }

  async getMessages() {
    await this.fetch();
    return this.getMessagesSync();
  }

  getMessagesSync() {
    if (this.processedMessages_ === undefined)
      throw staleAfterFetchError;
    return this.processedMessages_;
  }

  async getDisplayableQueue() {
    let queue = await this.getQueue();
    return this.getDisplayableQueueInternal_(queue);
  }

  getDisplayableQueueSync() {
    let queue = this.getQueueSync();
    return this.getDisplayableQueueInternal_(queue);
  }

  getDisplayableQueueInternal_(queue: string) {
    return Labels.removeNeedsTriagePrefix(queue);
  }

  async getQueue() {
    await this.fetch();
    return this.getQueueSync();
  }

  getQueueSync() {
    if (this.queue_ === undefined)
      throw staleAfterFetchError;
    return this.queue_;
  }

  async getPriority() {
    await this.fetch();
    return this.getPrioritySync();
  }

  getPrioritySync() {
    if (this.priority_ === undefined)
      throw staleAfterFetchError;
    return this.priority_;
  }

  async isMuted() {
    await this.fetch();
    if (this.muted_ === undefined)
      throw staleAfterFetchError;
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

  private async fetchMetadataOnly_() {
    if (!this.processedMessages_)
      throw noMessagesError;

    let resp = await gapiFetch(gapi.client.gmail.users.threads.get, {
      userId: USER_ID,
      id: this.id,
      format: 'minimal',
      fields: 'historyId,messages(labelIds)',
    });

    let messages = resp.result.messages;
    if (!messages)
      throw ASSERT_STRING;

    // If there are new messages we need to do a full update. This
    // should be exceedingly rare though.
    if (this.processedMessages_.length != messages.length)
      return await this.update();

    if (!resp.result.historyId)
      throw ASSERT_STRING;
    this.historyId = resp.result.historyId;

    for (let i = 0; i < messages.length; i++) {
      let labels = messages[i].labelIds;
      if (!labels)
        throw ASSERT_STRING;
      this.processedMessages_[i].updateLabels(labels);
    }
    await this.processLabels_();

    this.serializeMessageData_();
    return null;
  }

  private async serializeMessageData_() {
    if (!this.processedMessages_)
      throw noMessagesError;

    let messages = this.processedMessages_.map(x => x.rawMessage);
    let key = this.getKey_(getCurrentWeekNumber());
    try {
      await IDBKeyVal.getDefault().set(key, JSON.stringify(messages));
    } catch (e) {
      console.log('Fail storing message details in IDB.', e);
    }
  }

  async fetch(forceNetwork?: boolean, skipNetwork?: boolean) {
    if (forceNetwork && skipNetwork)
      throw 'Cannot both force and skip network.';

    if (this.hasMessageDetails && !forceNetwork)
      return null;

    let messages: any;
    if (!forceNetwork)
      messages = await this.getThreadDataFromDisk_();

    if (!messages) {
      if (skipNetwork)
        return;

      if (!this.fetchPromise_) {
        this.fetchPromise_ = gapiFetch(gapi.client.gmail.users.threads.get, {
          userId: USER_ID,
          id: this.id,
        })
      }
      let resp = await this.fetchPromise_;
      this.fetchPromise_ = null;

      messages = resp.result.messages;

      // If modifications have come in since we first created this Thread
      // instance then the historyId will have changed.
      this.historyId = resp.result.historyId;
    }

    let newMessages = await this.processMessages_(messages);
    this.serializeMessageData_();
    return newMessages;
  }

  async update() {
    return await this.fetch(true);
  }

  async sendReply(
      replyText: string, extraEmails: string[], shouldReplyAll: boolean) {
    let messages = await this.getMessages();
    let lastMessage = messages[messages.length - 1];

    // Gmail will remove dupes for us.
    let to = lastMessage.from || '';

    if (shouldReplyAll && lastMessage.to) {
      let myEmail = await getMyEmail();
      let addresses = lastMessage.to.split(',');
      for (let address of addresses) {
        let parsed = parseAddress(address);
        if (parsed.email !== myEmail) {
          if (to !== '')
            to += ',';
          to += serializeAddress(parsed);
        }
      }
    }

    if (extraEmails.length) {
      if (to !== '')
        to += ',';
      to += extraEmails.join(',');
    }

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
