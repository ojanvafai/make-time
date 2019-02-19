import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {defined, ParsedAddress, showDialog, USER_ID} from './Base.js';
import {fetchThreads, firestoreUserCollection, getLabels, getServerStorage} from './BaseMain.js';
import {ErrorLogger} from './ErrorLogger.js';
import {Labels} from './Labels.js';
import {Message} from './Message.js';
import {gapiFetch} from './Net.js';
import {QueueNames} from './QueueNames.js';
import {QueueSettings} from './QueueSettings.js';
import {RadialProgress} from './RadialProgress.js';
import {ServerStorage, StorageUpdates} from './ServerStorage.js';
import {FilterRule, HeaderFilterRule, Settings} from './Settings.js';
import {BuiltInLabels, Thread, ThreadMetadataKeys, ThreadMetadataUpdate} from './Thread.js';

export class MailProcessor {
  constructor(public settings: Settings) {}

  async process() {
    await this.processQueues_();
    await this.syncWithGmail_();
  }

  // TODO: Delete this once all clients have upgraded.
  async migrateThreadsToFirestore() {
    let labels = await getLabels();
    let labelsToMigrate = [
      ...(labels.getNeedsTriageLabelNames()),
      ...(labels.getQueuedLabelNames()),
      ...(labels.getPriorityLabelNames()),
      Labels.MUTED_LABEL,
    ];

    if (!labelsToMigrate.length)
      return false;

    let idsToRemove = labelsToMigrate.map(x => labels.getId(x));
    let query = 'in:' + labelsToMigrate.join(' OR in:');
    let threadsToMigrate: gapi.client.gmail.Thread[] = [];
    await fetchThreads(x => threadsToMigrate.push(x), query);

    if (!threadsToMigrate.length)
      return false;

    let progress = new RadialProgress();
    progress.addToTotal(threadsToMigrate.length);
    let dialogContents = document.createElement('div');
    dialogContents.append(
        `Migrating ${threadsToMigrate.length} threads.`, progress);
    let dialog = showDialog(dialogContents);

    for (let gmailThread of threadsToMigrate) {
      let thread = await this.fetchFullThread_(
          defined(gmailThread.id), defined(gmailThread.historyId));

      // Migrate labels to firestore.
      let addToInbox = await thread.migrateMaketimeLabelsToFirestore();
      // Remove the labels from the thread so we don't keep migrating on each
      // update and add everything but muted to the inbox since queued and
      // prioritized threads are now also in the inbox.
      await gapiFetch(gapi.client.gmail.users.threads.modify, {
        'userId': USER_ID,
        'id': thread.id,
        'addLabelIds': addToInbox ? ['INBOX'] : [],
        'removeLabelIds': idsToRemove,
      });

      progress.incrementProgress();
    };

    dialog.close();
    return true;
  }

  // Only remove labels from messages that were seen by the user at the time
  // they took the action.
  private async removeGmailLabels_(
      firestoreKey: string, removeLabelIds: string[]) {
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    let querySnapshot =
        await metadataCollection.where(firestoreKey, '>', 0).get();

    // TODO: Use a TaskQueue and or gapi batch to make this faster?
    for (let doc of querySnapshot.docs) {
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
      // it complicates the code, so meh.
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
  }

  private async moveToInbox_() {
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    let querySnapshot = await metadataCollection
                            .where(ThreadMetadataKeys.moveToInbox, '==', true)
                            .get();

    for (let doc of querySnapshot.docs) {
      await gapiFetch(gapi.client.gmail.users.threads.modify, {
        userId: USER_ID,
        id: doc.id,
        addLabelIds: ['INBOX'],
      });

      let update: ThreadMetadataUpdate = {
        moveToInbox: firebase.firestore.FieldValue.delete(),
      };
      await doc.ref.update(update);
    }
  }

  private async fetchFullThread_(threadId: string, historyId: string) {
    let metadata = await Thread.fetchMetadata(threadId);
    let thread = Thread.create(threadId, metadata);
    await thread.fetchFromDisk();
    if (thread.getHistoryId() !== historyId)
      await thread.update();
    // It's possible to have the same historyId, but to not have the messages
    // locally on disk, so make sure to fetch any messages firestore knows
    // about.
    await thread.syncMessagesInFirestore();
    return thread;
  }

  private async syncWithGmail_() {
    // Add back in threads that were archived and then undone.
    await this.moveToInbox_();

    // Flush any pending archives/markReads from maketime.
    await this.removeGmailLabels_(
        ThreadMetadataKeys.countToArchive, ['INBOX', 'UNREAD']);
    await this.removeGmailLabels_(
        ThreadMetadataKeys.countToMarkRead, ['UNREAD']);

    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    let labelSnapshot =
        await metadataCollection.where(ThreadMetadataKeys.hasLabel, '==', true)
            .get();
    let hasLabelIds = labelSnapshot.docs.map(x => x.id);
    let prioritySnapshot =
        await metadataCollection
            .where(ThreadMetadataKeys.hasPriority, '==', true)
            .get();
    let hasPriorityIds = prioritySnapshot.docs.map(x => x.id);

    let existingIds = new Set([...hasLabelIds, ...hasPriorityIds]);

    // Update maketime with anything in the inbox.
    await fetchThreads(async (gmailThread: gapi.client.gmail.Thread) => {
      let threadId = defined(gmailThread.id);
      let thread =
          await this.fetchFullThread_(threadId, defined(gmailThread.historyId));
      existingIds.delete(threadId);

      // Gmail has phantom messages that keep threads in the inbox but that
      // you can't access. Archive the whole thread for these messages. See
      // https://issuetracker.google.com/issues/122167541.
      let messages = thread.getMessages();
      let inInbox = messages.some(x => x.getLabelIds().includes('INBOX'));
      if (!inInbox) {
        await gapiFetch(gapi.client.gmail.users.threads.modify, {
          userId: USER_ID,
          id: threadId,
          removeLabelIds: ['INBOX'],
        });
      }

      // Everything in the inbox should have a labelId and/or a priorityId.
      // This can happen if something had been processed, then archived, then
      // the user manually puts it back in the inbox. The thread metadata in
      // firestore shows doesn't indicate new messages since there aren't
      // actually new messages, but we still want to filter it.
      if (thread.needsFiltering() ||
          (!thread.getLabelId() && !thread.getPriorityId() &&
           !thread.isBlocked())) {
        await this.processThread_(thread);
      }
    }, `in:inbox`);

    // For anything that used to be in the inbox, but isn't anymore (e.g. the
    // user archived from gmail), clear it's metadata so it doesn't show up in
    // maketime either.
    await this.clearThreadMetadata_(existingIds);
  }

  private async clearThreadMetadata_(ids: Iterable<string>) {
    for (let id of ids) {
      // Do one last fetch to ensure a new message hasn't come in that puts
      // the thread back in the inbox, then clear metadata.
      let response = await gapiFetch(gapi.client.gmail.users.threads.get, {
        'userId': USER_ID,
        'id': id,
        fields: 'messages(labelIds)',
      });
      let messages = defined(defined(defined(response).result).messages);
      let isInInbox = messages.some(x => defined(x.labelIds).includes('INBOX'));
      if (!isInInbox)
        Thread.clearMetadata(id);
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
    if (this.settings.get(ServerStorage.KEYS.LOG_MATCHING_RULES)) {
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
    return Labels.FALLBACK_LABEL;
  }

  private async processThread_(thread: Thread) {
    try {
      if (thread.isMuted()) {
        await thread.archive();
        return;
      }

      let rules = await this.settings.getFilters();
      let label = this.getWinningLabel_(thread, rules);

      if (label == Labels.ARCHIVE_LABEL) {
        await thread.archive();
        return;
      }

      // If it already has a priority, or it's already in dequeued with a
      // labelId, don't queue it.
      let shouldQueue = !thread.getPriorityId() &&
          (!thread.getLabelId() || thread.isQueued()) &&
          (this.settings.getQueueSettings().get(label).queue !=
           QueueSettings.IMMEDIATE);

      // Need to clear needsFiltering
      thread.setLabelAndQueued(shouldQueue, label);
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
    for (let doc of querySnapshot.docs) {
      await doc.ref.update({
        queued: firebase.firestore.FieldValue.delete(),
      });
    }
  }

  async dequeueBlocked_() {
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    let querySnapshot =
        await metadataCollection.where(ThreadMetadataKeys.blocked, '==', true)
            .get();
    for (let doc of querySnapshot.docs) {
      await doc.ref.update({
        blocked: firebase.firestore.FieldValue.delete(),
        labelId: BuiltInLabels.Blocked,
        hasLabel: true,
      } as ThreadMetadataUpdate);
    }
  }

  async processSingleQueue(queue: string) {
    if (queue === QueueSettings.DAILY)
      await this.dequeueBlocked_();

    let queueNames = new QueueNames();
    let queueDatas = this.settings.getQueueSettings().entries();
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
