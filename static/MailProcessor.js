const DEBUG_LOGGING = false;

const CONFIG_SHEET_NAME = 'config';
const FILTERS_SHEET_NAME = 'filters';
const QUEUED_LABELS_SHEET_NAME = 'queued_labels';
const STATISTICS_SHEET_NAME = 'statistics';
const DAILY_STATS_SHEET_NAME = 'daily_stats';
const BACKEND_SHEET_NAME = 'backend-do-not-modify';
const LAST_DEQUEUE_TIME_KEY = 'Last dequeue time';
// List of keys stored in the backend sheet.
const BACKEND_KEYS = [LAST_DEQUEUE_TIME_KEY];

const MONTHLY = 'Monthly';
const DAILY = 'Daily';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// TODO: Move these to the config spreadsheet.
TRIAGER_LABELS = {
  triaged: 'triaged',
  needsTriage: 'needstriage',
  retriage: 'retriage',
}

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
  constructor(settings, pushThread) {
    this.settings = settings;
    this.pushThread_ = pushThread;
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
    if (this.settings.queuedLabelMap[labelName])
      return addQueuedPrefix(this.settings, labelName);
    return this.addAutoPrefix(labelName);
  }

  addAutoPrefix(labelName) {
    return TRIAGER_LABELS.needsTriage + "/" + labelName;
  }

  dequeuedLabelName(queue, labelName) {
    if (!queuePrefixMap[queue])
      throw `Attempting to put label in a non-existant queue. queue: ${queue}, label: ${labelName}`;
    return this.addAutoPrefix(queuePrefixMap[queue] + '/' + labelName);
  }

  // TODO: Merge this with the other label code.
  async getLabelNames() {
    var response = await gapiFetch(gapi.client.gmail.users.labels.list, {
      'userId': USER_ID
    });

    var labels = [];

    for (var label of response.result.labels) {
      let name = label.name;
      var parts = name.split('/');
      if (parts.length == 1)
        continue;

      switch (parts[0]) {
        case TRIAGER_LABELS.needsTriage:
          labels.push(label.id);
          break;
        case this.settings.labeler_implementation_label:
          if (parts.length > 2 && parts[1] == this.settings.queued_label)
            labels.push(label.id);
          break;
        case TRIAGER_LABELS.triaged:
          labels.push(label.id);
          break;
      }
    }
    return labels;
  }

  async readRulesRows() {
    var startTime = new Date();

    var rawRules = await fetchSheet(this.settings.spreadsheetId, FILTERS_SHEET_NAME);
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
    this.debugLogTiming('Found ' + output.rules.length + ' input rules', startTime);

    output.labels = Object.keys(labels);
    return output;
  }

  debugLog(message) {
    if (DEBUG_LOGGING)
      console.log(message);
  }

  logTiming(thingDone, startTime) {
    console.log(thingDone + ' in ' + (Date.now() - startTime.getTime()) + ' milliseconds.');
  }

  debugLogTiming(thingDone, startTime) {
    if (DEBUG_LOGGING)
      this.logTiming(thingDone, startTime);
  }

  async appendToSheet(sheetName, rows) {
    let rowCount = Object.keys(rows).length;
    let requestParams = {
      spreadsheetId: this.settings.spreadsheetId,
      range: sheetName,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
    };
    let requestBody = {
      values: rows,
    };
    let response = await gapiFetch(gapi.client.sheets.spreadsheets.values.append, requestParams, requestBody);
    // TODO: Handle if response.status != 200.
  }

  async write2ColumnSheet(sheetName, rows) {
    let rowCount = Object.keys(rows).length;
    let requestParams = {
      spreadsheetId: this.settings.spreadsheetId,
      range: sheetName + '!A1:B' + rowCount,
      valueInputOption: 'RAW',
    };
    let requestBody = {
      values: rows,
    };
    let response = await gapiFetch(gapi.client.sheets.spreadsheets.values.update, requestParams, requestBody);
    // TODO: Handle if response.status != 200.
  }

  async writeToStatsPage(timestamp, num_threads_processed, per_label_counts, time_taken) {
    var startTime = new Date();
    var data = [timestamp, num_threads_processed, time_taken, JSON.stringify(per_label_counts)];
    this.debugLog('Writing [timestamp, num_threads_processed, time_taken] to stats page: ' + JSON.stringify(data));
    await this.appendToSheet(STATISTICS_SHEET_NAME, [data]);
    this.debugLogTiming('Finished writing to stats page', startTime, new Date());
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

  async getSheetId(sheetName) {
    let response = await gapiFetch(gapi.client.sheets.spreadsheets.get, {
      spreadsheetId: this.settings.spreadsheetId,
      ranges: [sheetName],
    });
    // TODO: Handle response.status != 200.
    return response.result.sheets[0].properties.sheetId;
  }

  async deleteRows(sheetName, startIndex, endIndex) {
    var params = {
      spreadsheetId: this.settings.spreadsheetId,
    };

    var sheetId = await this.getSheetId(sheetName);
    if (sheetId === undefined)
      throw `Could not get sheetId for sheet ${sheetName}`;

    var batchUpdateSpreadsheetRequestBody = {
      requests: [
        {
          "deleteDimension": {
            "range": {
              "sheetId": sheetId,
              "dimension": "ROWS",
              "startIndex": startIndex,
              "endIndex": endIndex,
            }
          }
        },
      ],
    };

    let response = await gapiFetch(gapi.client.sheets.spreadsheets.batchUpdate, params, batchUpdateSpreadsheetRequestBody);
    // TODO: Handle response.status != 200.
  }

  async writeCollapsedStats(stats) {
    if (stats && stats.numInvocations)
      await this.appendToSheet(DAILY_STATS_SHEET_NAME, [Object.values(stats)]);
  }

  async collapseStats() {
    updateTitle('collapseStats', 'Writing stats...', true);

    let stats;
    var rows = await fetchSheet(this.settings.spreadsheetId, STATISTICS_SHEET_NAME);
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
        if (label == this.settings.archive_label) {
          stats.ignoredThreads += count;
        } else {
          stats.nonIgnoredThreads += count;

          var queuedPrefix = this.settings.queuedLabelMap[label];
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
      await this.deleteRows(STATISTICS_SHEET_NAME, 1, lastRowProcessed + 1);

    updateTitle('collapseStats');
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
    if (rule.sender) {
      if (!this.containsAddress(message.sender, rule.sender))
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

    if (this.settings.auto_responder_label && messages.length == 1 && messages[0].xAutoreply)
      return this.settings.auto_responder_label;

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
    return this.settings.fallback_label;
  }

  async currentTriagedLabel(thread) {
    var labels = await thread.getLabelNames();
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].startsWith(TRIAGER_LABELS.triaged + '/'))
        return labels[i];
    }
    return null;
  }

  async processMail() {
    let threads = [];
    await fetchThreads(this.settings.unprocessed_label, thread => threads.push(thread));

    if (!threads.length)
      return;

    console.log('Processing mail');
    let startTime = new Date();

    let rulesSheet = await this.readRulesRows();

    let labelIdsToRemove = await this.getLabelNames();

    let newlyLabeledThreadsCount = 0;
    let perLabelCounts = {};

    let processedLabelId;
    if (this.settings.processed_label) {
      this.debugLog(
        'Adding processed_label ' + this.settings.processed_label + ' to all threads.');
      processedLabelId = await getLabelId(this.settings.processed_label);
    }

    let unprocessedLabelId = await getLabelId(this.settings.unprocessed_label);

    for (var i = 0; i < threads.length; i++) {
      try {
        updateTitle('processMail', `Processing ${i + 1}/${threads.length} unprocessed threads...`, true);

        let thread = threads[i];
        let labelName;

        let removeLabelIds = [unprocessedLabelId];
        let addLabelIds = [];
        if (processedLabelId)
          addLabelIds.push(processedLabelId);

        // Triaged items when reprocessed go in the rtriage queue regardless of what label they
        // might otherwise go in.
        let currentTriagedLabel = await this.currentTriagedLabel(thread);
        if (currentTriagedLabel) {
          if (currentTriagedLabel == MUTED_LABEL) {
            await thread.modify(addLabelIds, removeLabelIds);
            continue;
          }
          labelName = TRIAGER_LABELS.retriage;
        } else {
          labelName = await this.processThread(thread, rulesSheet.rules);
        }

        this.debugLog("Applying label: " + labelName);
        let alreadyHadLabel = false;
        let isAlreadyInInbox = thread.isInInbox();

        if (labelName == this.settings.archive_label) {
          if (thread.isInInbox())
            removeLabelIds.push('INBOX');
          else
            alreadyHadLabel = true;
          removeLabelIds = removeLabelIds.concat(labelIdsToRemove);
        } else {
          let prefixedLabelName;

          // Make sure not to put things into the inbox into queued labels.
          if (isAlreadyInInbox) {
            let queue = this.settings.queuedLabelMap[labelName];
            if (queue)
              prefixedLabelName = this.dequeuedLabelName(queue, labelName);
            else
              prefixedLabelName = this.addAutoPrefix(labelName);
          } else {
            prefixedLabelName = this.addLabelPrefix(labelName);
          }

          let prefixedLabelId = await getLabelId(prefixedLabelName);

          let labelIds = await thread.getLabelIds();
          alreadyHadLabel = labelIds.has(prefixedLabelId);

          addLabelIds.push(prefixedLabelId);
          removeLabelIds = removeLabelIds.concat(labelIdsToRemove.filter(id => id != prefixedLabelId));

          if (prefixedLabelName != addQueuedPrefix(this.settings, labelName))
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

    this.logTiming(`Finished processing ${threads.length} threads`, startTime);
    updateTitle('processMail');
    return threads.length;
  }

  async dequeue(labelName, queue) {
    var queuedLabelName = addQueuedPrefix(this.settings, labelName);
    var queuedLabel = await getLabelId(queuedLabelName);
    var autoLabel = await getLabelId(this.dequeuedLabelName(queue, labelName));

    let threads = [];
    await fetchThreads(queuedLabelName, thread => threads.push(thread));

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
    let labelNames = Object.keys(this.settings.queuedLabelMap);
    let start = Date.now();
    for (var i = 0; i < labelNames.length; i++) {
      let labelName = labelNames[i];
      if (this.settings.queuedLabelMap[labelName] == queue)
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
    this.debugLog('Fetching backend sheet to process queues.');
    const rawBackendValues = await fetch2ColumnSheet(this.settings.spreadsheetId, BACKEND_SHEET_NAME);
    const backendValues = {};
    // Strip no longer supported backend keys.
    for (let i = 0; i < BACKEND_KEYS.length; i++) {
      const key = BACKEND_KEYS[i];
      backendValues[key] = rawBackendValues[key];
    }
    const lastDequeueTime = backendValues[LAST_DEQUEUE_TIME_KEY];
    const categories = this.categoriesToDequeue(lastDequeueTime);

    if (!categories.length)
      return;

    var startTime = new Date();

    for (const category of categories) {
      this.debugLog(`Dequeueing ${category}`);
      await this.processSingleQueue(category);
    }

    backendValues[LAST_DEQUEUE_TIME_KEY] = Date.now();
    this.write2ColumnSheet(BACKEND_SHEET_NAME, Object.entries(backendValues))

    this.logTiming(`Finished dequeueing ${categories}`, startTime);
  }

}
