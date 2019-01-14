import {defined, getCurrentWeekNumber, getMyEmail, parseAddress, serializeAddress, USER_ID} from './Base.js';
import {IDBKeyVal} from './idb-keyval.js';
import {Labels} from './Labels.js';
import {send} from './Mail.js';
import {Message} from './Message.js';
import {gapiFetch} from './Net.js';
import {ThreadBase} from './ThreadBase.js';
import {ThreadData} from './ThreadData.js';

export let DEFAULT_QUEUE = 'inbox';

export class Thread extends ThreadBase {
  snippet: string|undefined;
  private labelIds_: Set<string>|undefined;
  private labelNames_: Set<string>|undefined;
  private priority_: string|null|undefined;
  private muted_: boolean|undefined;
  private queue_: string|undefined;
  private processedMessages_: Message[]|undefined;

  constructor(thread: ThreadData, private allLabels_: Labels) {
    super(thread.id, thread.historyId);
  }

  equals(other: Thread) {
    return this.id == other.id && this.historyId == other.historyId;
  }

  private async processLabels_() {
    let messages = defined(this.processedMessages_);
    // Need to reset all the label state in case the new set of messages has
    // different labels.
    this.labelIds_ = new Set(messages.flatMap(x => x.getLabelIds()));
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

  async processMessages(messages: any[]) {
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
    await this.serializeMessageData_();
    return newProcessedMessages;
  }

  async modify(
      addLabelIds: string[], removeLabelIds: string[],
      expectedNewMessageCount: number = 0) {
    let currentLabelIds = defined(this.labelIds_);

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
              this.getSubject()}`)
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

    let messages = defined(this.processedMessages_);

    // If the number of messages has changed from when we got the message
    // details for this thread and when we did the modify call, that can be one
    // of two causes:
    //   1. The thread got a new messages in the interim and we need to mark the
    // thread to be processed.
    //   2. We are hitting a gmail bug, and should just ignore it. See
    // https://issuetracker.google.com/issues/122167541. If not for this bug, we
    // could just use messages.batchModify to only modify the messages we know
    // about and avoid the race condition for cause #1 entirely.
    let newMessageMetadata = defined(response.result.messages);
    let hasUnexpectedNewMessages =
        newMessageMetadata.length > messages.length + expectedNewMessageCount;

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
        newMessageMetadata.length <= messages.length) {
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
    if (destination && defined(this.labelNames_).has(destination))
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

  isInInbox() {
    return defined(this.labelIds_).has('INBOX');
  }

  getLabelIds() {
    return defined(this.labelIds_);
  }

  getLabelNames() {
    return defined(this.labelNames_);
  }

  getDate() {
    let messages = defined(this.processedMessages_);
    let lastMessage = messages[messages.length - 1];
    return lastMessage.date;
  }

  getSubject() {
    return defined(this.processedMessages_)[0].subject || '(no subject)';
  }

  getMessages() {
    return defined(this.processedMessages_);
  }

  getDisplayableQueue() {
    let queue = this.getQueue();
    return Labels.removeNeedsTriagePrefix(queue);
  }

  getQueue() {
    return defined(this.queue_);
  }

  getPriority() {
    return defined(this.priority_);
  }

  isMuted() {
    return defined(this.muted_);
  }

  private async fetchMetadataOnly_() {
    let processed = defined(this.processedMessages_);

    let resp = await gapiFetch(gapi.client.gmail.users.threads.get, {
      userId: USER_ID,
      id: this.id,
      format: 'minimal',
      fields: 'historyId,messages(labelIds)',
    });

    let messages = defined(resp.result.messages);

    // If there are new messages we need to do a full update. This
    // should be exceedingly rare though.
    if (processed.length != messages.length)
      return await this.update();

    this.historyId = defined(resp.result.historyId);

    for (let i = 0; i < messages.length; i++) {
      let labels = defined(messages[i].labelIds);
      processed[i].updateLabels(labels);
    }
    await this.processLabels_();

    this.serializeMessageData_();
    return null;
  }

  private async serializeMessageData_() {
    let messages = defined(this.processedMessages_).map(x => x.rawMessage);
    let key = this.getKey_(getCurrentWeekNumber());
    try {
      await IDBKeyVal.getDefault().set(key, JSON.stringify(messages));
    } catch (e) {
      console.log('Fail storing message details in IDB.', e);
    }
  }

  async update() {
    let messages = await this.fetch(true);
    return this.processMessages(messages);
  }

  async sendReply(
      replyText: string, extraEmails: string[], shouldReplyAll: boolean) {
    let messages = this.getMessages();
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
