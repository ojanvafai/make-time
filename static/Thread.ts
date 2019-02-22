import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {assert, defined, getCurrentWeekNumber, getMyEmail, getPreviousWeekNumber, serializeAddress, USER_ID} from './Base.js';
import {firestoreUserCollection} from './BaseMain.js';
import {IDBKeyVal} from './idb-keyval.js';
import {send} from './Mail.js';
import {gapiFetch} from './Net.js';
import {ProcessedMessageData} from './ProcessedMessageData.js';
import {QueueNames} from './QueueNames.js';

let memoryCache_: Map<string, Thread> = new Map();

interface SerializedMessages {
  historyId: string;
  messages: gapi.client.gmail.Message[];
}

export class UpdatedEvent extends Event {
  static NAME = 'thread-updated';
  constructor() {
    super(UpdatedEvent.NAME);
  }
}

export enum ReplyType {
  ReplyAll = 'reply all',
  Reply = 'reply',
  Forward = 'forward',
}

// Keep ThreadMetadataUpdate and ThreadMetadataKeys in sync with any changes
// here.
export interface ThreadMetadata {
  historyId: string;
  messageIds: string[];
  timestamp: number;
  priorityId?: number;
  labelId?: number;
  // These booleans are so we can query for things that have a label but still
  // orderBy timestamp. We can just priorityId>0 because firestore doesn't
  // support range queries on a different field than the orderBy field.
  hasLabel?: boolean;
  hasPriority?: boolean;
  queued?: boolean;
  blocked?: boolean;
  muted?: boolean;
  needsFiltering?: boolean;
  // Threads that were added back to the inbox in maketime, so syncWithGmail
  // should move them into the inbox instead of clearing their metadata.
  moveToInbox?: boolean;
  countToArchive?: number;
  countToMarkRead?: number;
}

// Want strong typing on all update calls, but don't want to write historyId and
// messageIds on each of them and want to allow FieldValues without needing all
// the getters to have to manage them.
// TODO: Find a more don't-repeat-yourself way of doing this?
export interface ThreadMetadataUpdate {
  historyId?: string|firebase.firestore.FieldValue;
  messageIds?: string[]|firebase.firestore.FieldValue;
  timestamp?: number|firebase.firestore.FieldValue;
  priorityId?: number|firebase.firestore.FieldValue;
  labelId?: number|firebase.firestore.FieldValue;
  hasLabel?: boolean|firebase.firestore.FieldValue;
  hasPriority?: boolean|firebase.firestore.FieldValue;
  queued?: boolean|firebase.firestore.FieldValue;
  blocked?: boolean|firebase.firestore.FieldValue;
  muted?: boolean|firebase.firestore.FieldValue;
  needsFiltering?: boolean|firebase.firestore.FieldValue;
  moveToInbox?: boolean|firebase.firestore.FieldValue;
  countToArchive?: number|firebase.firestore.FieldValue;
  countToMarkRead?: number|firebase.firestore.FieldValue;
}

// Firestore queries take the key as a string. Use an enum so we can avoid silly
// typos in string literals.
// TODO: Is there a way to do this without manually keeping things in sync?
export enum ThreadMetadataKeys {
  historyId = 'historyId',
  messageIds = 'messageIds',
  timestamp = 'timestamp',
  priorityId = 'priorityId',
  labelId = 'labelId',
  hasLabel = 'hasLabel',
  hasPriority = 'hasPriority',
  queued = 'queued',
  blocked = 'blocked',
  muted = 'muted',
  needsFiltering = 'needsFiltering',
  moveToInbox = 'moveToInbox',
  countToArchive = 'countToArchive',
  countToMarkRead = 'countToMarkRead',
}

let FWD_THREAD_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  weekday: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  timeZoneName: 'short',
});

// The number values get stored in firestore, so should never be changed.
export enum Priority {
  NeedsFilter = 1,
  MustDo = 2,
  Urgent = 3,
  Backlog = 4,
}

export const NEEDS_FILTER_PRIORITY_NAME = 'Needs filter';
export const MUST_DO_PRIORITY_NAME = 'Must do';
export const URGENT_PRIORITY_NAME = 'Urgent';
export const BACKLOG_PRIORITY_NAME = 'Backlog';
export const BLOCKED_LABEL_NAME = 'Blocked';

export const PrioritySortOrder =
    [Priority.NeedsFilter, Priority.MustDo, Priority.Urgent, Priority.Backlog];

// Use negative values for built-in labels.
export enum BuiltInLabels {
  Blocked = -1,
}

export class Thread extends EventTarget {
  private processed_: ProcessedMessageData;
  private queueNames_: QueueNames;
  private fetchPromise_:
      Promise<gapi.client.Response<gapi.client.gmail.Thread>>|null = null;
  // Keep track of messages sent until an update pulls them in properly so that
  // we can queue up archives/mark-reads with the right count of messages to
  // archive/mark-read.
  private sentMessageIds_: string[];

  constructor(public id: string, private metadata_: ThreadMetadata) {
    super();

    this.processed_ = new ProcessedMessageData();
    this.queueNames_ = new QueueNames();
    this.sentMessageIds_ = [];

    let doc = this.getMetadataDocument_();
    doc.onSnapshot((snapshot) => {
      this.metadata_ = snapshot.data() as ThreadMetadata;
      // Make callers update when metadata has changed.
      this.dispatchEvent(new UpdatedEvent());
    });
  }

  private messageCount_() {
    let count = this.metadata_.messageIds.length + this.sentMessageIds_.length;
    assert(
        count,
        `Can't modify thread before message details have loaded. Please wait and try again.`);
    return count;
  }

  // Returns the old values for all the fields being updated so that undo can
  // restore them.
  async updateMetadata(updates: ThreadMetadataUpdate) {
    let oldState: any = {};
    let fullState = this.metadata_ as any;
    for (let key in updates) {
      if (key in fullState)
        oldState[key] = fullState[key];
      else
        oldState[key] = firebase.firestore.FieldValue.delete();
    }
    await this.getMetadataDocument_().update(updates);
    return oldState;
  }

  async setPriority(priority: Priority) {
    return await this.updateMetadata({
      hasPriority: true,
      priorityId: priority,
      hasLabel: firebase.firestore.FieldValue.delete(),
      labelId: firebase.firestore.FieldValue.delete(),
      queued: firebase.firestore.FieldValue.delete(),
      countToMarkRead: this.messageCount_(),
    } as ThreadMetadataUpdate);
  }

  static clearedMetatdata(): ThreadMetadataUpdate {
    return {
      blocked: firebase.firestore.FieldValue.delete(),
          muted: firebase.firestore.FieldValue.delete(),
          queued: firebase.firestore.FieldValue.delete(),
          hasLabel: firebase.firestore.FieldValue.delete(),
          labelId: firebase.firestore.FieldValue.delete(),
          hasPriority: firebase.firestore.FieldValue.delete(),
          priorityId: firebase.firestore.FieldValue.delete(),
          moveToInbox: firebase.firestore.FieldValue.delete(),
    }
  }

  static async clearMetadata(threadId: string) {
    let update = this.clearedMetatdata();
    await Thread.metadataCollection().doc(threadId).update(update);
  }

  static metadataCollection() {
    return firestoreUserCollection().doc('threads').collection('metadata');
  }

  async archive() {
    let update = Thread.clearedMetatdata();
    update.countToArchive = this.messageCount_();
    return await this.updateMetadata(update);
  }

  async setBlocked() {
    let update = Thread.clearedMetatdata();
    update.blocked = true;
    update.countToMarkRead = this.messageCount_();
    return await this.updateMetadata(update);
  }

  async setMuted() {
    let update = Thread.clearedMetatdata();
    update.muted = true;
    update.countToArchive = this.messageCount_();
    return await this.updateMetadata(update);
  }

  isBlocked() {
    return this.metadata_.blocked;
  }

  getDate() {
    return new Date(defined(this.metadata_.timestamp));
  }

  getSubject() {
    return this.processed_.getSubject();
  }

  getMessageIds() {
    return this.metadata_.messageIds;
  }

  getMessages() {
    return this.processed_.messages;
  }

  isQueued() {
    return !!this.metadata_.queued;
  }

  getLabelId() {
    return this.metadata_.labelId;
  }

  getLabel() {
    let id = this.getLabelId();
    if (!id)
      return null;
    if (id === BuiltInLabels.Blocked)
      return BLOCKED_LABEL_NAME;
    return this.queueNames_.getName(id);
  }

  getPriorityId() {
    return this.metadata_.priorityId;
  }

  getPriority() {
    switch (this.getPriorityId()) {
      case Priority.NeedsFilter:
        return NEEDS_FILTER_PRIORITY_NAME;
      case Priority.MustDo:
        return MUST_DO_PRIORITY_NAME;
      case Priority.Urgent:
        return URGENT_PRIORITY_NAME;
      case Priority.Backlog:
        return BACKLOG_PRIORITY_NAME;
    }
    throw new Error('This should never happen.');
  }

  getHistoryId() {
    return this.metadata_.historyId;
  }

  isMuted() {
    return this.metadata_.muted;
  }

  getFrom() {
    return this.processed_.getFrom();
  }

  getSnippet() {
    return this.processed_.getSnippet();
  }

  private getRawMessages_() {
    return this.processed_.messages.map(x => x.rawMessage);
  }

  getMetadataDocument_() {
    return Thread.metadataCollection().doc(this.id);
  }

  static async fetchMetadata(id: string) {
    let doc = Thread.metadataCollection().doc(id);
    let snapshot = await doc.get();
    if (snapshot.exists) {
      return snapshot.data() as ThreadMetadata;
    }

    let data = {
      historyId: '',
      messageIds: [],
      timestamp: 0,
    };
    await doc.set(data);
    return data;
  }

  async setLabelAndQueued(shouldQueue: boolean, label: string) {
    return await this.updateMetadata({
      queued: shouldQueue,
      labelId: await this.queueNames_.getId(label),
      hasLabel: true,
      needsFiltering: firebase.firestore.FieldValue.delete(),
      blocked: firebase.firestore.FieldValue.delete(),
    } as ThreadMetadataUpdate);
  }

  getData() {
    return this.metadata_;
  }

  needsFiltering() {
    return this.metadata_.needsFiltering;
  }

  async update() {
    // If we don't have any messages yet, it's more efficient to fetch the full
    // thread from the network and fetching the indivudal messages.
    if (!this.processed_.messages.length) {
      let data = await this.fetchFromNetwork_();
      let historyId = defined(data.historyId);
      let messages = defined(data.messages);
      this.saveMessageState_(historyId, messages);
      return;
    }

    let processedMessages = defined(this.processed_).messages;

    let resp = await gapiFetch(gapi.client.gmail.users.threads.get, {
      userId: USER_ID,
      id: this.id,
      format: 'minimal',
      fields: 'historyId,messages(id,labelIds,internalDate)',
    });

    let historyId = defined(resp.result.historyId);
    let messages = defined(resp.result.messages);

    if (defined(this.processed_).historyId === historyId)
      return;

    // TODO: Need to refetch drafts that were sent. Make the loop below fetch
    // the message if the messageId has changed.
    for (let i = 0; i < processedMessages.length; i++) {
      let labels = messages[i].labelIds || [];
      processedMessages[i].updateLabels(labels);
    }

    let allRawMessages = this.getRawMessages_();
    // Fetch the full message details for any new messages.
    // TODO: If there are many messages to fetch, might be faster to just
    // refetch the whole thread or maybe do a BatchRequest for all the messages.
    for (let i = allRawMessages.length; i < messages.length; i++) {
      let resp = await gapiFetch(gapi.client.gmail.users.messages.get, {
        userId: USER_ID,
        id: messages[i].id,
      });
      allRawMessages.push(resp.result);
    }

    this.saveMessageState_(historyId, allRawMessages);
  }

  private static getTimestamp_(message: gapi.client.gmail.Message) {
    let date = Number(defined(message.internalDate));
    return new Date(date).getTime();
  }

  async generateMetadataFromGmailState_(
      historyId: string, messages: gapi.client.gmail.Message[]) {
    let lastMessage = messages[messages.length - 1];

    let newMetadata: ThreadMetadata = {
      historyId: historyId,
      messageIds: messages.flatMap(x => defined(x.id)),
      timestamp: Thread.getTimestamp_(lastMessage),
    };

    this.sentMessageIds_ =
        this.sentMessageIds_.filter(x => !newMetadata.messageIds.includes(x));

    if (this.metadata_.needsFiltering ||
        messages.length !== this.metadata_.messageIds.length) {
      newMetadata.needsFiltering = true;
    }
    this.updateMetadata(newMetadata);
    // This is technically only needed in the case where updateMetadata didn't
    // update anything. This happens when firestore is up to date, but the
    // messages on local disk are stale.
    this.dispatchEvent(new UpdatedEvent());
  }

  async fetchFromDisk() {
    if (this.processed_.messages.length)
      return;

    let data = await this.deserializeMessageData_();
    if (!data)
      return;
    let messages = defined(data.messages);
    this.processed_.process(data.historyId, messages);
    this.dispatchEvent(new UpdatedEvent());
  }

  mightNeedUpdate(freshGmailHistoryId: string) {
    // It's possible to have the the firestore and gmail historyIds match, but
    // to not have the messages locally on disk, so make sure to fetch any
    // messages firestore knows about.
    return this.getHistoryId() !== freshGmailHistoryId ||
        this.getHistoryId() != this.processed_.historyId;
  }

  // If the metadata in firestore doesn't match the one in local
  // storage, pull in the new messages and labels so we're up to date.
  async syncMessagesInFirestore() {
    if (this.getHistoryId() != this.processed_.historyId)
      await this.update();
  }

  private async fetchFromNetwork_() {
    if (!this.fetchPromise_) {
      this.fetchPromise_ = gapiFetch(gapi.client.gmail.users.threads.get, {
        userId: USER_ID,
        id: this.id,
      })
    }
    let resp = await this.fetchPromise_;
    this.fetchPromise_ = null;
    return resp.result;
  }

  async saveMessageState_(
      historyId: string, messages: gapi.client.gmail.Message[]) {
    this.processed_.process(historyId, messages);
    await this.generateMetadataFromGmailState_(historyId, messages);
    await this.serializeMessageData_(historyId, messages);
  }

  // Ensure there's only one Thread per id so that we can use reference equality
  // and also not worry about multiple Thread with multiple onSnapshot
  // listeners.
  static create(id: string, metadata: ThreadMetadata) {
    let entry = memoryCache_.get(id);
    if (entry) {
      entry.metadata_ = metadata;
    } else {
      entry = new Thread(id, metadata);
      memoryCache_.set(id, entry);
    }
    return entry;
  }

  private getKey_(weekNumber: number, threadId: string) {
    return `thread-${weekNumber}-${threadId}`;
  }

  private async deserializeMessageData_(): Promise<SerializedMessages|null> {
    let currentWeekKey = this.getKey_(getCurrentWeekNumber(), this.id);
    let localData = await IDBKeyVal.getDefault().get(currentWeekKey);

    let oldKey;
    if (!localData) {
      oldKey = this.getKey_(getPreviousWeekNumber(), this.id);
      localData = await IDBKeyVal.getDefault().get(oldKey);
    }

    if (!localData)
      return null;

    if (oldKey) {
      await IDBKeyVal.getDefault().del(oldKey);
      await IDBKeyVal.getDefault().set(currentWeekKey, localData);
    }

    return JSON.parse(localData);
  }

  private async serializeMessageData_(
      historyId: string, messages: gapi.client.gmail.Message[]) {
    let key = this.getKey_(getCurrentWeekNumber(), this.id);
    try {
      await IDBKeyVal.getDefault().set(key, JSON.stringify({
        messages: messages,
        historyId: historyId,
      }));
    } catch (e) {
      console.log('Fail storing message details in IDB.', e);
    }
  }

  async sendReply(
      replyText: string, extraEmails: string[], replyType: ReplyType,
      sender?: gapi.client.gmail.SendAs) {
    let messages = this.getMessages();
    let lastMessage = messages[messages.length - 1];

    let to = '';
    if (replyType === ReplyType.Forward) {
      assert(
          extraEmails.length,
          'Add recipients by typing +email in the reply box.')
    } else {
      // Gmail will remove dupes for us if the to and from fields have
      // overlap.
      to = lastMessage.replyTo || lastMessage.from || '';

      if (replyType === ReplyType.ReplyAll && lastMessage.to) {
        let myEmail = await getMyEmail();
        let addresses = lastMessage.parsedTo;
        for (let address of addresses) {
          if (address.address !== myEmail) {
            if (to !== '')
              to += ',';
            to += serializeAddress(address);
          }
        }
      }
    }

    if (extraEmails.length) {
      if (to !== '')
        to += ',';
      to += extraEmails.join(',');
    }

    let subject = lastMessage.subject || '';
    let replyPrefix = replyType === ReplyType.Forward ? 'Fwd: ' : 'Re: ';
    if (subject && !subject.startsWith(replyPrefix))
      subject = replyPrefix + subject;

    let headers = `In-Reply-To: ${lastMessage.messageId}\n`;
    if (replyType === ReplyType.ReplyAll && lastMessage.cc)
      headers += `Cc: ${lastMessage.cc}\n`;

    let text;
    if (replyType === ReplyType.Forward) {
      let from = lastMessage.from ? `From: ${lastMessage.from}<br>` : '';
      let date = lastMessage.from ?
          `Date: ${FWD_THREAD_DATE_FORMATTER.format(lastMessage.date)}<br>` :
          '';
      let subject =
          lastMessage.from ? `Subject: ${lastMessage.subject}<br>` : '';
      let to = lastMessage.from ? `To: ${lastMessage.to}<br>` : '';
      text = `${replyText}<br><br>---------- Forwarded message ---------<br>${
          from}${date}${subject}${to}<br>${lastMessage.getHtmlOrPlain()}`;
    } else {
      text = `${replyText}<br><br>${lastMessage.from} wrote:<br>
  <blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">
    ${lastMessage.getHtmlOrPlain()}
  </blockquote>`;
    }

    let message = await send(text, to, subject, sender, headers, this.id);
    if (message.threadId === this.id) {
      assert(replyType !== ReplyType.Forward);
      this.sentMessageIds_.push(defined(message.id));
    }
  }
}
