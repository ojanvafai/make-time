const FILTERS_SHEET_NAME = 'filters';
const STATISTICS_SHEET_NAME = 'statistics';
const DAILY_STATS_SHEET_NAME = 'daily_stats';

const MONTHLY = 'Monthly';
const DAILY = 'Daily';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let ARCHIVE_KEYWORD = 'archive';

let RETRIAGE_LABEL = 'retriage';

var queuePrefixMap = {
  Daily: 'daily',
  Monthly: 'monthly',
  Monday: 'weekly',
  Tuesday: 'weekly',
  Wednesday: 'weekly',
  Thursday: 'weekly',
  Friday: 'weekly',
  Saturday: 'weekly',
  Sunday: 'weekly'
}

class MailProcessor {
  constructor(settings, pushThread, queuedLabelMap, allLabels) {
    this.settings = settings;
    this.pushThread_ = pushThread;
    this.queuedLabelMap_ = queuedLabelMap;
    this.allLabels_ = allLabels;
  }

  endsWithAddress(addresses, filterAddress) {
    for (var j = 0; j < addresses.length; j++) {
      if (addresses[j].endsWith(filterAddress))
        return true;
    }
    return false;
  }

  matchesRegexp(regex, str) {
    return (new RegExp(regex, 'm')).test(str);
  }

  // This is to avoid triggering regexps accidentally on plain test things
  // being run through this.matchesRegexp
  escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  startsWithAddress(addresses, filterAddress) {
    var parts = this.escapeRegExp(filterAddress).split('@');
    var regexp = '^' + parts[0] + '(?:\\+[^@]*?)?@' + parts[1];
    for (var j = 0; j < addresses.length; j++) {
      if (this.matchesRegexp(regexp, addresses[j]))
        return true;
    }
    return false;
  }

  containsAddress(addresses, filterAddressCsv) {
    if (!addresses)
      return false;

    var filterAddresses = filterAddressCsv.split(',');
    for (var i = 0; i < filterAddresses.length; i++) {
      var filterAddress = filterAddresses[i];
      // If there's no @ symbol, we don't know if it's a username or a domain.
      // Try both.
      if (filterAddress.includes("@")) {
        if (this.startsWithAddress(addresses, filterAddress))
          return true;
      } else {
        if (this.startsWithAddress(addresses, filterAddress + "@"))
          return true;
        if (this.endsWithAddress(addresses, "@" + filterAddress))
          return true;
      }
    }
    return false;
  }

  addLabelPrefix(labelName) {
    if (this.queuedLabelMap_[labelName])
      return Labels.addQueuedPrefix(labelName);
    return this.addAutoPrefix(labelName);
  }

  addAutoPrefix(labelName) {
    return Labels.NEEDS_TRIAGE_LABEL + "/" + labelName;
  }

  dequeuedLabelName(queue, labelName) {
    if (!queuePrefixMap[queue])
      throw `Attempting to put label in a non-existant queue. queue: ${queue}, label: ${labelName}`;
    return this.addAutoPrefix(queuePrefixMap[queue] + '/' + labelName);
  }

  async readRulesRows() {
    var rawRules = await SpreadsheetUtils.fetchSheet(this.settings.spreadsheetId, FILTERS_SHEET_NAME);
    var rules = [];
    var labels = {};
    var output = {
      rules: rules,
    }
    var ruleNames = rawRules[0];
    var labelColumn = ruleNames.indexOf('label');

    for (var i = 1, l = rawRules.length; i < l; i++) {
      var ruleObj = {};
      for (var j = 0; j < ruleNames.length; j++) {
        var name = ruleNames[j];
        var value = rawRules[i][j];
        if (j == labelColumn)
          labels[value] = true;
        if (!value)
          continue;
        ruleObj[name] = value.trim();
      }
      rules.push(ruleObj);
    }

    output.labels = Object.keys(labels);
    return output;
  }

  async writeToStatsPage(timestamp, num_threads_processed, per_label_counts, time_taken) {
    var data = [timestamp, num_threads_processed, time_taken, JSON.stringify(per_label_counts)];
    await SpreadsheetUtils.appendToSheet(this.settings.spreadsheetId, STATISTICS_SHEET_NAME, [data]);
  }

  getYearMonthDay(timestamp) {
    let date = new Date(timestamp);

    let month = date.getMonth() + 1;
    if (month < 10)
      month = '0' + month;

    let day = date.getDate();
    if (day < 10)
      day = '0' + day;

    return date.getFullYear() + '/' + month + '/' + day;
  }

  async writeCollapsedStats(stats) {
    if (stats && stats.numInvocations)
      await SpreadsheetUtils.appendToSheet(this.settings.spreadsheetId, DAILY_STATS_SHEET_NAME, [Object.values(stats)]);
  }

  async collapseStats() {
    updateTitle('collapseStats', 'Writing stats...', true);

    let stats;
    var rows = await SpreadsheetUtils.fetchSheet(this.settings.spreadsheetId, STATISTICS_SHEET_NAME);
    let todayYearMonthDay = this.getYearMonthDay(Date.now());
    let currentYearMonthDay;

    let lastRowProcessed = 0;

    for (var i = 1; i < rows.length; ++i) {
      // timestamp, threads_processed, messages_processed, total_time, perLabelThreadCountJSON

      let timestamp = Number(rows[i][0]);
      // Ignore empty rows
      if (!timestamp) {
        continue;
      }

      let yearMonthDay = this.getYearMonthDay(timestamp);

      if (todayYearMonthDay < yearMonthDay)
        throw `Something is wrong with the statistics spreadsheet. Some rows have dates in the future: ${yearMonthDay}`;

      // Don't process any rows from today. Since the sheet is in date order, we can stop processing entirely.
      if (todayYearMonthDay == yearMonthDay)
        break;

      if (currentYearMonthDay != yearMonthDay) {
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

      lastRowProcessed = i;

      stats.numInvocations++;
      stats.totalThreads += Number(rows[i][1]);

      stats.totalTime += Number(rows[i][2]);
      stats.minTime = Math.min(stats.minTime, Number(rows[i][2]));
      stats.maxTime = Math.max(stats.maxTime, Number(rows[i][2]));

      var labelCounts = JSON.parse(rows[i][3]);
      for (var label in labelCounts) {
        var count = labelCounts[label];
        if (label == ARCHIVE_KEYWORD) {
          stats.ignoredThreads += count;
        } else {
          stats.nonIgnoredThreads += count;

          var queuedPrefix = this.queuedLabelMap_[label];
          if (!queuedPrefix) {
            stats.immediateCount += count;
          } else if (queuedPrefix == "Daily") {
            stats.dailyCount += count;
          } else if (queuedPrefix == "Monthly") {
            stats.monthlyCount += count;
          } else {
            // Assume all the other queues are weekly queues.
            stats.weeklyCount += count;
          }
        }
      }
    }

    await this.writeCollapsedStats(stats);

    if (lastRowProcessed)
      await SpreadsheetUtils.deleteRows(this.settings.spreadsheetId, STATISTICS_SHEET_NAME, 1, lastRowProcessed + 1);

    updateTitle('collapseStats');
  }

  matchesHeader_(message, header) {
    let colonIndex = header.indexOf(':');
    if (colonIndex == -1) {
      alert(`Invalid header filter. Header filters must be of the form headername:filtervalue.`);
      return false;
    }
    let name = header.substring(0, colonIndex).trim();
    let value = header.substring(colonIndex + 1).toLowerCase().trim();
    let headerValue = message.getHeaderValue(name);
    return headerValue && headerValue.toLowerCase().trim().includes(value);
  }

  matchesRule(rule, message) {
    var matches = false;
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
      if (!this.matchesHeader_(message, rule.header))
        return false;
      matches = true;
    }
    // TODO: only need to do this once per thread.
    if (rule.subject) {
      if (!message.subject.includes(rule.subject))
        return false;
      matches = true;
    }
    if (rule.plaintext) {
      if (!message.getPlain().includes(rule.plaintext))
        return false;
      matches = true;
    }
    if (rule.htmlcontent) {
      if (!message.getHtmlOrPlain().includes(rule.htmlcontent))
        return false;
      matches = true;
    }
    return matches;
  }

  async processThread(thread, rules) {
    var messages = await thread.getMessages();

    for (let rule of rules) {
      if (rule.matchallmessages == 'yes') {
        let matches = false;
        for (let message of messages) {
          matches = this.matchesRule(rule, message);
          if (!matches)
            break;
        }
        if (matches)
          return rule.label;
      } else {
        for (let message of messages) {
          if (this.matchesRule(rule, message))
            return rule.label;
        }
      }
    }

    // Ensure there's always some label to make sure bugs don't cause emails to get lost silently.
    return Labels.FALLBACK_LABEL;
  }

  async currentTriagedLabel(thread) {
    var labels = await thread.getLabelNames();
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].startsWith(Labels.TRIAGED_LABEL + '/'))
        return labels[i];
    }
    return null;
  }

  async processMail() {
    let threads = [];
    await fetchThreads(thread => threads.push(thread), {
      query: `in:${Labels.UNPROCESSED_LABEL}`,
    });

    if (!threads.length)
      return;

    let startTime = new Date();
    let rulesSheet = await this.readRulesRows();

    // Don't do any processing if there are no rules. This happens when someone
    // creates a new backend spreadsheet for example.
    if (!rulesSheet.rules.length)
      return;

    let newlyLabeledThreadsCount = 0;
    let perLabelCounts = {};

    for (var i = 0; i < threads.length; i++) {
      try {
        updateTitle('processMail', `Processing ${i + 1}/${threads.length} unprocessed threads...`, true);

        let thread = threads[i];
        let labelName;

        let removeLabelIds = this.allLabels_.getMakeTimeLabelIds().concat();
        let addLabelIds = [];

        // Triaged items when reprocessed go in the rtriage queue regardless of what label they
        // might otherwise go in.
        let currentTriagedLabel = await this.currentTriagedLabel(thread);
        if (currentTriagedLabel) {
          if (currentTriagedLabel == Labels.MUTED_LABEL) {
            await thread.modify(addLabelIds, removeLabelIds);
            continue;
          }
          labelName = RETRIAGE_LABEL;
        } else {
          labelName = await this.processThread(thread, rulesSheet.rules);
        }

        let alreadyHadLabel = false;
        let isAlreadyInInbox = thread.isInInbox();

        if (labelName == ARCHIVE_KEYWORD) {
          removeLabelIds.push('INBOX');
        } else {
          let prefixedLabelName;

          // Make sure not to put things into the inbox into queued labels.
          if (isAlreadyInInbox) {
            let queue = this.queuedLabelMap_[labelName];
            if (queue)
              prefixedLabelName = this.dequeuedLabelName(queue, labelName);
            else
              prefixedLabelName = this.addAutoPrefix(labelName);
          } else {
            prefixedLabelName = this.addLabelPrefix(labelName);
          }

          let prefixedLabelId = await this.allLabels_.getId(prefixedLabelName);

          let labelIds = await thread.getLabelIds();
          alreadyHadLabel = labelIds.has(prefixedLabelId);

          addLabelIds.push(prefixedLabelId);
          removeLabelIds = removeLabelIds.filter(id => id != prefixedLabelId);

          if (prefixedLabelName != Labels.addQueuedPrefix(labelName))
            addLabelIds.push('INBOX');
        }

        await thread.modify(addLabelIds, removeLabelIds);
        // TODO: If isAlreadyInInbox && !alreadyHadLabel, we should remove it from the threadlist
        // and add it back in so it gets put into the right queue.
        if (!isAlreadyInInbox && addLabelIds.includes('INBOX'))
          this.pushThread_(thread);

        if (!alreadyHadLabel) {
          if (!perLabelCounts[labelName])
            perLabelCounts[labelName] = 0;
          perLabelCounts[labelName] += 1;
          newlyLabeledThreadsCount++;
        }
      } catch (e) {
        console.log(e);
        alert(`Failed to process message. Left it in the unprocessed label.\n\n${JSON.stringify(e)}`);
      }
    }

    if (newlyLabeledThreadsCount) {
      this.writeToStatsPage(
        startTime.getTime(), newlyLabeledThreadsCount, perLabelCounts, Date.now() - startTime.getTime());
    }

    updateTitle('processMail');
    return threads.length;
  }

  async dequeue(labelName, queue) {
    var queuedLabelName = Labels.addQueuedPrefix(labelName);
    var queuedLabel = await this.allLabels_.getId(queuedLabelName);
    var autoLabel = await this.allLabels_.getId(this.dequeuedLabelName(queue, labelName));

    let threads = [];
    await fetchThreads(thread => threads.push(thread), {
      query: `in:${queuedLabelName}`,
    });

    if (!threads.length)
      return;

    for (var i = 0; i < threads.length; i++) {
      updateTitle('dequeue', `Dequeuing ${i + 1}/${threads.length} from ${labelName}...`, true);

      var thread = threads[i];
      let addLabelIds = ['INBOX', autoLabel];
      let removeLabelIds = [queuedLabel];
      await thread.modify(addLabelIds, removeLabelIds);
      this.pushThread_(thread);
    }
    updateTitle('dequeue');
  }

  async processSingleQueue(queue) {
    let threadsProcessedCount = 0;
    let labelNames = Object.keys(this.queuedLabelMap_);
    let start = Date.now();
    for (var i = 0; i < labelNames.length; i++) {
      let labelName = labelNames[i];
      if (this.queuedLabelMap_[labelName] == queue)
        await this.dequeue(labelName, queue);
    }
  }

  categoriesToDequeue(startTime, opt_endTime) {
    if (!startTime) {
      let today = WEEKDAYS[new Date().getDay()];
      return [today, DAILY];
    }

    let start = Number(startTime);
    let end = opt_endTime || Date.now();

    var oneDay = 24 * 60 * 60 * 1000;
    var diffDays = (end - start) / (oneDay);

    if (diffDays >= 30)
      return WEEKDAYS.concat([DAILY, MONTHLY]);
    if (diffDays >= 7)
      return WEEKDAYS.concat([DAILY]);

    let startDate = new Date(start);
    let endDate = new Date(end);
    let startDay = startDate.getDay();
    let endDay = endDate.getDay();

    // Have already processed today.
    if (startDay == endDay && diffDays < 1)
      return [];

    let days = [];

    while (true) {
      var modded = ++startDay % WEEKDAYS.length;
      days.push(WEEKDAYS[modded]);
      if (modded == endDay)
        break;
    }

    days.push(DAILY);

    if (startDate.getMonth() < endDate.getMonth())
      days.push(MONTHLY);

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

    await storage.writeUpdates([{key: ServerStorage.KEYS.LAST_DEQUEUE_TIME, value: Date.now()}]);
  }

}
