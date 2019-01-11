import {fetchThreads, updateLoaderTitle} from './BaseMain.js';
import {ErrorLogger} from './ErrorLogger.js';
import {Labels} from './Labels.js';
import {Message} from './Message.js';
import {TriageModel} from './models/TriageModel.js';
import {QueueSettings} from './QueueSettings.js';
import {ServerStorage} from './ServerStorage.js';
import {FilterRule, HeaderFilterRule, Settings} from './Settings.js';
import {SpreadsheetUtils} from './SpreadsheetUtils.js';
import {TASK_COMPLETED_EVENT_NAME, TaskQueue} from './TaskQueue.js';
import {DEFAULT_QUEUE, Thread} from './Thread.js';

const STATISTICS_SHEET_NAME = 'statistics';
const DAILY_STATS_SHEET_NAME = 'daily_stats';

interface Stats {
  yearMonthDay: string;
  totalThreads: number;
  ignoredThreads: number;
  nonIgnoredThreads: number;
  immediateCount: number;
  dailyCount: number;
  weeklyCount: number;
  monthlyCount: number;
  numInvocations: number;
  totalTime: number;
  minTime: number;
  maxTime: number;
}

export class MailProcessor {
  constructor(
      public settings: Settings, private triageModel_: TriageModel,
      private queuedLabelMap_: QueueSettings, private allLabels_: Labels) {}

  private async pushThread_(thread: Thread) {
    await this.triageModel_.addThread(thread);
  }

  endsWithAddress(addresses: string[], filterAddress: string) {
    for (var j = 0; j < addresses.length; j++) {
      if (addresses[j].endsWith(filterAddress))
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

  startsWithAddress(addresses: string[], filterAddress: string) {
    var parts = this.escapeRegExp(filterAddress).split('@');
    var regexp = '^' + parts[0] + '(?:\\+[^@]*?)?@' + parts[1];
    for (var j = 0; j < addresses.length; j++) {
      if (this.matchesRegexp(regexp, addresses[j]))
        return true;
    }
    return false;
  }

  containsAddress(addresses: string[]|undefined, filterAddressCsv: string) {
    if (!addresses)
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

  getYearMonthDay(timestamp: number) {
    let date = new Date(timestamp);

    let month = date.getMonth() + 1;
    let paddedMonth = month < 10 ? '0' + month : String(month);

    let day = date.getDate();
    let paddedDay = day < 10 ? '0' + day : String(day);

    return date.getFullYear() + '/' + paddedMonth + '/' + paddedDay;
  }

  async writeCollapsedStats(stats: Stats) {
    if (!stats.numInvocations)
      return;
    await SpreadsheetUtils.appendToSheet(
        this.settings.spreadsheetId, DAILY_STATS_SHEET_NAME,
        [Object.values(stats)]);
  }

  async collapseStats() {
    let stats: Stats|null = null;
    var rows = await SpreadsheetUtils.fetchSheet(
        this.settings.spreadsheetId, STATISTICS_SHEET_NAME);
    let todayYearMonthDay = this.getYearMonthDay(Date.now());
    let currentYearMonthDay;

    let lastRowProcessed = 0;

    for (var i = 1; i < rows.length; ++i) {
      // timestamp, threads_processed, messages_processed, total_time,
      // perLabelThreadCountJSON

      let timestamp = Number(rows[i][0]);
      // Ignore empty rows
      if (!timestamp) {
        continue;
      }

      let yearMonthDay = this.getYearMonthDay(timestamp);

      if (todayYearMonthDay < yearMonthDay)
        throw `Something is wrong with the statistics spreadsheet. Some rows have dates in the future: ${
            yearMonthDay}`;

      // Don't process any rows from today. Since the sheet is in date order, we
      // can stop processing entirely.
      if (todayYearMonthDay == yearMonthDay)
        break;

      if (currentYearMonthDay != yearMonthDay) {
        if (stats)
          await this.writeCollapsedStats(stats);
        currentYearMonthDay = yearMonthDay;
        stats = {
          yearMonthDay: currentYearMonthDay,
          totalThreads: 0,
          ignoredThreads: 0,
          nonIgnoredThreads: 0,
          immediateCount: 0,
          dailyCount: 0,
          weeklyCount: 0,
          monthlyCount: 0,
          numInvocations: 0,
          totalTime: 0,
          minTime: Number.MAX_VALUE,
          maxTime: 0,
        };
      }

      if (!stats)
        throw 'Something went wrong computing stats.';

      lastRowProcessed = i;

      stats.numInvocations++;
      stats.totalThreads += Number(rows[i][1]);

      stats.totalTime += Number(rows[i][2]);
      stats.minTime = Math.min(stats.minTime, Number(rows[i][2]));
      stats.maxTime = Math.max(stats.maxTime, Number(rows[i][2]));

      var labelCounts = JSON.parse(rows[i][3]);
      for (var label in labelCounts) {
        var count = labelCounts[label];
        if (label == Labels.ARCHIVE_LABEL) {
          stats.ignoredThreads += count;
        } else {
          stats.nonIgnoredThreads += count;

          let queueData = this.queuedLabelMap_.get(label);
          if (queueData.queue == QueueSettings.IMMEDIATE) {
            stats.immediateCount += count;
          } else if (queueData.queue == QueueSettings.DAILY) {
            stats.dailyCount += count;
          } else if (queueData.queue == QueueSettings.MONTHLY) {
            stats.monthlyCount += count;
          } else {
            // Assume all the other queues are weekly queues.
            stats.weeklyCount += count;
          }
        }
      }
    }

    if (stats)
      await this.writeCollapsedStats(stats);

    if (lastRowProcessed)
      await SpreadsheetUtils.deleteRows(
          this.settings.spreadsheetId, STATISTICS_SHEET_NAME, 1,
          lastRowProcessed + 1);
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
    if (rule.nocc) {
      let emailCount = 0;

      if (message.toEmails)
        emailCount += message.toEmails.length;
      if (message.ccEmails)
        emailCount += message.ccEmails.length;
      if (message.bccEmails)
        emailCount += message.bccEmails.length;

      if (emailCount != 1)
        return false;
      matches = true;
    }
    if (rule.to) {
      if (!this.containsAddress(message.toEmails, rule.to) &&
          !this.containsAddress(message.ccEmails, rule.to) &&
          !this.containsAddress(message.bccEmails, rule.to))
        return false;
      matches = true;
    }
    if (rule.from) {
      if (!this.containsAddress(message.fromEmails, rule.from))
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
  async logMatchingRule_(thread: Thread, rule: FilterRule) {
    if (this.settings.get(ServerStorage.KEYS.LOG_MATCHING_RULES)) {
      let subject = await thread.getSubject();
      console.log(`Thread with subject "${subject}" matched rule ${
          JSON.stringify(rule)}`);
    }
  }

  async getWinningLabel(thread: Thread, rules: FilterRule[]) {
    var messages = await thread.getMessages();

    for (let rule of rules) {
      if (rule.matchallmessages == 'yes') {
        let matches = false;
        for (let message of messages) {
          matches = this.matchesRule(rule, message);
          if (!matches)
            break;
        }
        if (matches) {
          await this.logMatchingRule_(thread, rule);
          return rule.label;
        }
      } else {
        for (let message of messages) {
          if (this.matchesRule(rule, message)) {
            await this.logMatchingRule_(thread, rule);
            return rule.label;
          }
        }
      }
    }

    // Ensure there's always some label to make sure bugs don't cause emails to
    // get lost silently.
    return Labels.FALLBACK_LABEL;
  }

  async getPriority(thread: Thread) {
    let messages = await thread.getMessages();
    let lastMessage = messages[messages.length - 1];
    // TODO: Also check the subject line? last message wins over subject?
    let plainText = lastMessage.getPlain();
    if (!plainText) {
      // Lazy way of getting the plain text out of the HTML.
      let dummyDiv = document.createElement('div');
      dummyDiv.innerHTML = lastMessage.getHtml() || '';
      plainText = dummyDiv.textContent;
    }

    let lowestIndex = Number.MAX_SAFE_INTEGER;
    let matchingPriority;
    for (let priority of Labels.SORTED_PRIORITIES) {
      let tag = `##${priority}`;
      let index = plainText.indexOf(tag);

      if (index == -1)
        continue;
      if (index > lowestIndex)
        continue;
      // Make sure what follows the tag is a space, newline, or end of message.
      let nextChar = plainText.charAt(index + tag.length);
      if (nextChar && nextChar != ' ' && nextChar != '\n' && nextChar != '\r')
        continue;

      lowestIndex = index;
      matchingPriority = priority;
    }

    return matchingPriority;
  }

  async processThread_(thread: Thread) {
    try {
      let startTime = new Date();

      let removeLabelIds = this.allLabels_.getMakeTimeLabelIds().concat();
      let processedLabelId =
          await this.allLabels_.getId(Labels.PROCESSED_LABEL);
      let addLabelIds = [processedLabelId];

      if (await thread.isMuted()) {
        let mutedId = await this.allLabels_.getId(Labels.MUTED_LABEL);
        removeLabelIds = removeLabelIds.filter((item) => item != mutedId);
        removeLabelIds.push('INBOX');
        await thread.modify(addLabelIds, removeLabelIds);
        this.logToStatsPage_(Labels.MUTED_LABEL, startTime);
        return;
      }

      let priority = await this.getPriority(thread);
      if (priority) {
        let labelName = Labels.addPriorityPrefix(priority);
        addLabelIds.push(await this.allLabels_.getId(labelName));
        removeLabelIds.push('INBOX');
        await thread.modify(addLabelIds, removeLabelIds);
        await this.pushThread_(thread);
        return;
      }

      let rules = await this.settings.getFilters();
      let labelName = await this.getWinningLabel(thread, rules);

      if (labelName == Labels.ARCHIVE_LABEL) {
        addLabelIds.push(
            await this.allLabels_.getId(Labels.PROCESSED_ARCHIVE_LABEL));
        removeLabelIds.push('INBOX');
        await thread.modify(addLabelIds, removeLabelIds);
        if (await thread.isInInbox())
          this.logToStatsPage_(labelName, startTime);
        return;
      }

      let prefixedLabelName;

      let alreadyInTriaged = await thread.getPriority();
      let alreadyInNeedsTriage = (await thread.isInInbox()) &&
          (await thread.getQueue() != DEFAULT_QUEUE);
      let labelNeedsQueueing =
          this.queuedLabelMap_.get(labelName).queue != QueueSettings.IMMEDIATE;

      if (alreadyInTriaged || alreadyInNeedsTriage || !labelNeedsQueueing) {
        prefixedLabelName = Labels.needsTriageLabel(labelName);
        addLabelIds.push('INBOX');
      } else {
        prefixedLabelName = Labels.addQueuedPrefix(labelName);
        removeLabelIds.push('INBOX');
      }

      let prefixedLabelId = await this.allLabels_.getId(prefixedLabelName);
      let alreadyHadLabel = (await thread.getLabelIds()).has(prefixedLabelId);

      addLabelIds.push(prefixedLabelId);
      removeLabelIds = removeLabelIds.filter(id => id != prefixedLabelId);

      await thread.modify(addLabelIds, removeLabelIds);
      if (addLabelIds.includes('INBOX'))
        await this.pushThread_(thread);

      if (!alreadyHadLabel)
        this.logToStatsPage_(labelName, startTime);
    } catch (e) {
      ErrorLogger.log(`Failed to process message.\n\n${JSON.stringify(e)}`);
    }
  }

  async logToStatsPage_(labelName: string, startTime: Date) {
    // TODO: Simplify this now that we write the stats for each thread at a
    // time.
    let perLabelCounts: {[property: string]: number} = {};
    perLabelCounts[labelName] = 1;
    var data = [
      startTime.getTime(), 1, Date.now() - startTime.getTime(),
      JSON.stringify(perLabelCounts)
    ];
    await SpreadsheetUtils.appendToSheet(
        this.settings.spreadsheetId, STATISTICS_SHEET_NAME, [data]);
  }

  async process(threads: Thread[]) {
    await this.processThreads(threads);
    await this.processQueues();
    if (threads.length)
      await this.collapseStats();
  }

  async processThreads(threads: Thread[]) {
    if (!threads.length)
      return;

    let progress = updateLoaderTitle(
        'processUnprocessed', threads.length, `Processing...`);

    const taskQueue = new TaskQueue(3);
    taskQueue.addEventListener(TASK_COMPLETED_EVENT_NAME, () => {
      progress.incrementProgress();
    });
    for (let thread of threads) {
      taskQueue.queueTask(() => this.processThread_(thread));
    };
    await taskQueue.flush();
  }

  async dequeue(labelName: string) {
    var queuedLabelName = Labels.addQueuedPrefix(labelName);
    var queuedLabel = await this.allLabels_.getId(queuedLabelName);
    var autoLabel =
        await this.allLabels_.getId(Labels.needsTriageLabel(labelName));

    let threads: Thread[] = [];
    await fetchThreads(
        (thread: Thread) => threads.push(thread), `in:${queuedLabelName}`);

    if (!threads.length)
      return;

    let progress = updateLoaderTitle(
        'dequeue', threads.length, `Dequeuing from ${labelName}...`);

    for (var i = 0; i < threads.length; i++) {
      progress.incrementProgress();

      var thread = threads[i];
      let addLabelIds = ['INBOX', autoLabel];
      let removeLabelIds = [queuedLabel];
      await thread.modify(addLabelIds, removeLabelIds);
      await this.pushThread_(thread);
    }
  }

  async processSingleQueue(queue: string) {
    let queueDatas: any[] = this.queuedLabelMap_.entries();
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

  async processQueues() {
    let storage = new ServerStorage(this.settings.spreadsheetId);
    await storage.fetch();
    let lastDequeueTime = storage.get(ServerStorage.KEYS.LAST_DEQUEUE_TIME);
    const categories = this.categoriesToDequeue(lastDequeueTime);

    if (!categories.length)
      return;

    for (const category of categories) {
      await this.processSingleQueue(category);
    }

    await storage.writeUpdates(
        [{key: ServerStorage.KEYS.LAST_DEQUEUE_TIME, value: Date.now()}]);
  }
}
