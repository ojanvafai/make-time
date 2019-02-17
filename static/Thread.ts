import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {assert, defined, getCurrentWeekNumber, getMyEmail, getPreviousWeekNumber, parseAddressList, serializeAddress, USER_ID} from './Base.js';
import {firestoreUserCollection, getLabels} from './BaseMain.js';
import {IDBKeyVal} from './idb-keyval.js';
import {Labels} from './Labels.js';
import {send} from './Mail.js';
import {gapiFetch} from './Net.js';
import {ProcessedMessageData} from './ProcessedMessageData.js';
import {QueueNames} from './QueueNames.js';

let memoryCache_: Map<string, Thread> = new Map();

interface SerializedMessages {
  historyId?: string;
  messages?: gapi.client.gmail.Message[];
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

export const NEEDS_FILTER_PRIORITY_NAME = '`Needs filter`';
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
    return this.metadata_.messageIds.length + this.sentMessageIds_.length;
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

  async setData(data: ThreadMetadata) {
    let doc = this.getMetadataDocument_();
    doc.set(data);
  }

  needsFiltering() {
    return this.metadata_.needsFiltering;
  }

  async update() {
    // If we got here and this.processed_===undefined, that means we don't have
    // message data on disk, so fetch the full thread from the network.
    if (!this.processed_.messages.length) {
      let data = await this.fetchFromNetwork_();
      this.processed_.process(defined(data.messages));
      this.dispatchEvent(new UpdatedEvent());
      return;
    }

    let processedMessages = defined(this.processed_).messages;

    let resp = await gapiFetch(gapi.client.gmail.users.threads.get, {
      userId: USER_ID,
      id: this.id,
      format: 'minimal',
      fields: 'historyId,messages(id,labelIds,internalDate)',
    });

    if (this.getHistoryId() === resp.result.historyId)
      return;

    let historyId = defined(resp.result.historyId);
    let messages = defined(resp.result.messages);

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

    this.processed_.process(allRawMessages);
    this.saveMessageState_(historyId, allRawMessages);
    this.dispatchEvent(new UpdatedEvent());
  }

  private static getTimestamp_(message: gapi.client.gmail.Message) {
    let date = Number(defined(message.internalDate));
    return new Date(date).getTime();
  }

  async generateMetadataFromGmailState_(
      historyId: string, messages: gapi.client.gmail.Message[]) {
    let oldMetadata = this.getData();
    let newMetadata = Object.assign({}, oldMetadata);

    newMetadata.historyId = historyId;
    newMetadata.messageIds = messages.flatMap(x => defined(x.id));

    this.sentMessageIds_ =
        this.sentMessageIds_.filter(x => !newMetadata.messageIds.includes(x));

    let lastMessage = messages[messages.length - 1];
    newMetadata.timestamp = Thread.getTimestamp_(lastMessage);

    if (oldMetadata.needsFiltering ||
        messages.length !== oldMetadata.messageIds.length) {
      newMetadata.needsFiltering = true;
    }
    this.setData(newMetadata);
  }

  async fetchFromDisk() {
    let data = await this.deserializeMessageData_();
    if (!data)
      return;
    this.processed_.process(defined(data.messages));
    this.dispatchEvent(new UpdatedEvent());
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

    let historyId = defined(resp.result.historyId);
    let messages = defined(resp.result.messages);
    this.saveMessageState_(historyId, messages);
    return resp.result;
  }

  async saveMessageState_(
      historyId: string, messages: gapi.client.gmail.Message[]) {
    await this.generateMetadataFromGmailState_(historyId, messages);
    await this.serializeMessageData_(messages);
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

  async migrateMaketimeLabelsToFirestore() {
    let removeLabelPrefix = (labelName: string, prefix: string) => {
      return labelName.replace(new RegExp(`^${prefix}/`), '');
    };

    let messages = this.getRawMessages_();
    let metadata = this.getData();

    let lastMessage = messages[messages.length - 1];
    metadata.timestamp = Thread.getTimestamp_(lastMessage);

    let addToInbox = false;

    let labelIds = new Set(messages.flatMap(x => defined(x.labelIds)));
    for (let id of labelIds) {
      let name = await (await getLabels()).getName(id);
      if (!name) {
        console.log(`Label id does not exist. WTF. ${id}`);
        continue;
      }

      if (Labels.isNeedsTriageLabel(name)) {
        let label = removeLabelPrefix(name, Labels.NEEDS_TRIAGE_LABEL);
        metadata.labelId = await this.queueNames_.getId(label);
        metadata.hasLabel = true;
        addToInbox = true;
      } else if (name === Labels.BLOCKED_LABEL) {
        metadata.blocked = true;
        addToInbox = true;
      } else if (Labels.isQueuedLabel(name)) {
        let label = removeLabelPrefix(name, Labels.QUEUED_LABEL);
        metadata.labelId = await this.queueNames_.getId(label);
        metadata.hasLabel = true;
        metadata.queued = true;
        addToInbox = true;
      } else if (Labels.isPriorityLabel(name)) {
        let priority;
        switch (name) {
          case Labels.MUST_DO_LABEL:
            priority = Priority.MustDo;
            break;

          case Labels.URGENT_LABEL:
            priority = Priority.Urgent;
            break;

          case Labels.BACKLOG_LABEL:
            priority = Priority.Backlog;
            break;

          case Labels.NEEDS_FILTER_LABEL:
            priority = Priority.NeedsFilter;
            break;

          default:
            throw new Error('This should never happen.');
        }
        metadata.priorityId = priority;
        metadata.hasPriority = true;
        addToInbox = true;
      } else if (name == Labels.MUTED_LABEL) {
        metadata.muted = true;
      }
    }
    this.setData(metadata);
    return addToInbox;
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

  private async serializeMessageData_(messages: gapi.client.gmail.Message[]) {
    let key = this.getKey_(getCurrentWeekNumber(), this.id);
    try {
      await IDBKeyVal.getDefault().set(key, JSON.stringify({
        messages: messages,
        historyId: this.getHistoryId(),
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
        let addresses = parseAddressList(lastMessage.to);
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
