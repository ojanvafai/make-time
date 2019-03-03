import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {assert, defined, ParsedAddress, USER_ID} from './Base.js';
import {FetchRequestParameters, firestoreUserCollection, getServerStorage} from './BaseMain.js';
import {ErrorLogger} from './ErrorLogger.js';
import {Labels} from './Labels.js';
import {Message} from './Message.js';
import {gapiFetch} from './Net.js';
import {QueueNames} from './QueueNames.js';
import {QueueSettings} from './QueueSettings.js';
import {ServerStorage, StorageUpdates} from './ServerStorage.js';
import {FilterRule, HeaderFilterRule, Settings} from './Settings.js';
import {TaskQueue} from './TaskQueue.js';
import {BuiltInLabels, Thread, ThreadMetadataKeys, ThreadMetadataUpdate} from './Thread.js';
import {AppShell} from './views/AppShell.js';

let MAKE_TIME_LABEL_NAME = 'mktime';

export class MailProcessor {
  private makeTimeLabelId_?: string;

  constructor(private settings_: Settings) {}

  private async fetchMakeTimeLabel_() {
    if (this.makeTimeLabelId_)
      return;

    var response = await gapiFetch(
        gapi.client.gmail.users.labels.list, {'userId': USER_ID});
    let labels = defined(response.result.labels);
    let label = labels.find(x => x.name === MAKE_TIME_LABEL_NAME);
    if (!label) {
      let resp = await gapiFetch(gapi.client.gmail.users.labels.create, {
        name: MAKE_TIME_LABEL_NAME,
        messageListVisibility: 'hide',
        labelListVisibility: 'labelHide',
        userId: USER_ID,
      });
      label = resp.result;
    }

    this.makeTimeLabelId_ = label.id;
  }

  async process() {
    await this.fetchMakeTimeLabel_();
    await this.processQueues_();
    await this.syncWithGmail_();
  }

  // Only remove labels from messages that were seen by the user at the time
  // they took the action.
  private async removeGmailLabels_(
      firestoreKey: string, removeLabelIds: string[]) {
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    let querySnapshot =
        await metadataCollection.where(firestoreKey, '>', 0).get();

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

      let newMessages = defined(newMessageData.result.messages);
      if (newMessages.length === count) {
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
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    let querySnapshot = await metadataCollection
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

  private async syncWithGmail_() {
    // Add back in threads that were archived and then undone and
    // flush any pending archives/markReads from maketime.
    // Do these in parallel to minimize network round trips.
    await Promise.all([
      this.moveToInbox_(),
      this.removeGmailLabels_(
          ThreadMetadataKeys.countToArchive,
          ['INBOX', 'UNREAD', defined(this.makeTimeLabelId_)]),
      this.removeGmailLabels_(ThreadMetadataKeys.countToMarkRead, ['UNREAD'])
    ]);

    // This has to happen after the removeGmailLabels_ calls above as those
    // calls remove threads from the inbox.
    await this.forEachThread_(
        'in:inbox -in:mktime', (thread) => this.processThread_(thread),
        'Updating...');

    // For anything that used to be in the inbox, but isn't anymore (e.g. the
    // user archived from gmail), clear it's metadata so it doesn't show up in
    // maketime either. Include spam and trash in this query since we want to
    // remove messages that were marked as spam/trash in gmail as well.
    await this.forEachThread_(
        '-in:inbox in:mktime', (thread) => this.clearMetadata_(thread),
        'Removing messages archived from gmail...', true);
  }

  private async doInParallel_<T>(items: T[], callback: (t: T) => void) {
    const taskQueue = new TaskQueue(3);
    for (let item of items) {
      taskQueue.queueTask(async () => callback(item));
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

  private async processThread_(rawThread: gapi.client.gmail.Thread) {
    let threadId = defined(rawThread.id);
    let metadata = await Thread.fetchMetadata(threadId);
    let thread = Thread.create(threadId, metadata);
    await thread.fetchFromDisk();

    if (!thread.mightNeedUpdate(defined(rawThread.historyId))) {
      await this.addMakeTimeLabel_(threadId);
      return;
    }

    // If we got here, then the thread definitely needs updating in case new
    // messages came in.
    await thread.update();

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

    // Everything in the inbox should have a labelId and/or a priorityId.
    // This can happen if something had been processed, then archived, then
    // the user manually puts it back in the inbox. The thread metadata in
    // firestore shows doesn't indicate new messages since there aren't
    // actually new messages, but we still want to filter it.
    if (thread.needsFiltering() ||
        (!thread.getLabelId() && !thread.getPriorityId() &&
         !thread.isBlocked())) {
      await this.applyFilters_(thread);
    }
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
      // If one of the messages is in the inbox, move them all to the inbox so
      // that gmail doesn't keep returning this thread for a "-in:inbox"
      // query.
      await this.addLabels_(id, ['INBOX']);
    }
  }

  endsWithAddress(addresses: ParsedAddress[], filterAddress: string) {
    for (var j = 0; j < addresses.length; j++) {
      if (addresses[j].address.endsWith(filterAddress))
        return true;
    }
    return false;
  }

  matchesRegexp(regex: string, str: string) {
    return (new RegExp(regex, 'm')).test(str);
  }

  // This is to avoid triggering regexps accidentally on plain test things
  // being run through this.matchesRegexp
  escapeRegExp(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  startsWithAddress(addresses: ParsedAddress[], filterAddress: string) {
    var parts = this.escapeRegExp(filterAddress).split('@');
    var regexp = '^' + parts[0] + '(?:\\+[^@]*?)?@' + parts[1];
    for (var j = 0; j < addresses.length; j++) {
      if (this.matchesRegexp(regexp, addresses[j].address))
        return true;
    }
    return false;
  }

  containsAddress(addresses: ParsedAddress[], filterAddressCsv: string) {
    if (!addresses.length)
      return false;

    var filterAddresses =
        filterAddressCsv.split(',').map((item) => item.trim());
    for (var i = 0; i < filterAddresses.length; i++) {
      var filterAddress = filterAddresses[i];
      // If there's no @ symbol, we don't know if it's a username or a domain.
      // Try both.
      if (filterAddress.includes('@')) {
        if (this.startsWithAddress(addresses, filterAddress))
          return true;
      } else {
        if (this.startsWithAddress(addresses, filterAddress + '@'))
          return true;
        if (this.endsWithAddress(addresses, '@' + filterAddress))
          return true;
      }
    }
    return false;
  }

  matchesHeader_(message: Message, header: HeaderFilterRule) {
    let headerValue = message.getHeaderValue(header.name);
    return headerValue &&
        headerValue.toLowerCase().trim().includes(header.value);
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
          !message.subject.toLowerCase().includes(rule.subject))
        return false;
      matches = true;
    }
    if (rule.plaintext) {
      if (!message.getPlain().toLowerCase().includes(rule.plaintext))
        return false;
      matches = true;
    }
    if (rule.htmlcontent) {
      if (!message.getHtmlOrPlain().toLowerCase().includes(rule.htmlcontent))
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
    try {
      if (thread.isMuted()) {
        await thread.archive();
        return;
      }

      let rules = await this.settings_.getFilters();
      let label = this.getWinningLabel_(thread, rules);

      if (label == Labels.Archive) {
        await thread.archive();
        return;
      }

      // If it already has a priority, or it's already in dequeued with a
      // labelId, don't queue it.
      let shouldQueue = !thread.getPriorityId() &&
          (!thread.getLabelId() || thread.isQueued()) &&
          (this.settings_.getQueueSettings().get(label).queue !=
           QueueSettings.IMMEDIATE);

      // Need to clear needsFiltering
      await thread.setLabelAndQueued(shouldQueue, label);
      await this.addMakeTimeLabel_(thread.id);
    } catch (e) {
      ErrorLogger.log(`Failed to process message.\n\n${JSON.stringify(e)}`);
    }
  }

  async dequeue(labelId: number) {
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    let querySnapshot = await metadataCollection
                            .where(ThreadMetadataKeys.labelId, '==', labelId)
                            .where(ThreadMetadataKeys.queued, '==', true)
                            .get();

    await this.doInParallel_<firebase.firestore.QueryDocumentSnapshot>(
        querySnapshot.docs,
        async (doc: firebase.firestore.QueryDocumentSnapshot) => {
          await doc.ref.update({
            queued: firebase.firestore.FieldValue.delete(),
          });
        });
  }

  async dequeueBlocked_() {
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    let querySnapshot =
        await metadataCollection.where(ThreadMetadataKeys.blocked, '==', true)
            .get();

    await this.doInParallel_<firebase.firestore.QueryDocumentSnapshot>(
        querySnapshot.docs,
        async (doc: firebase.firestore.QueryDocumentSnapshot) => {
          await doc.ref.update({
            blocked: firebase.firestore.FieldValue.delete(),
            labelId: BuiltInLabels.Blocked,
            hasLabel: true,
          } as ThreadMetadataUpdate);
        });
  }

  async processSingleQueue(queue: string) {
    if (queue === QueueSettings.DAILY)
      await this.dequeueBlocked_();

    let queueNames = new QueueNames();
    let queueDatas = this.settings_.getQueueSettings().entries();
    for (let queueData of queueDatas) {
      if (queueData[1].queue == queue)
        await this.dequeue(await queueNames.getId(queueData[0]));
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

  private async processQueues_() {
    let storage = await getServerStorage();
    await storage.fetch();
    let lastDequeueTime = storage.get(ServerStorage.KEYS.LAST_DEQUEUE_TIME);
    const categories = this.categoriesToDequeue(lastDequeueTime);

    if (!categories.length)
      return;

    for (const category of categories) {
      await this.processSingleQueue(category);
    }

    let updates: StorageUpdates = {};
    updates[ServerStorage.KEYS.LAST_DEQUEUE_TIME] = Date.now();
    await storage.writeUpdates(updates);
  }
}
