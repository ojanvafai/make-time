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
  constructor(settings) {
    this.settings = settings;
  }

  hasWhiteSpace(str) {
    return /\s/g.test(str);
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

  // TODO: Merge this with the other label code.
  async getLabelNames() {
    var response = await gapi.client.gmail.users.labels.list({
      'userId': USER_ID
    })

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

    var noWhiteSpaceValues = this.settings.no_white_space_fields.split(',');

    for (var i = 1, l = rawRules.length; i < l; i++) {
      var ruleObj = {};
      for (var j = 0; j < ruleNames.length; j++) {
        var name = ruleNames[j];
        var value = rawRules[i][j];
        if (j == labelColumn)
          labels[value] = true;

        if (noWhiteSpaceValues.includes(name)) {
          if (this.hasWhiteSpace(value))
            throw "Rule in row" + (i + 1) + " has disallowed whitespace for field '" + name + "' with value '" + value + "'";
        }
        ruleObj[name] = value;
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
    let response = await gapi.client.sheets.spreadsheets.values.append(requestParams, requestBody);
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
    let response = await gapi.client.sheets.spreadsheets.values.update(requestParams, requestBody);
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
    return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + (date.getDate() + 1);
  }

  async getSheetId(sheetName) {
    let response = await gapi.client.sheets.spreadsheets.get({
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

    let response = await gapi.client.sheets.spreadsheets.batchUpdate(params, batchUpdateSpreadsheetRequestBody);
    // TODO: Handle response.status != 200.
  }

  async writeCollapsedStats(stats) {
    if (stats && stats.numInvocations)
      await this.appendToSheet(DAILY_STATS_SHEET_NAME, [Object.values(stats)]);
  }

  async collapseStats() {
    let stats;
    var rows = await fetchSheet(this.settings.spreadsheetId, STATISTICS_SHEET_NAME);
    let todayYearMonthDay = this.getYearMonthDay(Date.now());
    let currentYearMonthDay;

    let lastRowProcessed = 0;

    for (var i = 1; i < rows.length; ++i) {
      // timestamp, threads_processed, messages_processed, total_time, perLabelThreadCountJSON

      let timestamp = rows[i][0];
      // Ignore empty rows
      if (!timestamp) {
        continue;
      }

      let yearMonthDay = this.getYearMonthDay(Number(timestamp));

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
      stats.totalThreads += rows[i][1];

      stats.totalTime += Number(rows[i][2]);
      stats.minTime = Math.min(stats.minTime, rows[i][2]);
      stats.maxTime = Math.max(stats.maxTime, rows[i][2]);

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
  }

  matchesRule(rule, message) {
    var matches = false;
    if (rule.to) {
      if (!this.containsAddress(message.to, rule.to) &&
          !this.containsAddress(message.cc, rule.to) &&
        !this.containsAddress(message.bcc, rule.to))
        return false;
      matches = true;
    }
    if (rule.from) {
      if (!this.containsAddress(message.from, rule.from))
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
      if (!message.plain.includes(rule.plaintext))
        return false;
      matches = true;
    }
    if (rule.htmlcontent) {
      if (!message.html.includes(rule.htmlcontent))
        return false;
      matches = true;
    }
    return matches;
  }

  processMessage(message, rules, threadSubject) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (this.matchesRule(rule, message)) {
        this.debugLog('Matched rule ' + JSON.stringify(rule));
        return i;
      }
    }
    return rules.length;
  };

  allMessagesAre(messages, criteria) {
    for (var i = 0; i < messages.length(); i++) {
      if (!criteria(messages.get(i)))
        return false;
    }
    return true;
  }

  customProcessedLabel(messages) {
    if (this.settings.auto_responder_label && messages.length == 1 && messages[0].xAutoreply)
      return this.settings.auto_responder_label;
    return null;
  }

  async processThread(thread, rules) {
    var startTime = new Date();
    this.debugLog('Processing thread with subject ' + thread.subject);

    var result = {};

    await thread.fetchMessages();
    var messages = thread.messages;
    var label = this.customProcessedLabel(messages);

    if (!label) {
      var minRuleIndex = rules.length;
      for (let message of messages) {
        var ruleTriggered = this.processMessage(message, rules, thread.subject);
        minRuleIndex = Math.min(minRuleIndex, ruleTriggered);
      }

      if (minRuleIndex != rules.length)
        label = rules[minRuleIndex].label;
    }

    // Ensure there's always some label to make sure bugs don't cause emails to get lost silently.
    if (!label)
      label = this.settings.fallback_label;

    this.debugLogTiming('Thread processing completed', startTime);

    return { label: label };
  }

  currentTriagedLabel(thread) {
    var labels = thread.labelNames;
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].startsWith(TRIAGER_LABELS.triaged + '/'))
        return labels[i];
    }
    return null;
  }

  async processMail() {
    let rawThreads = await fetchThreads(this.settings.unprocessed_label);
    if (!rawThreads.length)
      return;

    updateTitle(`Processing ${rawThreads.length} unprocessed threads`);

    console.log('Processing mail');
    let startTime = new Date();

    let threadMap = {};
    let threads = [];
    await fillLabelsForThreads(rawThreads, threads, threadMap);

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

    let batch = new BatchRequester();
    for (var i = 0; i < threads.length; i++) {
      let thread = threads[i];
      let labelName;

      let removeLabelIds = [unprocessedLabelId];
      let addLabelIds = [];
      if (processedLabelId)
        addLabelIds.push(processedLabelId);

      // Triaged items when reprocessed go in the rtriage queue regardless of what label they
      // might otherwise go in.
      let currentTriagedLabel = this.currentTriagedLabel(thread);
      if (currentTriagedLabel) {
        if (currentTriagedLabel == MUTED_LABEL) {
          await batch.add(modifyThreadRequest(thread, addLabelIds, removeLabelIds));
          continue;
        }
        labelName = TRIAGER_LABELS.retriage;
      } else {
        let result = this.processThread(thread, rulesSheet.rules);
        labelName = result.label || this.settings.fallback_label;
      }

      this.debugLog("Applying label: " + labelName);
      let alreadyHadLabel = false;

      if (labelName == this.settings.archive_label) {
        if (thread.isInInbox())
          removeLabelIds.push('INBOX');
        else
          alreadyHadLabel = true;
        removeLabelIds = removeLabelIds.concat(labelIdsToRemove);
      } else {
        let prefixedLabelName = this.addLabelPrefix(labelName);
        let prefixedLabelId = await getLabelId(prefixedLabelName);

        alreadyHadLabel = thread.labelIds.has(prefixedLabelId);

        addLabelIds.push(prefixedLabelId);
        removeLabelIds = removeLabelIds.concat(labelIdsToRemove.filter(id => id != prefixedLabelId));

        if (prefixedLabelName != addQueuedPrefix(this.settings, labelName))
          addLabelIds.push('INBOX');
      }

      await batch.add(modifyThreadRequest(thread, addLabelIds, removeLabelIds));

      if (!alreadyHadLabel) {
        if (!perLabelCounts[labelName])
          perLabelCounts[labelName] = 0;
        perLabelCounts[labelName] += 1;
        newlyLabeledThreadsCount++;
      }
    }

    await batch.complete();

    if (newlyLabeledThreadsCount) {
      this.writeToStatsPage(
        startTime.getTime(), newlyLabeledThreadsCount, perLabelCounts, Date.now() - startTime.getTime());
    }

    this.logTiming(`Finished processing ${threads.length} threads`, startTime);
    return threads.length;
  }

  async dequeue(labelName, queue) {
    updateTitle(`Dequeuing ${labelName} bundle...`);
    var queuedLabelName = addQueuedPrefix(this.settings, labelName);
    var queuedLabel = await getLabelId(queuedLabelName);
    var autoLabel = await getLabelId(this.addAutoPrefix(queuePrefixMap[queue] + '/' + labelName));
    var threads = await fetchThreads(queuedLabelName);

    if (!threads.length)
      return;

    let batch = new BatchRequester();
    for (var i = 0; i < threads.length; i++) {
      var thread = threads[i];
      let addLabelIds = ['INBOX', autoLabel];
      let removeLabelIds = [queuedLabel];
      await batch.add(modifyThreadRequest(thread, addLabelIds, removeLabelIds));
    }
    await batch.complete();
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

    let startDay = new Date(start).getDay();
    let endDay = new Date(end).getDay();

    // Have already processed today.
    if (startDay == endDay && diffDays < 1)
      return [];

    let days = [];

    if (startDay < endDay) {
      for (var i = startDay + 1; i <= endDay; i++) {
        days.push(WEEKDAYS[i]);
      }
    } else {
      for (var i = startDay + 1; i < WEEKDAYS.length; i++) {
        days.push(WEEKDAYS[i]);
      }
      for (var i = 0; i <= endDay; i++) {
        days.push(WEEKDAYS[i]);
      }
    }

    days.push(DAILY);

    return days;
  }

  async processQueues() {
    console.log('Processing queues');
    var startTime = new Date();

    const rawBackendValues = await fetch2ColumnSheet(this.settings.spreadsheetId, BACKEND_SHEET_NAME);
    const backendValues = {};
    // Strip no longer supported backend keys.
    for (let i = 0; i < BACKEND_KEYS.length; i++) {
      const key = BACKEND_KEYS[i];
      backendValues[key] = rawBackendValues[key];
    }
    const lastDequeueTime = backendValues[LAST_DEQUEUE_TIME_KEY];
    const categories = this.categoriesToDequeue(lastDequeueTime);

    for (const category of categories) {
      this.debugLog(`Dequeueing ${category}`);
      await this.processSingleQueue(category);
    }

    // Only write the last dequeue time to the backend if we dequeued anything.
    if (categories.length) {
      backendValues[LAST_DEQUEUE_TIME_KEY] = Date.now();
      this.write2ColumnSheet(BACKEND_SHEET_NAME, Object.entries(backendValues))
    }

    this.logTiming(`Finished dequeueing ${categories}`, startTime);
  }

}
