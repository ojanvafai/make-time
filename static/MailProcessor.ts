import * as firebase from 'firebase/app';

import {assert, deepEqual, defined, FetchRequestParameters, Labels, ParsedAddress, USER_ID} from './Base.js';
import {firestore, getServerStorage} from './BaseMain.js';
import {ErrorLogger} from './ErrorLogger.js';
import {Message} from './Message.js';
import {gapiFetch} from './Net.js';
import {QueueNames} from './QueueNames.js';
import {QueueSettings, ThrottleOption} from './QueueSettings.js';
import {ServerStorage, StorageUpdates} from './ServerStorage.js';
import {FilterRule, HeaderFilterRule, ruleRegexp, Settings, stringFilterMatches} from './Settings.js';
import {TaskQueue} from './TaskQueue.js';
import {BuiltInLabelIds, getLabelName, getPriorityName, MessagesToDeleteKeys, MessagesToDeleteUpdate, Priority, Thread, ThreadMetadata, ThreadMetadataKeys, ThreadMetadataUpdate} from './Thread.js';
import {AppShell} from './views/AppShell.js';

let MAKE_TIME_LABEL_NAME = 'mktime';
let SOFT_MUTE_LABEL_NAME = `${MAKE_TIME_LABEL_NAME}/softmute`;
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

  async init() {
    if (this.makeTimeLabelId_)
      return;
    let labels = await this.ensureLabelsExist_(
        await this.getAllMktimeGmailLabels_(), MAKE_TIME_LABEL_NAME);
    this.makeTimeLabelId_ = labels[0].id;
    this.queueNames_ = QueueNames.create();
  }

  private async getAllMktimeGmailLabels_() {
    var response = await gapiFetch(
        gapi.client.gmail.users.labels.list, {'userId': USER_ID});
    let labels = defined(response.result.labels);
    return labels.filter(x => defined(x.name).startsWith(MAKE_TIME_LABEL_NAME))
  }

  private async ensureLabelsExist_(
      allMktimeGmailLabels: gapi.client.gmail.Label[],
      ...labelNames: string[]) {
    let result = [];
    for (let labelName of labelNames) {
      let label = allMktimeGmailLabels.find(x => x.name === labelName);
      if (!label) {
        let resp = await gapiFetch(gapi.client.gmail.users.labels.create, {
          name: labelName,
          messageListVisibility: 'hide',
          labelListVisibility: 'labelHide',
          userId: USER_ID,
        });
        label = resp.result;
        // Push to the array passed in so that callers have an updated label
        // list.
        allMktimeGmailLabels.push(label);
      }
      result.push(label);
    }
    return result;
  }

  async process() {
    await this.processQueues_();
    await this.pushMktimeUpdatesToGmail_();
    await this.pullGmailUpdatesToMktime_();
    // Process throttled after pullGmailUpdatesToMktime_ for the case of the
    // first sync in the morning where we want to sync and then immediately show
    // all the threads rather than show the throttled threads, then sync, then
    // wait 2hrs to show the synced threads.
    await this.processThrottled_();
    // Do this a second time here in case pulling updates or processing
    // throttled changes the state we push to gmail.
    await this.pushMktimeUpdatesToGmail_();
    await this.garbageCollectGmailMessages_();
    await this.markMessagesAsRead_();
  }

  private populateMarkReadUpdate(
      update: ThreadMetadataUpdate, removeLabelIds: string[]) {
    // Intentionally don't clear messageIdsToMarkRead since we do that
    // when we next pull in the new messages from gmail to avoid having
    // a window where mktime thinks they are unread again.
    update.hasMessageIdsToMarkRead = firebase.firestore.FieldValue.delete();
    removeLabelIds.push('UNREAD');
  }

  private async markMessagesAsRead_() {
    const snapshot =
        await Thread.metadataCollection()
            .where(ThreadMetadataKeys.hasMessageIdsToMarkRead, '==', true)
            .get();

    await this.doInParallel_<firebase.firestore.QueryDocumentSnapshot>(
        snapshot.docs,
        async (doc: firebase.firestore.QueryDocumentSnapshot) => {
          const update: ThreadMetadataUpdate = {};
          const removeLabelIds: string[] = [];
          this.populateMarkReadUpdate(update, removeLabelIds);

          const messageIds = doc.data().messageIdsToMarkRead;
          if (messageIds.length) {
            this.removeGmailLabelsFromDoc_(
                doc.id, messageIds, [], removeLabelIds);
          }
          await doc.ref.update(update);
        });
  }

  private async garbageCollectGmailMessages_() {
    const threadsDocSnapshot = await Thread.threadsDocRef().get();
    let messageIdsToDelete =
        threadsDocSnapshot.get(MessagesToDeleteKeys.gmailMessageIdsToDelete);

    if (!messageIdsToDelete) {
      return;
    }

    await this.doInParallel_<string>(
        messageIdsToDelete,
        async (messageId: string) => {
            await gapiFetch(gapi.client.gmail.users.messages.trash, {
              userId: USER_ID,
              id: messageId,
            })});

    const update: MessagesToDeleteUpdate = {
      gmailMessageIdsToDelete: firebase.firestore.FieldValue.delete()
    };
    Thread.threadsDocRef().update(update);
  }

  private async modifyLabelsOnWholeThread_(
      threadId: string, addLabelIds: string[], removeLabelIds: string[]) {
    await gapiFetch(gapi.client.gmail.users.threads.modify, {
      userId: USER_ID,
      id: threadId,
      addLabelIds: addLabelIds,
      removeLabelIds: removeLabelIds,
    });
  }

  private async removeGmailLabelsFromDoc_(
      docId: string, messageIds: string[], addLabelIds: string[],
      removeLabelIds: string[]) {
    await gapiFetch(gapi.client.gmail.users.messages.batchModify, {
      userId: USER_ID,
      ids: messageIds,
      addLabelIds: addLabelIds,
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
    let newMessageData;
    try {
      newMessageData = await gapiFetch(gapi.client.gmail.users.threads.get, {
        userId: USER_ID,
        id: docId,
        fields: 'messages(id,labelIds)',
      });
    } catch (e) {
      // Threads and messages seem to randomly disappear from gmail, so
      // special case 404s as something that is this case. Technically it
      // could also be mktime bugs where we put an invalid threadId as the
      // doc.id.
      if (e.status !== 404)
        throw e;
      console.log(`Thread no longer exists: ${docId}`);
    }

    if (newMessageData) {
      let newMessages = newMessageData.result.messages;
      // newMessages can be undefined in the case where all the messages on
      // this thread have no labelIds since we restrict the query to ones with
      // labelIds.
      if (!newMessages) {
        return;
      }
      const modifiedMessages =
          newMessages.filter(x => messageIds.includes(defined(x.id)));
      const allLabelsInModifiedMessages =
          new Set(modifiedMessages.flatMap(x => defined(x.labelIds)));
      let modifyFailed =
          addLabelIds.some(
              labelId => !allLabelsInModifiedMessages.has(labelId)) ||
          removeLabelIds.some(
              labelId => allLabelsInModifiedMessages.has(labelId));
      if (modifyFailed) {
        // If new messages haven't come in, then we can safely archive the
        // whole thread. If new messages have come in, then we can do
        // nothing and leave the thread in the inbox.
        await gapiFetch(gapi.client.gmail.users.threads.modify, {
          userId: USER_ID,
          id: docId,
          addLabelIds: addLabelIds,
          removeLabelIds: removeLabelIds,
        });
      }
    }
  }

  private spacesToDashes_(str: string) {
    return str.replace(/ /g, '-');
  }

  private async pushToAddLabelsAndRemoveFromRemovelabels_(
      allMktimeGmailLabels: gapi.client.gmail.Label[],
      preExistingLabelIdsOnThread: string[], labelName: string,
      addLabelIds: string[], removeLabelIds: string[]) {
    labelName = this.spacesToDashes_(labelName);
    let gmailLabel = allMktimeGmailLabels.find(x => x.name === labelName);

    if (!gmailLabel) {
      const newLabels =
          await this.ensureLabelsExist_(allMktimeGmailLabels, labelName);
      gmailLabel = newLabels[0];
    }

    let labelId = defined(gmailLabel.id);
    if (!preExistingLabelIdsOnThread.includes(labelId))
      addLabelIds.push(labelId);
    let removeIndex = removeLabelIds.indexOf(labelId);
    if (removeIndex !== -1) {
      removeLabelIds.splice(removeIndex, 1);
    }
  }

  private async pushMktimeUpdatesToGmailForSingleThread_(
      allMktimeGmailLabels: gapi.client.gmail.Label[],
      doc: firebase.firestore.DocumentSnapshot) {
    const data = doc.data() as ThreadMetadata | undefined;
    if (!data) {
      console.error(
          'Tried to push gmail updates for a document that has no data.');
      return;
    }

    const addLabelIds: string[] = [];
    const removeLabelIds: string[] = [];
    await this.populateGmailLabelsToPush_(
        allMktimeGmailLabels, doc.id, data, addLabelIds, removeLabelIds);

    // TODO; Remove messageCountToPushLabelsToGmail once clients have updated.
    const messageIds = data.messageCountToPushLabelsToGmail ?
        data.messageIds :
        defined(data.messageIdsToPushToGmail);

    let clearFirestoreMetadataUpdate: ThreadMetadataUpdate = {};
    // If messageIdsToMarkRead is the same list of ids as
    // messageIdsToPushToGmail, then we can save a network request by marking
    // them read here.
    if (data.hasMessageIdsToMarkRead &&
        deepEqual(data.messageIdsToMarkRead, messageIds)) {
      this.populateMarkReadUpdate(clearFirestoreMetadataUpdate, removeLabelIds);
    }

    // It should normally be that there's always labesl either being added or
    // removed, but in some cases it's possible to have otherwise, e.g. if you
    // archive and then undo before a sync happens in between. Since gmail
    // 404s in this case, we need to specially handle it aside from just
    // saving network bandwidth.
    if (addLabelIds.length || removeLabelIds.length) {
      await this.removeGmailLabelsFromDoc_(
          doc.id, messageIds, addLabelIds, removeLabelIds);
    }
    clearFirestoreMetadataUpdate.messageCountToPushLabelsToGmail =
        firebase.firestore.FieldValue.delete();
    clearFirestoreMetadataUpdate.hasMessageIdsToPushToGmail =
        firebase.firestore.FieldValue.delete();
    clearFirestoreMetadataUpdate.messageIdsToPushToGmail =
        firebase.firestore.FieldValue.arrayRemove(...messageIds),
    // TODO: Technically there's a race here from when we query to when we
    // do the update. A new message could have come in and the user already
    // archives it before this runs and that archive would get lost due to
    // this delete.
        await doc.ref.update(clearFirestoreMetadataUpdate);
  }

  private async populateGmailLabelsToPush_(
      allMktimeGmailLabels: gapi.client.gmail.Label[], docId: string,
      data: ThreadMetadata, addLabelIds: string[], removeLabelIds: string[]) {
    let resp = await gapiFetch(gapi.client.gmail.users.threads.get, {
      userId: USER_ID,
      id: docId,
      format: 'minimal',
      fields: 'messages(labelIds)',
    });

    let preexistingLabelIds: Set<string> = new Set();
    if (resp.result.messages) {
      for (let message of resp.result.messages) {
        if (message.labelIds) {
          message.labelIds.map(x => preexistingLabelIds.add(x));
        }
      }
    }

    let preexistingMktimeLabels =
        Array.from(allMktimeGmailLabels)
            .filter(x => preexistingLabelIds.has(defined(x.id)));

    let preexistingMktimeLabelIds =
        preexistingMktimeLabels.map(x => defined(x.id));
    let labelPrefix = `${LABEL_LABEL_NAME}/`;
    let priorityPrefix = `${PRIORITY_LABEL_NAME}/`;

    let mktimeLabelAndPriorityLabels = preexistingMktimeLabels.filter(x => {
      let name = defined(x.name);
      return name.startsWith(labelPrefix) || name.startsWith(priorityPrefix);
    });
    removeLabelIds.push(...mktimeLabelAndPriorityLabels.map(x => assert(x.id)));

    // ******************************************
    // Anything that changes the fields we read off DocumentData needs to
    // update Thread.includePushLabelsToGmail_.
    // ******************************************

    const mktimeLabelId = defined(this.makeTimeLabelId_);
    const hasLabelOrPriority = data.hasLabel || data.hasPriority;
    const alreadyInInbox = preexistingLabelIds.has('INBOX');
    if (data.muted || data.softMuted) {
      if (alreadyInInbox) {
        removeLabelIds.push('INBOX', mktimeLabelId);
      }
      if (data.softMuted) {
        await this.pushToAddLabelsAndRemoveFromRemovelabels_(
            allMktimeGmailLabels, preexistingMktimeLabelIds,
            SOFT_MUTE_LABEL_NAME, addLabelIds, removeLabelIds);
      }
    } else {
      if (hasLabelOrPriority) {
        if (!alreadyInInbox) {
          addLabelIds.push('INBOX');
        }
        if (!preexistingMktimeLabelIds.includes(mktimeLabelId)) {
          addLabelIds.push(mktimeLabelId);
        }
      } else if (alreadyInInbox) {
        removeLabelIds.push('INBOX', mktimeLabelId);
      }
    }

    if (!this.settings_.get(ServerStorage.KEYS.PUSH_LABELS_TO_GMAIL)) {
      return;
    }

    // hasLabel will be false in the case where something was archived/muted.
    // Check hasLabel instead of labelId since we intentionally leave labelIds
    // on archived/muted threads. But if hasPriority is true, we still show
    // the thread in mktime and should sync it's label.
    if (hasLabelOrPriority) {
      let labelName = `${LABEL_LABEL_NAME}/${
          getLabelName(defined(this.queueNames_), data.labelId)}`;
      await this.pushToAddLabelsAndRemoveFromRemovelabels_(
          allMktimeGmailLabels, preexistingMktimeLabelIds, labelName,
          addLabelIds, removeLabelIds);
    }

    if (data.priorityId) {
      let priorityName =
          `${PRIORITY_LABEL_NAME}/${getPriorityName(data.priorityId)}`;
      await this.pushToAddLabelsAndRemoveFromRemovelabels_(
          allMktimeGmailLabels, preexistingMktimeLabelIds, priorityName,
          addLabelIds, removeLabelIds);
    }
  }

  private async pushMktimeUpdatesToGmail_() {
    const deprecatedSnapshot =
        await Thread.metadataCollection()
            .where(
                ThreadMetadataKeys.removedMessageCountToPushLabelsToGmail, '>',
                0)
            .get();

    const snapshot =
        await Thread.metadataCollection()
            .where(ThreadMetadataKeys.hasMessageIdsToPushToGmail, '==', true)
            .get();

    const allMktimeGmailLabels = await this.getAllMktimeGmailLabels_();
    // Ensure parent labels exist first.
    await this.ensureLabelsExist_(
        allMktimeGmailLabels, MAKE_TIME_LABEL_NAME, LABEL_LABEL_NAME,
        PRIORITY_LABEL_NAME);

    await this.doInParallel_<firebase.firestore.DocumentSnapshot>(
        [...snapshot.docs, ...deprecatedSnapshot.docs],
        async (doc: firebase.firestore.DocumentSnapshot) => {
          await this.pushMktimeUpdatesToGmailForSingleThread_(
              allMktimeGmailLabels, doc);
        });
  }

  private async pullGmailUpdatesToMktime_() {
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
    await this.forEachThread_('-in:inbox in:mktime', async (thread) => {
      let id = defined(thread.id);
      // Do one last fetch to ensure a new message hasn't come in that puts
      // the thread back in the inbox, then clear metadata.
      if (!await this.refetchIsInInbox_(id)) {
        await Thread.clearMetadata(id);
        await this.modifyLabelsOnWholeThread_(
            id, [], [defined(this.makeTimeLabelId_)]);
      } else {
        // If one of the messages is in the inbox, move them all to the inbox
        // so that gmail doesn't keep returning this thread for a "-in:inbox"
        // query.
        await this.modifyLabelsOnWholeThread_(id, ['INBOX'], []);
      }
    }, 'Removing messages archived from gmail...', true);
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

    await this.applyFilters(thread);
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

  async ruleMatchesMessage(rule: FilterRule, message: Message) {
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
      if (!stringFilterMatches(rule.plaintext, await message.getPlain()))
        return false;
      matches = true;
    }
    if (rule.htmlcontent) {
      if (!stringFilterMatches(
              rule.htmlcontent, await message.getHtmlOrPlain()))
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

  async ruleMatchesMessages(rule: FilterRule, messages: Message[]) {
    if (rule.matchallmessages) {
      let matches = false;
      for (let message of messages) {
        matches = await this.ruleMatchesMessage(rule, message);
        if (!matches)
          break;
      }
      return matches;
    } else {
      for (let message of messages) {
        if (await this.ruleMatchesMessage(rule, message)) {
          return true;
        }
      }
    }
    return false;
  }

  private async getWinningLabel_(thread: Thread, rules: FilterRule[]) {
    var messages = thread.getMessages();
    for (let rule of rules) {
      if (await this.ruleMatchesMessages(rule, messages)) {
        this.logMatchingRule_(thread, rule);
        return rule.label;
      }
    }
    // Ensure there's always some label to make sure bugs don't cause emails
    // to get lost silently.
    return Labels.Fallback;
  }

  async applyFilters(thread: Thread) {
    let rules = await this.settings_.getFilters();
    let label = await this.getWinningLabel_(thread, rules);

    if (label == Labels.Archive) {
      await thread.archive(true);
      return label;
    }

    let hasNewLabel = thread.getLabel() !== label;
    if (!hasNewLabel && thread.isMutedOrSoftMuted()) {
      await thread.applyMute();
      return label;
    }

    await this.applyLabel_(thread, label, hasNewLabel);
    return label;
  }

  async applyLabel_(thread: Thread, label: string, hasNewLabel: boolean) {
    let labelId = await defined(this.queueNames_).getId(label);

    // If a thread already has a priority ID or blocked date and the label
    // isn't changing, skip putting it back in the triage queue if the new
    // messages were sent myself or if some of the previous messages were
    // unread.
    if (thread.getPriorityId() || thread.isStuck()) {
      let makeTimeLabelId = defined(this.makeTimeLabelId_);
      let allOldMessagesWereRead = true;
      let newMessages = thread.getMessages().filter(x => {
        let ids = x.getLabelIds()
        if (!ids.includes(makeTimeLabelId) && !ids.includes('SENT')) {
          return true;
        }
        if (ids.includes('UNREAD')) {
          allOldMessagesWereRead = false;
        }
        return false;
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

      if (!hasNewLabel && !allOldMessagesWereRead)
        return;
    }

    let queueSettings = this.settings_.getQueueSettings().get(label);
    // Don't queue if it already has a priority or is in the triage queue. If
    // it's already in the Fallback label, then that means we are adding a
    // filter rule for it, so apply the regular rules queue settings.
    let shouldQueue = !thread.getPriorityId() &&
        (!thread.needsTriage() || thread.getLabel() === Labels.Fallback) &&
        queueSettings.queue !== QueueSettings.IMMEDIATE;

    // Queue durations are longer than the throttle duration, so no need to
    // mark it as throttled if it's going to be queued. If the throttle
    // duration is 0, then don't throttle it just to unthrottled the next
    // update. If no filters applied and we're applying the fallback label,
    // don't throttle that either since it may be something new and unknown.
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

  async dequeueStuck_() {
    let querySnapshot = await Thread.metadataCollection()
                            .where(ThreadMetadataKeys.blocked, '<=', Date.now())
                            .get();

    await this.doInParallel_<firebase.firestore.QueryDocumentSnapshot>(
        querySnapshot.docs,
        async (doc: firebase.firestore.QueryDocumentSnapshot) => {
          let update: ThreadMetadataUpdate = {
            hasLabel: true,
          };
          await doc.ref.update(update);
        });
  }

  async dequeueRetriage_(priority: Priority, retriageDays: number) {
    let querySnapshot =
        await Thread.metadataCollection()
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
    let needsRetriage = await Thread.metadataCollection()
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

  async schedulePushGmailLablesForAllHasLabelOrPriorityThreads() {
    if (!this.settings_.get(ServerStorage.KEYS.PUSH_LABELS_TO_GMAIL)) {
      return;
    }

    const hasLabelSnapshot = await Thread.metadataCollection()
                                 .where(ThreadMetadataKeys.hasLabel, '==', true)
                                 .get();
    const hasPrioritySnapshot =
        await Thread.metadataCollection()
            .where(ThreadMetadataKeys.hasPriority, '==', true)
            .get();
    const allDocs = [...hasLabelSnapshot.docs, ...hasPrioritySnapshot.docs];

    const FIRESTORE_WRITE_BATCH_LIMIT = 500;
    const batches = [];

    while (batches.length * FIRESTORE_WRITE_BATCH_LIMIT < allDocs.length) {
      const currentIndex = batches.length * FIRESTORE_WRITE_BATCH_LIMIT;
      const thisChunk = allDocs.slice(
          currentIndex, currentIndex + FIRESTORE_WRITE_BATCH_LIMIT);
      var batch = firestore().batch();
      for (let doc of thisChunk) {
        let data = doc.data() as ThreadMetadata;
        let update: ThreadMetadataUpdate = {
          hasMessageIdsToPushToGmail: true,
          messageIdsToPushToGmail:
              firebase.firestore.FieldValue.arrayUnion(...data.messageIds),
        };
        batch.update(doc.ref, update);
      }
      batches.push(batch.commit());
    }
    await Promise.all(batches);
  }

  private async processSoftMute_() {
    let querySnapshot = await Thread.metadataCollection()
                            .where(ThreadMetadataKeys.softMuted, '==', true)
                            .get();

    var oneDay = 24 * 60 * 60 * 1000;
    let now = Date.now();

    // For manual testing: artificially set the date in the future so these
    // get processed. let time = new Date(now); time.setDate(time.getDate() +
    // SOFT_MUTE_EXPIRATION_DAYS); now = time.getTime();

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
              newMessagesSinceSoftMuted: firebase.firestore.FieldValue.delete(),
              hasLabel: true,
              hasMessageIdsToPushToGmail: true,
              messageIdsToPushToGmail:
                  firebase.firestore.FieldValue.arrayUnion(...data.messageIds),
            };
          } else {
            update = Thread.baseArchiveUpdate();
          }

          await doc.ref.update(update);
        });
  }

  private async processSingleQueue_(queue: string) {
    if (queue === QueueSettings.DAILY) {
      await this.dequeueStuck_();
      await this.processRetriage_();
      await this.processSoftMute_();
    }

    let queueDatas = this.settings_.getQueueSettings().entries();
    for (let queueData of queueDatas) {
      if (queueData[1].queue == queue)
        await this.dequeue(
            Thread.metadataCollection()
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

    await this.dequeue(Thread.metadataCollection().where(
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
