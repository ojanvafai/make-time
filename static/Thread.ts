import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {assert, defined, getCurrentWeekNumber, getPreviousWeekNumber, parseAddressList, ParsedAddress, USER_ID} from './Base.js';
import {firestoreUserCollection} from './BaseMain.js';
import {IDBKeyVal} from './idb-keyval.js';
import {AddressHeaders, send} from './Mail.js';
import {Message} from './Message.js';
import {gapiFetch} from './Net.js';
import {ProcessedMessageData} from './ProcessedMessageData.js';
import {QueueNames} from './QueueNames.js';
import {SendAs} from './SendAs.js';

// TODO: Clear out old threads so these caches don't grow indefinitely.
let memoryCache_: Map<string, Thread> = new Map();
let forceTriageMemoryCache_: Map<string, Thread> = new Map();

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

export class InProgressChangedEvent extends Event {
  static NAME = 'in-progress-changed';
  constructor() {
    super(InProgressChangedEvent.NAME, {bubbles: true});
  }
}

export enum ReplyType {
  ReplyAll = 'reply all',
  Reply = 'reply',
  Forward = 'forward',
}

interface Repeat {
  type: number;
}

// Keep ThreadMetadataUpdate and ThreadMetadataKeys in sync with any changes
// here.
export interface ThreadMetadata {
  historyId: string;
  messageIds: string[];
  timestamp: number;
  retriageTimestamp?: number;
  priorityId?: number;
  labelId?: number;
  repeat?: Repeat;
  needsRetriage?: boolean;
  needsMessageTriage?: boolean;
  // These booleans are so we can query for things that have a label but still
  // orderBy timestamp. We can just priorityId>0 because firestore doesn't
  // support range queries on a different field than the orderBy field.
  hasLabel?: boolean;
  hasPriority?: boolean;
  queued?: boolean;
  throttled?: boolean;
  blocked?: boolean|number;
  removeDue?: number;
  removedDueDateExpired?: boolean;
  muted?: boolean;
  softMuted?: boolean;
  newMessagesSinceSoftMuted?: boolean;
  archivedByFilter?: boolean;
  finalVersion?: boolean;
  // Threads that were added back to the inbox in maketime, so syncWithGmail
  // should move them into the inbox instead of clearing their metadata.
  moveToInbox?: boolean;
  // Count of number of messages read. We don't attempt to keep this in sync
  // with gmail's sense of read state.
  readCount?: number;
  countToArchive?: number;
  countToMarkRead?: number;
  // Queue pushing maketime labels to gmail as gmail labels.
  pushLabelsToGmail?: boolean;
  important?: boolean;
}

// Want strong typing on all update calls, but don't want to write historyId and
// messageIds on each of them and want to allow FieldValues without needing all
// the getters to have to manage them.
// TODO: Find a more don't-repeat-yourself way of doing this?
export interface ThreadMetadataUpdate {
  historyId?: string|firebase.firestore.FieldValue;
  messageIds?: string[]|firebase.firestore.FieldValue;
  timestamp?: number|firebase.firestore.FieldValue;
  retriageTimestamp?: number|firebase.firestore.FieldValue;
  priorityId?: number|firebase.firestore.FieldValue;
  labelId?: number|firebase.firestore.FieldValue;
  repeat?: Repeat|firebase.firestore.FieldValue;
  needsRetriage?: boolean|firebase.firestore.FieldValue;
  needsMessageTriage?: boolean|firebase.firestore.FieldValue;
  hasLabel?: boolean|firebase.firestore.FieldValue;
  hasPriority?: boolean|firebase.firestore.FieldValue;
  queued?: boolean|firebase.firestore.FieldValue;
  throttled?: boolean|firebase.firestore.FieldValue;
  blocked?: boolean|number|firebase.firestore.FieldValue;
  removedDue?: boolean|number|firebase.firestore.FieldValue;
  removedDueDateExpired?: boolean|firebase.firestore.FieldValue;
  muted?: boolean|firebase.firestore.FieldValue;
  softMuted?: boolean|firebase.firestore.FieldValue;
  newMessagesSinceSoftMuted?: boolean|firebase.firestore.FieldValue;
  archivedByFilter?: boolean|firebase.firestore.FieldValue;
  finalVersion?: boolean|firebase.firestore.FieldValue;
  moveToInbox?: boolean|firebase.firestore.FieldValue;
  readCount?: number|firebase.firestore.FieldValue;
  countToArchive?: number|firebase.firestore.FieldValue;
  countToMarkRead?: number|firebase.firestore.FieldValue;
  pushLabelsToGmail?: boolean|firebase.firestore.FieldValue;
  important?: boolean|firebase.firestore.FieldValue;
}

// Firestore queries take the key as a string. Use an enum so we can avoid silly
// typos in string literals.
// TODO: Is there a way to do this without manually keeping things in sync?
export enum ThreadMetadataKeys {
  historyId = 'historyId',
  messageIds = 'messageIds',
  timestamp = 'timestamp',
  retriageTimestamp = 'retriageTimestamp',
  priorityId = 'priorityId',
  labelId = 'labelId',
  repeat = 'repeat',
  needsRetriage = 'needsRetriage',
  needsMessageTriage = 'needsMessageTriage',
  hasLabel = 'hasLabel',
  hasPriority = 'hasPriority',
  queued = 'queued',
  throttled = 'throttled',
  blocked = 'blocked',
  removedDue = 'due',
  removedDueDateExpired = 'dueDateExpired',
  muted = 'muted',
  softMuted = 'softMuted',
  newMessagesSinceSoftMuted = 'newMessagesSinceSoftMuted',
  archivedByFilter = 'archivedByFilter',
  finalVersion = 'finalVersion',
  moveToInbox = 'moveToInbox',
  readCount = 'readCount',
  countToArchive = 'countToArchive',
  countToMarkRead = 'countToMarkRead',
  pushLabelsToGmail = 'pushLabelsToGmail',
  important = 'important',
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
  RemovedNeedsFilter = 1,
  MustDo = 2,
  Urgent = 3,
  Backlog = 4,
  Pin = 5,
  RemovedQuick = 6,
  RemovedIcebox = 7,
  Bookmark = 8,
}

// The number values get stored in firestore, so should never be changed.
export enum RepeatType {
  Daily = 1,
}

export const UNKNOWN_PRIORITY_NAME = 'Unknown priority';
export const BOOKMARK_PRIORITY_NAME = 'Bookmark';
export const PINNED_PRIORITY_NAME = 'Pin';
export const MUST_DO_PRIORITY_NAME = 'Must do';
export const URGENT_PRIORITY_NAME = 'Urgent';
export const BACKLOG_PRIORITY_NAME = 'Backlog';
export const STUCK_LABEL_NAME = 'Stuck';
export const FALLBACK_LABEL_NAME = 'No label';

const PrioritySortOrder = [
  Priority.Pin,
  Priority.Bookmark,
  Priority.MustDo,
  Priority.Urgent,
  Priority.Backlog,
];

// Use negative values for built-in labels.
export enum BuiltInLabelIds {
  Stuck = -1,
  Fallback = -2,
}

export function getPriorityName(id: Priority) {
  switch (id) {
    case Priority.Pin:
      return PINNED_PRIORITY_NAME;
    case Priority.Bookmark:
      return BOOKMARK_PRIORITY_NAME;
    case Priority.MustDo:
      return MUST_DO_PRIORITY_NAME;
    case Priority.Urgent:
      return URGENT_PRIORITY_NAME;
    case Priority.Backlog:
      return BACKLOG_PRIORITY_NAME;
    case Priority.RemovedNeedsFilter:
    case Priority.RemovedQuick:
    case Priority.RemovedIcebox:
      return UNKNOWN_PRIORITY_NAME;
  }
  throw new Error('This should never happen');
}

export function getLabelName(queueNames: QueueNames, id?: number) {
  if (!id)
    return FALLBACK_LABEL_NAME;

  switch (id) {
    case BuiltInLabelIds.Stuck:
      return STUCK_LABEL_NAME;
    case BuiltInLabelIds.Fallback:
      return FALLBACK_LABEL_NAME;
    default:
      let name = queueNames.getName(id);
      return name || FALLBACK_LABEL_NAME;
  }
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
  private actionInProgress_?: boolean;
  private actionInProgressTimestamp_?: number;
  private from_: HTMLElement|null;

  constructor(
      public id: string, private metadata_: ThreadMetadata,
      private forceTriage_: boolean) {
    super();

    this.processed_ = new ProcessedMessageData();
    this.queueNames_ = QueueNames.create();
    this.sentMessageIds_ = [];
    this.from_ = null;
  }

  // Ensure there's only one Thread per id so that we can use reference
  // equality.
  static create(id: string, metadata: ThreadMetadata, forceTriage?: boolean) {
    let cache = forceTriage ? forceTriageMemoryCache_ : memoryCache_;
    let entry = cache.get(id);
    if (entry) {
      entry.metadata_ = metadata;
    } else {
      entry = new Thread(id, metadata, !!forceTriage);
      cache.set(id, entry);
    }
    return entry;
  }

  static comparePriorities(a: Priority, b: Priority) {
    let aOrder = PrioritySortOrder.indexOf(a);
    let bOrder = PrioritySortOrder.indexOf(b);
    return aOrder - bOrder;
  }

  private messageCount_() {
    let count = this.metadata_.messageIds.length + this.sentMessageIds_.length;
    assert(
        count,
        `Can't modify thread before message details have loaded. Please wait and try again.`);
    return count;
  }

  forceTriage() {
    return this.forceTriage_;
  }

  oldMetadataState(updates: ThreadMetadataUpdate) {
    let oldState: any = {};
    let fullState = this.metadata_ as any;
    for (let key in updates) {
      if (key in fullState)
        oldState[key] = fullState[key];
      else
        oldState[key] = firebase.firestore.FieldValue.delete();
    }
    return oldState;
  }

  // Returns the old values for all the fields being updated so that undo can
  // restore them.
  async updateMetadata(updates: ThreadMetadataUpdate) {
    await this.getMetadataDocument_().update(updates);
    this.dispatchEvent(new UpdatedEvent());
    if (this.actionInProgress_) {
      this.setActionInProgress(false);
    }
  }

  private static clearedMetadata_(removeFromInbox?: boolean):
      ThreadMetadataUpdate {
    let update: ThreadMetadataUpdate = {
      needsRetriage: firebase.firestore.FieldValue.delete(),
      needsMessageTriage: firebase.firestore.FieldValue.delete(),
      blocked: firebase.firestore.FieldValue.delete(),
      muted: firebase.firestore.FieldValue.delete(),
      softMuted: firebase.firestore.FieldValue.delete(),
      archivedByFilter: firebase.firestore.FieldValue.delete(),
      finalVersion: firebase.firestore.FieldValue.delete(),
      queued: firebase.firestore.FieldValue.delete(),
      throttled: firebase.firestore.FieldValue.delete(),
      // Intentionally keep only the labelId and not the hasLabel so we can
      // show what label a thread came from even after it's been triaged.
      // hasLabel the latter is for deciding whether to show the thread in
      // the TriageModel.
      hasLabel: firebase.firestore.FieldValue.delete(),
      hasPriority: firebase.firestore.FieldValue.delete(),
      priorityId: firebase.firestore.FieldValue.delete(),
    };

    if (removeFromInbox) {
      // Intentionally keep labelId so that muted threads can see if their
      // labelId changes when new messages come in.
      update.moveToInbox = firebase.firestore.FieldValue.delete();
    }
    return update;
  }

  static async clearMetadata(threadId: string) {
    let update = this.clearedMetadata_(true);
    await Thread.metadataCollection().doc(threadId).update(update);
  }

  static metadataCollection() {
    return firestoreUserCollection().doc('threads').collection('metadata');
  }

  setActionInProgress(inProgress: boolean) {
    this.actionInProgress_ = inProgress;
    this.actionInProgressTimestamp_ = inProgress ? Date.now() : undefined;
    this.dispatchEvent(new InProgressChangedEvent());
  }

  actionInProgress() {
    return !!this.actionInProgress_;
  }

  actionInProgressTimestamp() {
    return this.actionInProgressTimestamp_;
  }

  removeFromInboxMetadata_() {
    return Thread.baseArchiveUpdate(this.messageCount_());
  }

  static baseArchiveUpdate(messageCount: number) {
    let update = Thread.clearedMetadata_(true);
    update.countToArchive = messageCount;
    return update;
  }

  archiveUpdate(archivedByFilter?: boolean) {
    // TODO: Take into account the repeat pattern. This assumes daily.
    if (this.hasRepeat())
      return this.stuckDaysUpdate(1);

    let update = this.removeFromInboxMetadata_();
    if (archivedByFilter) {
      update.archivedByFilter = true;
      if (this.metadata_.softMuted)
        update.newMessagesSinceSoftMuted = true;
    }
    return update;
  }

  async archive(archivedByFilter?: boolean) {
    await this.updateMetadata(this.archiveUpdate(archivedByFilter));
  }

  // For muted threads that get new messages, all we need to do is archive the
  // messages in gmail during the sync.
  async applyMute() {
    await this.updateMetadata({countToArchive: this.messageCount_()});
  }

  muteUpdate() {
    if (this.hasRepeat()) {
      alert('Cannot mute a repeating item.');
      return;
    }

    let update = this.removeFromInboxMetadata_();
    update.muted = true;
    return update;
  }

  softMuteUpdate() {
    if (this.hasRepeat()) {
      alert('Cannot mute a repeating item.');
      return;
    }

    let update = this.keepInInboxMetadata_();
    update.softMuted = true;
    return update;
  }

  async softMute() {
    let update = this.softMuteUpdate();
    if (!update)
      return;
    await this.updateMetadata(update);
  }

  async mute() {
    let update = this.muteUpdate();
    if (!update)
      return;
    await this.updateMetadata(update);
  }

  keepInInboxMetadata_() {
    let update = Thread.clearedMetadata_();
    // Mark the last time this thread was triaged so we don't retriage it too
    // soon after that.
    update.retriageTimestamp = Date.now();
    return update;
  }

  unreadNotSentByMe(sendAs: SendAs) {
    if (!this.isUnread())
      return false;

    let senders = defined(sendAs.senders).map(x => x.sendAsEmail);
    let unread = this.processed_.messages.slice(this.metadata_.readCount);
    return unread.some(
        x => x.parsedFrom.some(y => !senders.includes(y.address)));
  }

  isUnread() {
    // Old threads don't have a readCount since we added that field later.
    return this.metadata_.readCount !== undefined &&
        this.metadata_.readCount < this.metadata_.messageIds.length;
  }

  async markRead() {
    // Old threads don't have a readCount since we added that field later.
    if (this.metadata_.readCount === undefined ||
        this.metadata_.readCount < this.metadata_.messageIds.length) {
      let messageCount = this.messageCount_();
      await this.updateMetadata(
          {readCount: messageCount, countToMarkRead: messageCount});
      // Marking read needs to rerender the from so that the bolds are removed.
      this.clearCachedFrom();
    }
  }

  clearCachedFrom() {
    this.from_ = null;
  }

  updateFrom_(container: HTMLElement) {
    let read: Set<string> = new Set();
    let unread: Set<string> = new Set();

    this.getMessages().map((x, index) => {
      if (!x.from)
        return;
      let set = index >= this.readCount() ? unread : read;
      let parsed = parseAddressList(x.from);
      parsed.map(y => {
        set.add(y.name || y.address.split('@')[0]);
      });
    });

    let minify = (unread.size + read.size) > 1;

    if (unread.size) {
      let unreadContainer = document.createElement('b');
      unreadContainer.textContent =
          Message.minifyAddressNames(Array.from(unread), minify);
      container.append(unreadContainer);
    }

    let onlyReadAddresses = Array.from(read).filter(x => !unread.has(x));
    if (onlyReadAddresses.length) {
      if (container.firstChild)
        container.append(', ');

      let readContainer = document.createElement('span');
      readContainer.textContent =
          Message.minifyAddressNames(onlyReadAddresses, minify);
      container.append(readContainer);
    }

    if (!container.firstChild)
      container.append('\xa0');
  }

  priorityUpdate(
      priority: Priority, moveToInbox?: boolean, needsMessageTriage?: boolean) {
    let update = this.keepInInboxMetadata_();

    if (moveToInbox)
      update.moveToInbox = true;

    if (needsMessageTriage)
      update.needsMessageTriage = true;

    update.hasPriority = true;
    update.priorityId = priority;
    return update;
  }

  clearStuckUpdate(moveToInbox?: boolean) {
    let update: ThreadMetadataUpdate = {};
    if (moveToInbox)
      update.moveToInbox = true;
    update[ThreadMetadataKeys.blocked] = firebase.firestore.FieldValue.delete();
    // Clearing blocked should put the thread back in the triage queue,
    // otherwise the thread just disappears. If the user wants a queue other
    // than triage, they can just use that action directly instead of clearing
    // blocked (e.g. set the priority).
    update.hasLabel = true;
    return update;
  }

  stuckUpdate(date: Date, moveToInbox?: boolean) {
    return this.setDate(date, moveToInbox);
  }

  stuckDaysUpdate(days: number, moveToInbox?: boolean) {
    return this.setDateDays_(days, moveToInbox);
  }

  setDate(date: Date, moveToInbox?: boolean) {
    let update = this.keepInInboxMetadata_();
    if (moveToInbox)
      update.moveToInbox = true;
    update[ThreadMetadataKeys.blocked] = date.getTime();
    return update;
  }

  setDateDays_(days: number, moveToInbox?: boolean) {
    let date = new Date();
    // Set the time to midnight to ensure consistency since we only care about
    // day boundaries.
    date.setHours(0, 0, 0);
    date.setDate(date.getDate() + days);
    return this.setDate(date, moveToInbox);
  }

  async pushLabelsToGmail() {
    await this.updateMetadata({pushLabelsToGmail: true});
  }

  async setOnlyFinalVersion(value: boolean) {
    await this.updateMetadata({finalVersion: value});
  }

  async setOnlyLabel(label: string) {
    await this.updateMetadata({labelId: await this.queueNames_.getId(label)});
  }

  async applyLabel(
      labelId: number, shouldQueue: boolean, shouldThrottle: boolean) {
    let update: ThreadMetadataUpdate = {
      labelId: labelId,
      hasLabel: true,
      muted: false,
      softMuted: false,
    };

    if (shouldQueue)
      update.queued = true;

    if (shouldThrottle)
      update.throttled = shouldThrottle;

    // New message putting the thread back into triage should remove it from
    // stuck.
    // TODO: Keep the stuck date and use a boolean to track whether a stuck
    // thread is in the triage queue or not. That way we can show the stuck date
    // in the UI so the user can see that they had marked it stuck.
    if (!shouldQueue && !shouldThrottle)
      update.blocked = firebase.firestore.FieldValue.delete();

    await this.updateMetadata(update);
  }

  repeatUpdate() {
    let current = this.metadata_.repeat;
    let newRepeat;
    if (current) {
      newRepeat = firebase.firestore.FieldValue.delete();
    } else {
      newRepeat = {type: RepeatType.Daily};
    }
    return {repeat: newRepeat} as ThreadMetadataUpdate;
  }

  readCount() {
    return this.metadata_.readCount || 0;
  }

  finalVersion() {
    return !!this.metadata_.finalVersion;
  }

  hasRepeat() {
    return !!this.metadata_.repeat;
  }

  isStuck() {
    return !!this.metadata_.blocked;
  }

  needsRetriage() {
    return !!this.metadata_.needsRetriage;
  }

  needsMessageTriage() {
    return !!this.metadata_.needsMessageTriage;
  }

  getDate() {
    return new Date(defined(this.metadata_.timestamp));
  }

  getLastTriagedDate() {
    // Fallback to the timestamp of the last message in the thread if for some
    // reason we don't have a retriageTimestamp (e.g. threads that are triaged
    // before we added retriageTimestamps to them).
    return new Date(
        this.metadata_.retriageTimestamp || defined(this.metadata_.timestamp));
  }

  getStuckDate() {
    if (!this.isStuck())
      return null;

    let blocked = defined(this.metadata_.blocked);
    // TODO: Remove this once blocked can no longer be a boolean.
    if (blocked === true) {
      let today = new Date();
      today.setDate(today.getDate() + 1);
      return today;
    }
    if (blocked === false)
      assert(false);
    return new Date(blocked as number);
  }

  isImportant() {
    return !!this.metadata_.important;
  }

  getSubject() {
    return this.processed_.getSubject();
  }

  getMessageIds() {
    return this.metadata_.messageIds;
  }

  getCountToArchive() {
    return this.metadata_.countToArchive;
  }

  getMessages() {
    return this.processed_.messages;
  }

  isQueued() {
    return !!this.metadata_.queued;
  }

  isThrottled() {
    return !!this.metadata_.throttled;
  }

  getLabel() {
    return getLabelName(this.queueNames_, this.metadata_.labelId);
  }

  needsTriage() {
    // TODO: Rename hasLabel to needsTriage in firestore.
    return this.metadata_.hasLabel;
  }

  getPriorityId() {
    return this.metadata_.priorityId;
  }

  getPriority() {
    let id = this.getPriorityId();
    if (id)
      return getPriorityName(id);
    return null;
  }

  getHistoryId() {
    return this.metadata_.historyId;
  }

  isMuted() {
    return this.metadata_.muted;
  }

  isSoftMuted() {
    return this.metadata_.softMuted;
  }

  getFrom() {
    if (!this.from_) {
      let from = document.createElement('span');
      if (!this.getMessages().length)
        return from;

      this.from_ = from;
      this.updateFrom_(from);
    }
    // Clone so that different callers get different spans and don't reparent
    // the other's spans.
    return this.from_.cloneNode(true) as HTMLSpanElement;
  }

  getSnippet() {
    return this.processed_.getSnippet();
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
      readCount: 0,
    } as ThreadMetadata;
    await doc.set(data);
    return data;
  }

  getData() {
    return this.metadata_;
  }

  async update() {
    // If we don't have any messages yet, it's more efficient to fetch the full
    // thread from the network and fetching the indivudal messages.
    if (!this.processed_.messages.length) {
      let data = await this.fetchFromNetwork_();
      // This happens when a thread disappears from gmail but mktime still knows
      // about it.
      if (!data)
        return;
      let historyId = defined(data.historyId);
      let messages = defined(data.messages);
      await this.saveMessageState_(historyId, messages);
      return;
    }

    let processedMessages = defined(this.processed_).messages;

    let resp = await gapiFetch(gapi.client.gmail.users.threads.get, {
      userId: USER_ID,
      id: this.id,
      format: 'minimal',
      fields: 'historyId,messages(id,historyId,labelIds,internalDate)',
    });

    let historyId = defined(resp.result.historyId);
    let messages = defined(resp.result.messages);

    // If the historyId both on disk and in firestore matches what gmail
    // returns, then there's no work to do. In theory, what's in firestore
    // should match what's on disk if what's on disk matches gmail, but due to
    // races with different clients, it's possible for an older client's write
    // to override a newer client's write.
    if (defined(this.processed_).historyId === historyId &&
        this.getHistoryId() === historyId)
      return;

    let allRawMessages = [];

    // Fetch the full message details for any new messages.
    // TODO: If there are many messages to fetch, might be faster to just
    // refetch the whole thread or maybe do a BatchRequest for all the messages.
    for (let i = 0; i < messages.length; i++) {
      let message = messages[i];
      let processedMessage = processedMessages[i];

      // The order of messages can change due to deleting messages or drafts
      // coming/going. If the ids or historyIds match, don't refetch the full
      // message data. ids change on drafts at each autosave, so this
      // ensures we pull fresh versions of drafts. historyIds change on label
      // changes.
      let rawMessage;
      if (!processedMessage || processedMessage.rawMessage.id !== message.id) {
        // TODO: Fire a change event in this case so rendered threads update.
        let resp = await gapiFetch(gapi.client.gmail.users.messages.get, {
          userId: USER_ID,
          id: messages[i].id,
        });
        rawMessage = resp.result;
      } else {
        rawMessage = processedMessage.rawMessage;

        // If the message is the same message we have in the case, but the
        // historyIds are different, then this means the labels have changed.
        // Update them in place rather than fetching all the message data again.
        if (rawMessage.historyId !== message.historyId) {
          rawMessage.historyId = message.historyId;
          rawMessage.labelIds = message.labelIds;
        }
      }

      allRawMessages.push(rawMessage);
    }

    await this.saveMessageState_(historyId, allRawMessages);
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
      important:
          messages.some(x => x.labelIds && x.labelIds.includes('IMPORTANT')),
    };

    this.sentMessageIds_ =
        this.sentMessageIds_.filter(x => !newMetadata.messageIds.includes(x));

    await this.updateMetadata(newMetadata);

    // Ensure metadata is correct after the update. An alternative would be to
    // have an onsnapshot listener, but those are expensive to setup for every
    // thread. Alternately, should updateMetadata just do this? Then we'd never
    // have metadata_ be out of date, but it would come at the cost of an extra
    // network fetch for each updateMetadata call.
    this.metadata_ = await Thread.fetchMetadata(this.id);

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

    let resp;
    try {
      resp = await this.fetchPromise_;
      return resp.result;
    } catch (e) {
      // Threads sometimes disappear from gmail. Hard to figure out why. 404
      // implies it's gone gone, so remove it from the views in maketime so it
      // doesn't spew errors indefinitely. Clearing metadata is kind of scary,
      // but not sure what else to do as this appears to be gmail bugs.
      if (e.status === 404) {
        // Intentionaly don't pass the removeFromInbox argument as we want to
        // leave the labelId on it should gmail decide to show the thread again
        // (not sure if that's even possible).
        let update = Thread.clearedMetadata_();
        await Thread.metadataCollection().doc(this.id).update(update);
      }
      return null;
    } finally {
      this.fetchPromise_ = null;
    }
  }

  async saveMessageState_(
      historyId: string, messages: gapi.client.gmail.Message[]) {
    this.processed_.process(historyId, messages);
    await this.generateMetadataFromGmailState_(historyId, messages);
    await this.serializeMessageData_(historyId, messages);
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
      replyText: string, extraEmails: ParsedAddress[], replyType: ReplyType,
      sender: gapi.client.gmail.SendAs) {
    let messages = this.getMessages();
    let lastMessage = messages[messages.length - 1];

    let addressHeaders = new Map();
    addressHeaders.set(AddressHeaders.To, []);

    if (replyType === ReplyType.Forward) {
      assert(
          extraEmails.length,
          'Add recipients by typing +email in the reply box.')
    } else {
      // Gmail will remove dupes for us if the to and from fields have
      // overlap.
      let from = lastMessage.replyTo || lastMessage.from;
      if (from)
        addressHeaders.get(AddressHeaders.To).push(...parseAddressList(from));

      if (replyType === ReplyType.ReplyAll && lastMessage.to) {
        let excludeMe =
            lastMessage.parsedTo.filter(x => x.address !== sender.sendAsEmail);
        addressHeaders.get(AddressHeaders.To).push(...excludeMe);
      }
    }

    if (extraEmails.length)
      addressHeaders.get(AddressHeaders.To).push(...extraEmails);

    if (replyType === ReplyType.ReplyAll && lastMessage.cc) {
      addressHeaders.set(AddressHeaders.Cc, lastMessage.parsedCc);
    }

    let subject = lastMessage.subject || '';
    let replyPrefix = replyType === ReplyType.Forward ? 'Fwd: ' : 'Re: ';
    if (subject && !subject.startsWith(replyPrefix))
      subject = replyPrefix + subject;

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
          from}${date}${subject}${to}<br>${await lastMessage.getHtmlOrPlain()}`;
    } else {
      text = `${replyText}<br><br>${lastMessage.from} wrote:<br>
  <blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid var(--border-and-hover-color);padding-left:1ex">
    ${await lastMessage.getHtmlOrPlain()}
  </blockquote>`;
    }

    let headers = `In-Reply-To: ${lastMessage.messageId}\n`;
    let message =
        await send(text, addressHeaders, subject, sender, headers, this.id);
    // If the message is in this same thread, then account for it appropriately
    // in the message counts. This can happen even if it's a forward, e.g. if
    // you forward to yourself.
    if (message.threadId === this.id)
      this.sentMessageIds_.push(defined(message.id));
  }
}
