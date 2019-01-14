import {defined, getMyEmail, parseAddress, serializeAddress, USER_ID} from './Base.js';
import {Labels} from './Labels.js';
import {send} from './Mail.js';
import {gapiFetch} from './Net.js';
import {ProcessedMessageData, ThreadBase} from './ThreadBase.js';
import {ThreadData} from './ThreadData.js';

export class Thread extends ThreadBase {
  constructor(
      thread: ThreadData, private processed_: ProcessedMessageData,
      allLabels: Labels) {
    super(thread.id, thread.historyId, allLabels);
  }

  equals(other: Thread) {
    return this.id == other.id && this.historyId == other.historyId;
  }

  async modify(
      addLabelIds: string[], removeLabelIds: string[],
      expectedNewMessageCount: number = 0) {
    let currentLabelIds = this.processed_.ids;

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
    let hasUnexpectedNewMessages = newMessageMetadata.length >
        this.processed_.messages.length + expectedNewMessageCount;

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
        newMessageMetadata.length <= this.processed_.messages.length) {
      // TODO: Handle the case where this network request fails.
      await gapiFetch(gapi.client.gmail.users.threads.modify, {
        'userId': USER_ID,
        'id': this.id,
        'addLabelIds': ['INBOX'],
        'removeLabelIds': [await this.allLabels.getId(Labels.PROCESSED_LABEL)],
      });
    }

    return {
      added: addLabelIds, removed: removeLabelIds, thread: this,
    }
  }

  async markTriaged(
      destination: string|null, expectedNewMessageCount?: number) {
    if (destination && this.processed_.names.has(destination))
      return null;

    var addLabelIds: string[] = [];
    if (destination)
      addLabelIds.push(await this.allLabels.getId(destination));

    var removeLabelIds = ['UNREAD', 'INBOX'];
    // If archiving, remove all make-time labels except unprocessed. Don't want
    // archiving a thread to remove this label without actually processing it.
    let unprocessedId = await this.allLabels.getId(Labels.UNPROCESSED_LABEL);
    let makeTimeIds = this.allLabels.getMakeTimeLabelIds().filter((item) => {
      return item != unprocessedId && !addLabelIds.includes(item);
    });
    removeLabelIds = removeLabelIds.concat(makeTimeIds);

    return await this.modify(
        addLabelIds, removeLabelIds, expectedNewMessageCount);
  }

  isInInbox() {
    return this.processed_.ids.has('INBOX');
  }

  getLabelIds() {
    return this.processed_.ids;
  }

  getLabelNames() {
    return this.processed_.names;
  }

  getDate() {
    let messages = this.processed_.messages;
    let lastMessage = messages[messages.length - 1];
    return lastMessage.date;
  }

  getSubject() {
    return this.processed_.messages[0].subject || '(no subject)';
  }

  getMessages() {
    return this.processed_.messages;
  }

  getDisplayableQueue() {
    let queue = this.getQueue();
    return Labels.removeNeedsTriagePrefix(queue);
  }

  getQueue() {
    return this.processed_.queue;
  }

  getPriority() {
    return this.processed_.priority;
  }

  isMuted() {
    return this.processed_.muted;
  }

  getSnippet() {
    return this.processed_.snippet;
  }

  private getRawMessages_() {
    return this.processed_.messages.map(x => x.rawMessage);
  }

  private async fetchMetadataOnly_() {
    let processed = this.processed_.messages;

    let resp = await gapiFetch(gapi.client.gmail.users.threads.get, {
      userId: USER_ID,
      id: this.id,
      format: 'minimal',
      fields: 'historyId,messages(labelIds)',
    });

    let messages = defined(resp.result.messages);

    // If there are new messages we need to do a full update. This
    // should be exceedingly rare though.
    if (processed.length != messages.length) {
      await this.update();
      return;
    }

    this.historyId = defined(resp.result.historyId);

    for (let i = 0; i < messages.length; i++) {
      let labels = defined(messages[i].labelIds);
      processed[i].updateLabels(labels);
    }
    let allRawMessages = this.getRawMessages_();
    this.processed_ =
        await this.processMessages(allRawMessages, this.processed_.messages);
    await this.serializeMessageData(allRawMessages);
  }

  async update() {
    let messages = await this.fetch();
    this.processed_ =
        await this.processMessages(messages, this.processed_.messages);
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
