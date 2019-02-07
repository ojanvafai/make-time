import {notNull, parseAddressList, ParsedAddress} from './Base.js';
import {fetchThreads, getServerStorage, updateLoaderTitle} from './BaseMain.js';
import {ErrorLogger} from './ErrorLogger.js';
import {Labels} from './Labels.js';
import {Message} from './Message.js';
import {TriageModel} from './models/TriageModel.js';
import {QueueSettings} from './QueueSettings.js';
import {ServerStorage, StorageUpdates} from './ServerStorage.js';
import {FilterRule, HeaderFilterRule, Settings} from './Settings.js';
import {TASK_COMPLETED_EVENT_NAME, TaskQueue} from './TaskQueue.js';
import {Thread} from './Thread.js';
import {ThreadFetcher} from './ThreadFetcher.js';

export class MailProcessor {
  constructor(
      public settings: Settings, private triageModel_: TriageModel,
      private allLabels_: Labels) {}

  private async pushThread_(thread: Thread) {
    await this.triageModel_.addThread(thread);
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

    let parsedFrom = message.from ? parseAddressList(message.from) : [];
    let parsedTo = message.to ? parseAddressList(message.to) : [];
    let parsedCc = message.cc ? parseAddressList(message.cc) : [];
    let parsedBcc = message.bcc ? parseAddressList(message.bcc) : [];
    let parsedToCcBcc = [...parsedTo, ...parsedCc, ...parsedBcc];

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
      if (!this.containsAddress(parsedFrom, rule.from))
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

  getWinningLabel(thread: Thread, rules: FilterRule[]) {
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

    // Ensure there's always some label to make sure bugs don't cause emails to
    // get lost silently.
    return Labels.FALLBACK_LABEL;
  }

  async processThread_(thread: Thread, skipPushThread: boolean) {
    try {
      let removeLabelIds = this.allLabels_.getMakeTimeLabelIds().concat();
      let processedLabelId =
          await this.allLabels_.getId(Labels.PROCESSED_LABEL);
      let addLabelIds = [processedLabelId];

      if (thread.isMuted()) {
        let mutedId = await this.allLabels_.getId(Labels.MUTED_LABEL);
        removeLabelIds = removeLabelIds.filter((item) => item != mutedId);
        removeLabelIds.push('INBOX');
        await thread.modify(addLabelIds, removeLabelIds);
        return;
      }

      let rules = await this.settings.getFilters();
      let labelName = this.getWinningLabel(thread, rules);

      if (labelName == Labels.ARCHIVE_LABEL) {
        addLabelIds.push(
            await this.allLabels_.getId(Labels.PROCESSED_ARCHIVE_LABEL));
        removeLabelIds.push('INBOX');
        await thread.modify(addLabelIds, removeLabelIds);
        return;
      }

      let prefixedLabelName;

      let alreadyInTriaged = thread.getPriority();
      let alreadyInNeedsTriage =
          thread.isInInbox() && !thread.hasDefaultQueue();
      let labelNeedsQueueing =
          this.settings.getQueueSettings().get(labelName).queue !=
          QueueSettings.IMMEDIATE;

      if (alreadyInTriaged || alreadyInNeedsTriage || !labelNeedsQueueing) {
        prefixedLabelName = Labels.needsTriageLabel(labelName);
        addLabelIds.push('INBOX');
      } else {
        prefixedLabelName = Labels.addQueuedPrefix(labelName);
        removeLabelIds.push('INBOX');
      }

      let prefixedLabelId = await this.allLabels_.getId(prefixedLabelName);
      addLabelIds.push(prefixedLabelId);
      removeLabelIds = removeLabelIds.filter(id => id != prefixedLabelId);

      await thread.modify(addLabelIds, removeLabelIds);
      if (addLabelIds.includes('INBOX')) {
        if (skipPushThread) {
          // The thread is already in the ThreadListModel, but we still want to
          // update it so that it rerenders the row with the latest thread
          // information.
          thread.update();
        } else {
          await this.pushThread_(thread);
        }
      }
    } catch (e) {
      ErrorLogger.log(`Failed to process message.\n\n${JSON.stringify(e)}`);
    }
  }

  async process(threads: Thread[], skipPushThread?: boolean) {
    await this.processThreads_(threads, !!skipPushThread);
    await this.processQueues_();
  }

  private async processThreads_(threads: Thread[], skipPushThread: boolean) {
    if (!threads.length)
      return;

    let progress =
        updateLoaderTitle('processUnprocessed', threads.length, `Filtering...`);

    const taskQueue = new TaskQueue(3);
    taskQueue.addEventListener(TASK_COMPLETED_EVENT_NAME, () => {
      progress.incrementProgress();
    });
    for (let thread of threads) {
      taskQueue.queueTask(() => this.processThread_(thread, skipPushThread));
    };
    await taskQueue.flush();
  }

  async dequeue(labelName: string) {
    var queuedLabelName = Labels.addQueuedPrefix(labelName);
    var queuedLabel = await this.allLabels_.getId(queuedLabelName);
    var autoLabel =
        await this.allLabels_.getId(Labels.needsTriageLabel(labelName));

    let threads: Thread[] = [];
    await fetchThreads(async (fetcher: ThreadFetcher) => {
      let thread = await fetcher.fetch();
      threads.push(notNull(thread));
    }, `in:${queuedLabelName}`);

    if (!threads.length)
      return;

    let progress = updateLoaderTitle(
        'dequeue', threads.length, `Dequeuing from ${labelName}...`);

    let processedLabelId = await this.allLabels_.getId(Labels.PROCESSED_LABEL);

    for (var i = 0; i < threads.length; i++) {
      progress.incrementProgress();

      var thread = threads[i];
      let addLabelIds = ['INBOX', autoLabel, processedLabelId];
      let removeLabelIds = [queuedLabel];
      await thread.modify(addLabelIds, removeLabelIds);
      await this.pushThread_(thread);
    }
  }

  async processSingleQueue(queue: string) {
    let queueDatas = this.settings.getQueueSettings().entries();
    for (let queueData of queueDatas) {
      if (queueData[1].queue == queue)
        await this.dequeue(queueData[0]);
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
