import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {assert, defined, FetchRequestParameters, Labels, ParsedAddress, USER_ID} from './Base.js';
import {firestoreUserCollection, getServerStorage} from './BaseMain.js';
import {ErrorLogger} from './ErrorLogger.js';
import {Message} from './Message.js';
import {gapiFetch} from './Net.js';
import {QueueNames} from './QueueNames.js';
import {QueueSettings, ThrottleOption} from './QueueSettings.js';
import {ServerStorage, StorageUpdates} from './ServerStorage.js';
import {FilterRule, HeaderFilterRule, ruleRegexp, Settings, stringFilterMatches} from './Settings.js';
import {TaskQueue} from './TaskQueue.js';
import {BuiltInLabelIds, getLabelName, getPriorityName, Priority, Thread, ThreadMetadata, ThreadMetadataKeys, ThreadMetadataUpdate} from './Thread.js';
import {AppShell} from './views/AppShell.js';

let MAKE_TIME_LABEL_NAME = 'mktime';
let LABEL_LABEL_NAME = `${MAKE_TIME_LABEL_NAME}/label`;
let PRIORITY_LABEL_NAME = `${MAKE_TIME_LABEL_NAME}/priority`;
let MAX_RETRIAGE_COUNT = 10;
let MUST_DO_RETRIAGE_FREQUENCY_DAYS = 2;
let URGENT_RETRIAGE_FREQUENCY_DAYS = 7;
let BACKLOG_RETRIAGE_FREQUENCY_DAYS = 28;
let SOFT_MUTE_EXPIRATION_DAYS = 7;

export class MailProcessor {
  private makeTimeLabelId_?: string;
  private queueNames_?: QueueNames;

  constructor(private settings_: Settings) {}

  private metadataCollection_() {
    return firestoreUserCollection().doc('threads').collection('metadata');
  }

  async init() {
    if (this.makeTimeLabelId_)
      return;
    let labels = await this.ensureLabelsExist_(MAKE_TIME_LABEL_NAME);
    this.makeTimeLabelId_ = labels[0].id;
    this.queueNames_ = QueueNames.create();
  }

  private async getExistingMakeTimeLabels_() {
    var response = await gapiFetch(
        gapi.client.gmail.users.labels.list, {'userId': USER_ID});
    let labels = defined(response.result.labels);
    return labels.filter(x => defined(x.name).startsWith(MAKE_TIME_LABEL_NAME))
  }

  private async ensureLabelsExist_(...labelNames: string[]) {
    let labels = await this.getExistingMakeTimeLabels_();
    let result = [];
    for (let labelName of labelNames) {
      let label = labels.find(x => x.name === labelName);
      if (!label) {
        let resp = await gapiFetch(gapi.client.gmail.users.labels.create, {
          name: labelName,
          messageListVisibility: 'hide',
          labelListVisibility: 'labelHide',
          userId: USER_ID,
        });
        label = resp.result;
      }
      result.push(label);
    }
    return result;
  }

  async process() {
    await this.processThrottled_();
    await this.processQueues_();
    await this.syncWithGmail_();
  }

  // Only remove labels from messages that were seen by the user at the time
  // they took the action.
  private async removeGmailLabels_(
      firestoreKey: string, removeLabelIds: string[]) {
    let querySnapshot =
        await this.metadataCollection_().where(firestoreKey, '>', 0).get();

    await this.doInParallel_<firebase.firestore.QueryDocumentSnapshot>(
        querySnapshot.docs,
        async (doc: firebase.firestore.QueryDocumentSnapshot) => {
          await this.removeGmailLabelsFromDoc_(
              doc, firestoreKey, removeLabelIds);
        });
  }

  private async removeGmailLabelsFromDoc_(
      doc: firebase.firestore.QueryDocumentSnapshot, firestoreKey: string,
      removeLabelIds: string[]) {
    let messageIds = doc.data().messageIds;
    let count = doc.data()[firestoreKey];
    await gapiFetch(gapi.client.gmail.users.messages.batchModify, {
      userId: USER_ID,
      ids: messageIds.slice(0, count),
      removeLabelIds: removeLabelIds,
    });

    // Gmail has bugs where modifying individual messages fails silently with
    // batchModify and 404s with modify. The only way to do the modify is to
    // use threads.modify, which we don't want to do in the common case since
    // it introduces race conditions with new threads coming in. This is
    // different from https://issuetracker.google.com/issues/122167541 where
    // there's messages that just don't exist. In this case, the message is
    // there, and you can read it by calling threads.get, but messages.get
    // 404s.
    // TODO: Technically we should do this for countToMarkRead as well, but
    // the consequences of a message not being marked read are less severe and
    // it complicates the code and makes remove labels slower due to the extra
    // network request, so meh.
    if (firestoreKey === 'countToArchive') {
      let newMessageData =
          await gapiFetch(gapi.client.gmail.users.threads.get, {
            userId: USER_ID,
            id: doc.id,
            fields: 'messages(labelIds)',
          });

      let newMessages = newMessageData.result.messages;
      // newMessages can be undefined in the case where all the messages on this
      // thread have no labelIds since we restrict the query to ones with
      // labelIds.
      if (newMessages && newMessages.length === count) {
        let modifyFailed =
            newMessages.some(x => defined(x.labelIds).includes('INBOX'));
        if (modifyFailed) {
          // If new messages haven't come in, then we can safely archive the
          // whole thread. If new messages have come in, then we can do
          // nothing and leave the thread in the inbox.
          await gapiFetch(gapi.client.gmail.users.threads.modify, {
            'userId': USER_ID,
            'id': doc.id,
            'removeLabelIds': removeLabelIds,
          });
        }
      }
    }

    // TODO: Technically there's a race here from when we query to when we
    // do the update. A new message could have come in and the user already
    // archives it before this runs and that archive would get lost due to
    // this delete.
    let update: any = {};
    update[firestoreKey] = firebase.firestore.FieldValue.delete();
    await doc.ref.update(update);
  }

  private async moveToInbox_() {
    let querySnapshot = await this.metadataCollection_()
                            .where(ThreadMetadataKeys.moveToInbox, '==', true)
                            .get();

    await this.doInParallel_<firebase.firestore.QueryDocumentSnapshot>(
        querySnapshot.docs,
        async (doc: firebase.firestore.QueryDocumentSnapshot) => {
          await this.addLabels_(doc.id, ['INBOX']);
          let update: ThreadMetadataUpdate = {
            moveToInbox: firebase.firestore.FieldValue.delete(),
          };
          await doc.ref.update(update);
        });
  }

  private async modifyLabels_(
      threadId: string, addLabelIds: string[], removeLabelIds: string[]) {
    await gapiFetch(gapi.client.gmail.users.threads.modify, {
      userId: USER_ID,
      id: threadId,
      addLabelIds: addLabelIds,
      removeLabelIds: removeLabelIds,
    });
  }

  private async addLabels_(threadId: string, labels: string[]) {
    await this.modifyLabels_(threadId, labels, []);
  }

  private async removeLabels_(threadId: string, labels: string[]) {
    await this.modifyLabels_(threadId, [], labels);
  }

  private async addMakeTimeLabel_(id: string) {
    await this.addLabels_(id, [defined(this.makeTimeLabelId_)]);
  }

  private async removeMakeTimeLabel_(id: string) {
    await this.removeLabels_(id, [defined(this.makeTimeLabelId_)]);
  }

  private spacesToDashes_(str: string) {
    return str.replace(/ /g, '-');
  }

  private async pushLabelsToGmail_() {
    let querySnapshot =
        await this.metadataCollection_()
            .where(ThreadMetadataKeys.pushLabelsToGmail, '==', true)
            .get();

    if (!querySnapshot.docs.length)
      return;

    // Ensure parent labels exist first.
    await this.ensureLabelsExist_(
        MAKE_TIME_LABEL_NAME, LABEL_LABEL_NAME, PRIORITY_LABEL_NAME);

    let labelPrefix = `${LABEL_LABEL_NAME}/`;
    let priorityPrefix = `${PRIORITY_LABEL_NAME}/`;

    let mktimeLabelAndPriorityLabels =
        (await this.getExistingMakeTimeLabels_()).filter(x => {
          let name = defined(x.name);
          return name.startsWith(labelPrefix) ||
              name.startsWith(priorityPrefix);
        });

    await this.doInParallel_<firebase.firestore.QueryDocumentSnapshot>(
        querySnapshot.docs,
        async (doc: firebase.firestore.QueryDocumentSnapshot) => {
          // TODO: Do something to apply due/stuck dates as labels?
          let data = doc.data() as ThreadMetadata;

          let resp = await gapiFetch(gapi.client.gmail.users.threads.get, {
            userId: USER_ID,
            id: doc.id,
            format: 'minimal',
            fields: 'messages(labelIds)',
          });

          let existingLabelIds: Set<string> = new Set();
          if (resp.result.messages) {
            for (let message of resp.result.messages) {
              defined(message.labelIds).map(x => existingLabelIds.add(x));
            }
          }

          let existingMktimeLabelIds =
              Array.from(existingLabelIds)
                  .filter(
                      x => mktimeLabelAndPriorityLabels.find(y => y.id === x));

          let addLabelIds = [];
          let removeLabelIds = existingMktimeLabelIds;

          if (data.muted)
            addLabelIds.push('MUTE');
          else if (existingLabelIds.has('MUTE'))
            removeLabelIds.push('MUTE');

          let labelName = `${LABEL_LABEL_NAME}/${
              getLabelName(defined(this.queueNames_), data.labelId)}`;
          await this.addRemoveLabel_(
              mktimeLabelAndPriorityLabels, existingMktimeLabelIds, labelName,
              addLabelIds, removeLabelIds);

          if (data.priorityId) {
            let priorityName =
                `${PRIORITY_LABEL_NAME}/${getPriorityName(data.priorityId)}`;
            await this.addRemoveLabel_(
                mktimeLabelAndPriorityLabels, existingMktimeLabelIds,
                priorityName, addLabelIds, removeLabelIds);
          }

          await this.modifyLabels_(doc.id, addLabelIds, removeLabelIds);
          let update: ThreadMetadataUpdate = {
            pushLabelsToGmail: firebase.firestore.FieldValue.delete(),
          };
          await doc.ref.update(update);
        });
  }

  private async addRemoveLabel_(
      mktimeLabelAndPriorityLabels: gapi.client.gmail.Label[],
      existingMktimeLabelIds: string[], labelName: string,
      addLabelIds: string[], removeLabelIds: string[]) {
    labelName = this.spacesToDashes_(labelName);
    let gmailLabel =
        mktimeLabelAndPriorityLabels.find(x => x.name === labelName);

    if (!gmailLabel) {
      gmailLabel = (await this.ensureLabelsExist_(labelName))[0];
      mktimeLabelAndPriorityLabels.push(gmailLabel);
    }

    let labelId = defined(gmailLabel.id);
    if (!existingMktimeLabelIds.includes(labelId))
      addLabelIds.push(labelId);
    removeLabelIds = removeLabelIds.filter(x => x !== labelId);
  }

  private async syncWithGmail_() {
    // Add back in threads that were archived and then undone and
    // flush any pending archives/markReads from maketime.
    // Do these in parallel to minimize network round trips.
    await Promise.all([
      this.moveToInbox_(),
      this.removeGmailLabels_(
          ThreadMetadataKeys.countToArchive,
          ['INBOX', defined(this.makeTimeLabelId_)]),
      this.removeGmailLabels_(ThreadMetadataKeys.countToMarkRead, ['UNREAD']),
      this.pushLabelsToGmail_(),
    ]);

    // This has to happen after the removeGmailLabels_ calls above as those
    // calls remove threads from the inbox.
    await this.forEachThread_(
        'in:inbox -in:mktime',
        (thread) => this.processThread(defined(thread.id)), 'Updating...');

    // For anything that used to be in the inbox, but isn't anymore (e.g.
    // the user archived from gmail), clear it's metadata so it doesn't show
    // up in maketime either. Include spam and trash in this query since we
    // want to remove messages that were marked as spam/trash in gmail as
    // well.
    await this.forEachThread_(
        '-in:inbox in:mktime', (thread) => this.clearMetadata_(thread),
        'Removing messages archived from gmail...', true);
  }

  private async doInParallel_<T>(items: T[], callback: (t: T) => void) {
    const taskQueue = new TaskQueue(3);
    for (let item of items) {
      taskQueue.queueTask(async () => {
        // We don't want an error processing one thread to prevent
        // processing all the other threads since usually those errors are
        // specific to something unexpected with that specific thread.
        try {
          await callback(item);
        } catch (e) {
          ErrorLogger.log(e.message, e.stack);
        }
      });
    }
    await taskQueue.flush();
  }

  async forEachThread_(
      query: string,
      callback: (thread: gapi.client.gmail.Thread) => Promise<void>,
      title: string, includeSpamTrash?: boolean) {
    let threads = await this.fetchThreads_(query, includeSpamTrash);
    if (!threads.length)
      return;

    let progress = AppShell.updateLoaderTitle(
        'MailProcessor.forEachThread_', threads.length, title);

    await this.doInParallel_<gapi.client.gmail.Thread>(
        threads, async (thread: gapi.client.gmail.Thread) => {
          progress.incrementProgress();
          await callback(thread);
        });
  }

  async fetchThreads_(query: string, includeSpamTrash?: boolean) {
    // Chats don't expose their bodies in the gmail API, so just skip them.
    query = `(${query}) AND -in:chats`;
    let threads: gapi.client.gmail.Thread[] = [];

    let getPageOfThreads = async (opt_pageToken?: string) => {
      let requestParams = <FetchRequestParameters>{
        'userId': USER_ID,
        'q': query,
      };

      if (includeSpamTrash)
        requestParams.includeSpamTrash = includeSpamTrash;

      if (opt_pageToken)
        requestParams.pageToken = opt_pageToken;

      let resp =
          await gapiFetch(gapi.client.gmail.users.threads.list, requestParams);
      threads = threads.concat(resp.result.threads || []);

      if (resp.result.nextPageToken)
        await getPageOfThreads(resp.result.nextPageToken);
    };

    await getPageOfThreads();
    return threads;
  }

  private async getThread_(threadId: string, metadata?: ThreadMetadata) {
    if (!metadata)
      metadata = await Thread.fetchMetadata(threadId);

    let thread = Thread.create(threadId, metadata);
    // Grab the messages we have off disk first to avoid sending those bytes
    // down the wire if we already have them.
    await thread.fetchFromDisk();
    await thread.update();
    return thread;
  }

  async processThread(threadId: string) {
    let thread = await this.getThread_(threadId);
    let messages = thread.getMessages();
    assert(
        messages.length,
        'This should never happen. Please file a bug if you see this.');

    // Gmail has phantom messages that keep threads in the inbox but that
    // you can't access. Archive the whole thread for these messages. See
    // https://issuetracker.google.com/issues/122167541.
    let inInbox = messages.some(x => x.getLabelIds().includes('INBOX'));
    // Check via local storage whether the thread is in the inbox. If local
    // storage says it's not, then double check by talking directly to the
    // gmail API to ensure bugs in thread caching don't cause us to
    // accidentally archive threads.
    if (!inInbox) {
      let reallyInInbox = await this.refetchIsInInbox_(thread.id);
      if (!reallyInInbox) {
        await gapiFetch(gapi.client.gmail.users.threads.modify, {
          userId: USER_ID,
          id: thread.id,
          removeLabelIds: ['INBOX'],
        });
        return;
      }
    }

    await this.applyFilters_(thread);
  }

  private async refetchIsInInbox_(threadId: string) {
    let response = await gapiFetch(gapi.client.gmail.users.threads.get, {
      'userId': USER_ID,
      'id': threadId,
      fields: 'messages(labelIds)',
    });
    let messages = defined(defined(defined(response).result).messages);
    return messages.some(x => defined(x.labelIds).includes('INBOX'));
  }

  private async clearMetadata_(thread: gapi.client.gmail.Thread) {
    let id = defined(thread.id);
    // Do one last fetch to ensure a new message hasn't come in that puts
    // the thread back in the inbox, then clear metadata.
    let inInbox = await this.refetchIsInInbox_(id);
    if (!inInbox) {
      await Thread.clearMetadata(id);
      await this.removeMakeTimeLabel_(id);
    } else {
      // If one of the messages is in the inbox, move them all to the inbox
      // so that gmail doesn't keep returning this thread for a "-in:inbox"
      // query.
      await this.addLabels_(id, ['INBOX']);
    }
  }

  containsAddress(addresses: ParsedAddress[], filterAddressCsv: string) {
    if (!addresses.length)
      return false;

    var filterAddresses =
        filterAddressCsv.split(',').map((item) => item.trim());
    for (var i = 0; i < filterAddresses.length; i++) {
      var filterAddress = filterAddresses[i];
      let re = ruleRegexp(filterAddress);
      if (re) {
        for (let address of addresses) {
          if (re.test(address.address.toLowerCase()) ||
              re.test(address.name.toLowerCase()))
            return true;
        }
      } else {
        for (let address of addresses) {
          let lowerCase = filterAddress.toLowerCase();
          if (address.address.toLowerCase().includes(lowerCase) ||
              address.name.toLowerCase().includes(lowerCase))
            return true;
        }
      }
    }
    return false;
  }

  matchesHeader_(message: Message, header: HeaderFilterRule) {
    let headerValue = message.getHeaderValue(header.name);
    return headerValue && stringFilterMatches(header.value, headerValue);
  }

  matchesRule(rule: FilterRule, message: Message) {
    var matches = false;
    if (rule.nolistid) {
      if (message.listId)
        return false;
      matches = true;
    }

    let parsedToCcBcc =
        [...message.parsedTo, ...message.parsedCc, ...message.parsedBcc];

    if (rule.nocc) {
      if (parsedToCcBcc.length != 1)
        return false;
      matches = true;
    }
    if (rule.to) {
      if (!this.containsAddress(parsedToCcBcc, rule.to))
        return false;
      matches = true;
    }
    if (rule.from) {
      if (!this.containsAddress(message.parsedFrom, rule.from))
        return false;
      matches = true;
    }
    if (rule.header) {
      for (let header of rule.header) {
        if (!this.matchesHeader_(message, header))
          return false;
      }
      matches = true;
    }
    // TODO: only need to do this once per thread.
    if (rule.subject) {
      if (!message.subject ||
          !stringFilterMatches(rule.subject, message.subject))
        return false;
      matches = true;
    }
    if (rule.plaintext) {
      if (!stringFilterMatches(rule.plaintext, message.getPlain()))
        return false;
      matches = true;
    }
    if (rule.htmlcontent) {
      if (!stringFilterMatches(rule.htmlcontent, message.getHtmlOrPlain()))
        return false;
      matches = true;
    }
    return matches;
  }

  // TODO: Also log which message matched.
  logMatchingRule_(thread: Thread, rule: FilterRule) {
    if (this.settings_.get(ServerStorage.KEYS.LOG_MATCHING_RULES)) {
      console.log(`Thread with subject "${thread.getSubject()}" matched rule ${
          JSON.stringify(rule)}`);
    }
  }

  private getWinningLabel_(thread: Thread, rules: FilterRule[]) {
    var messages = thread.getMessages();

    for (let rule of rules) {
      if (rule.matchallmessages) {
        let matches = false;
        for (let message of messages) {
          matches = this.matchesRule(rule, message);
          if (!matches)
            break;
        }
        if (matches) {
          this.logMatchingRule_(thread, rule);
          return rule.label;
        }
      } else {
        for (let message of messages) {
          if (this.matchesRule(rule, message)) {
            this.logMatchingRule_(thread, rule);
            return rule.label;
          }
        }
      }
    }

    // Ensure there's always some label to make sure bugs don't cause emails
    // to get lost silently.
    return Labels.Fallback;
  }

  private async applyFilters_(thread: Thread) {
    let rules = await this.settings_.getFilters();
    let label = this.getWinningLabel_(thread, rules);

    if (label == Labels.Archive) {
      await thread.archive(true);
      return;
    }

    let hasNewLabel = thread.getLabel() !== label;
    if (!hasNewLabel && thread.isMuted()) {
      await thread.applyMute();
      return;
    }

    if (hasNewLabel || !thread.isSoftMuted())
      await this.applyLabel_(thread, label, hasNewLabel);

    // Do this at the end to ensure that the label is set before clearing the
    // label in gmail.
    await this.addMakeTimeLabel_(thread.id);
  }

  async applyLabel_(thread: Thread, label: string, hasNewLabel: boolean) {
    let labelId = await defined(this.queueNames_).getId(label);

    // If a thread already has a priority ID or blocked date and the label isn't
    // changing, skip putting it back in the triage queue if the new messages
    // were sent myself or if some of the previous messages were unread.
    if (thread.getPriorityId() || thread.isStuck()) {
      let makeTimeLabelId = defined(this.makeTimeLabelId_);
      let newMessages = thread.getMessages().filter(x => {
        let ids = x.getLabelIds()
        return !ids.includes(makeTimeLabelId) && !ids.includes('SENT');
      });

      // If all the new messages are from me, then don't mark it as needing
      // triage.
      if (newMessages.length === 0) {
        // Early return even if the thread has a new label since that's  the
        // case of sending yourself a message and then immediately triaging it
        // from the compose view. But apply the new label still since we don't
        // want messages sent to yourself to not have any label.
        if (hasNewLabel)
          await thread.setOnlyLabel(label);
        return;
      }

      let oldMessagesWereUnread = thread.readCount() <
          (thread.getMessages().length - newMessages.length);
      if (!hasNewLabel && oldMessagesWereUnread)
        return;
    }

    let queueSettings = this.settings_.getQueueSettings().get(label);
    // Don't queue if it already has a priority or is in the triage queue.
    let shouldQueue = !thread.getPriorityId() && !thread.needsTriage() &&
        queueSettings.queue !== QueueSettings.IMMEDIATE;

    // Queue durations are longer than the throttle duration, so no need to mark
    // it as throttled if it's going to be queued. If the throttle duration is
    // 0, then don't throttle it just to unthrottled the next update.
    // If no filters applied and we're applying the fallback label, don't
    // throttle that either since it may be something new and unknown.
    let shouldThrottle = !shouldQueue && label !== Labels.Fallback &&
        queueSettings.throttle === ThrottleOption.throttle &&
        this.settings_.get(ServerStorage.KEYS.THROTTLE_DURATION) != 0;

    thread.applyLabel(labelId, shouldQueue, shouldThrottle);
  }

  async dequeue(query: firebase.firestore.Query) {
    await this.doInParallel_<firebase.firestore.QueryDocumentSnapshot>(
        (await query.get()).docs,
        async (doc: firebase.firestore.QueryDocumentSnapshot) => {
          await doc.ref.update({
            hasLabel: true,
            queued: firebase.firestore.FieldValue.delete(),
            blocked: firebase.firestore.FieldValue.delete(),
            throttled: firebase.firestore.FieldValue.delete(),
          });
        });
  }

  async dequeueDateKeys_(key: ThreadMetadataKeys) {
    let querySnapshot =
        await this.metadataCollection_().where(key, '<=', Date.now()).get();

    await this.doInParallel_<firebase.firestore.QueryDocumentSnapshot>(
        querySnapshot.docs,
        async (doc: firebase.firestore.QueryDocumentSnapshot) => {
          if (doc.data().dueDateExpired)
            return;

          let update: ThreadMetadataUpdate = {
            hasLabel: true,
          };

          if (key === ThreadMetadataKeys.due)
            update.dueDateExpired = true;

          await doc.ref.update(update);
        });
  }

  async dequeueRetriage_(priority: Priority, retriageDays: number) {
    let querySnapshot =
        await this.metadataCollection_()
            .where(ThreadMetadataKeys.priorityId, '==', priority)
            .get();

    let count = querySnapshot.docs.length;
    let amountToRetriage =
        Math.min(MAX_RETRIAGE_COUNT, Math.ceil(count / retriageDays));
    var oneDay = 24 * 60 * 60 * 1000;
    let now = Date.now();

    let lacksLabel = querySnapshot.docs.filter(x => {
      let data = x.data();
      if (data.hasLabel)
        return false;
      if (!data.retriageTimestamp)
        return true;
      let daysSinceLastTriaged = (now - data.retriageTimestamp) / oneDay;
      return daysSinceLastTriaged > retriageDays;
    });

    // Shuffle the array.
    for (let i = lacksLabel.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lacksLabel[i], lacksLabel[j]] = [lacksLabel[j], lacksLabel[i]];
    }

    let retriage = lacksLabel.slice(0, amountToRetriage);
    await this.doInParallel_<firebase.firestore.QueryDocumentSnapshot>(
        retriage, async (doc: firebase.firestore.QueryDocumentSnapshot) => {
          // Put the thread back in the triage queue (hasLabel) and denote
          // needsTriage so it is grouped with the other retriage threads.
          let update: ThreadMetadataUpdate = {
            hasLabel: true,
            needsRetriage: true,
          };
          // TODO: Remove this once all clients have flushed all their
          // threads that don't have labels.
          if (!doc.data().labelId)
            update.labelId = BuiltInLabelIds.Fallback;
          await doc.ref.update(update);
        });
  }

  private async processRetriage_() {
    // If there are still untriaged needsRetriage threads, then don't add
    // more to the pile.
    let needsRetriage = await this.metadataCollection_()
                            .where(ThreadMetadataKeys.needsRetriage, '==', true)
                            .get();
    if (!needsRetriage.docs.length) {
      await this.dequeueRetriage_(
          Priority.MustDo, MUST_DO_RETRIAGE_FREQUENCY_DAYS);
      await this.dequeueRetriage_(
          Priority.Urgent, URGENT_RETRIAGE_FREQUENCY_DAYS);
      await this.dequeueRetriage_(
          Priority.Backlog, BACKLOG_RETRIAGE_FREQUENCY_DAYS);
    }
  }

  private async processSoftMute_() {
    let querySnapshot = await this.metadataCollection_()
                            .where(ThreadMetadataKeys.softMuted, '==', true)
                            .get();

    var oneDay = 24 * 60 * 60 * 1000;
    let now = Date.now();

    // For manual testing: artificially set the date in the future so these get
    // processed.
    // let time = new Date(now);
    // time.setDate(time.getDate() + SOFT_MUTE_EXPIRATION_DAYS);
    // now = time.getTime();

    let muteExpired = querySnapshot.docs.filter(x => {
      let daysSinceLastTriaged = (now - x.data().retriageTimestamp) / oneDay;
      return daysSinceLastTriaged > SOFT_MUTE_EXPIRATION_DAYS;
    });

    await this.doInParallel_<firebase.firestore.QueryDocumentSnapshot>(
        muteExpired, async (doc: firebase.firestore.QueryDocumentSnapshot) => {
          let update: ThreadMetadataUpdate;

          let data = doc.data() as ThreadMetadata;
          if (data.newMessagesSinceSoftMuted) {
            update = {
              softMuted: firebase.firestore.FieldValue.delete(),
              hasLabel: true,
            };
          } else {
            update = Thread.baseArchiveUpdate(data.messageIds.length);
          }

          await doc.ref.update(update);
        });
  }

  private async processSingleQueue_(queue: string) {
    if (queue === QueueSettings.DAILY) {
      await this.dequeueDateKeys_(ThreadMetadataKeys.blocked);
      await this.dequeueDateKeys_(ThreadMetadataKeys.due);
      await this.processRetriage_();
      await this.processSoftMute_();
    }

    let queueDatas = this.settings_.getQueueSettings().entries();
    for (let queueData of queueDatas) {
      if (queueData[1].queue == queue)
        await this.dequeue(
            this.metadataCollection_()
                .where(
                    ThreadMetadataKeys.labelId,
                    '==', await defined(this.queueNames_).getId(queueData[0]))
                .where(ThreadMetadataKeys.queued, '==', true));
    }
  }

  categoriesToDequeue(startTime: number, opt_endTime?: number) {
    if (!startTime) {
      let today = QueueSettings.WEEKDAYS[new Date().getDay()];
      return [today, QueueSettings.DAILY];
    }

    let start = Number(startTime);
    let end = opt_endTime || Date.now();

    var oneDay = 24 * 60 * 60 * 1000;
    var diffDays = (end - start) / (oneDay);

    if (diffDays >= 30)
      return QueueSettings.WEEKDAYS.concat(
          [QueueSettings.DAILY, QueueSettings.MONTHLY]);
    if (diffDays >= 7)
      return QueueSettings.WEEKDAYS.concat([QueueSettings.DAILY]);

    let startDate = new Date(start);
    let endDate = new Date(end);
    let startDay = startDate.getDay();
    let endDay = endDate.getDay();

    // Have already processed today.
    if (startDay == endDay && diffDays < 1)
      return [];

    let days: string[] = [];

    while (true) {
      var modded = ++startDay % QueueSettings.WEEKDAYS.length;
      days.push(QueueSettings.WEEKDAYS[modded]);
      if (modded == endDay)
        break;
    }

    days.push(QueueSettings.DAILY);

    if (startDate.getMonth() < endDate.getMonth())
      days.push(QueueSettings.MONTHLY);

    return days;
  }

  private async processThrottled_() {
    let storage = await getServerStorage();
    await storage.fetch();
    let lastDethrottleTime =
        storage.get(ServerStorage.KEYS.LAST_DETHROTTLE_TIME);

    let msPerHour = 1000 * 60 * 60;
    let hours = (Date.now() - Number(lastDethrottleTime)) / msPerHour;
    let throttleDuration =
        Number(this.settings_.get(ServerStorage.KEYS.THROTTLE_DURATION));

    if (hours < throttleDuration)
      return;

    await this.dequeue(this.metadataCollection_().where(
        ThreadMetadataKeys.throttled, '==', true));

    let updates: StorageUpdates = {};
    updates[ServerStorage.KEYS.LAST_DETHROTTLE_TIME] = Date.now();
    await storage.writeUpdates(updates);
  }

  private async processQueues_() {
    let storage = await getServerStorage();
    await storage.fetch();

    let lastDequeueTime = storage.get(ServerStorage.KEYS.LAST_DEQUEUE_TIME);
    // Leaving in for easy manual testing of dequeuing code. Delete if this
    // is in the way of a code change.
    //
    // let time = new Date(lastDequeueTime);
    // let DAYS_BACK = 1;
    // time.setDate(time.getDate() - DAYS_BACK);
    // lastDequeueTime = time.getTime();
    const categories = this.categoriesToDequeue(lastDequeueTime);

    if (!categories.length)
      return;

    for (const category of categories) {
      await this.processSingleQueue_(category);
    }

    let updates: StorageUpdates = {};
    updates[ServerStorage.KEYS.LAST_DEQUEUE_TIME] = Date.now();
    await storage.writeUpdates(updates);
  }
}
