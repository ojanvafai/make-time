class QueueSettings {
  constructor(spreadsheetId) {
    this.spreadsheetId_ = spreadsheetId;
  }

  async fetch() {
    let values = await SpreadsheetUtils.fetchSheet(this.spreadsheetId_, `${Settings.QUEUED_LABELS_SHEET_NAME}!A2:D`);
    this.populateMap_(values);
  }

  populateMap_(rawData) {
    this.map_ = {};

    for (let value of rawData) {
      let labelName = value[0].toLowerCase();
      this.map_[labelName] = this.queueData_(value[1], value[2], value[3]);
    }
  }

  async write(newData) {
    let originalQueueCount = Object.keys(this.map_).length;
    let dataToWrite = [Settings.QUEUED_LABELS_SHEET_COLUMNS].concat(newData);
    await SpreadsheetUtils.writeSheet(this.spreadsheetId_, Settings.QUEUED_LABELS_SHEET_NAME, dataToWrite, originalQueueCount);
    this.populateMap_(newData);
  }

  get(label) {
    return this.map_[label.toLowerCase()] || this.queueData_();;
  }

  queueComparator_(a, b) {
    let aIndex = QueueSettings.queueIndex_(a[1]);
    let bIndex = QueueSettings.queueIndex_(b[1]);

    // If they have the same index, sort lexicographically.
    if (aIndex == bIndex) {
      if (a < b)
        return -1;
      else if (a > b)
        return 1;
      return 0
    }

    return aIndex - bIndex;
  }

  queueData_(opt_queue, opt_goal, opt_index) {
    return {
      queue: opt_queue || MailProcessor.IMMEDIATE,
      goal: opt_goal || QueuesView.goals_[0],
      index: opt_index || 1,
    }
  }

  getSorted(labels) {
    let entries = [];
    for (let label of labels) {
      let suffix = Labels.removeNeedsTriagePrefix(label);
      suffix = Labels.removeLabelPrefix(suffix, Labels.DAILY_QUEUE_PREFIX);
      suffix = Labels.removeLabelPrefix(suffix, Labels.WEEKLY_QUEUE_PREFIX);
      suffix = Labels.removeLabelPrefix(suffix, Labels.MONTHLY_QUEUE_PREFIX);

      let data = this.map_[suffix] || this.queueData_();
      entries.push([label, data]);
    }
    return entries.sort(this.queueComparator_);
  }

  entries() {
    return Object.entries(this.map_);
  }
}

QueueSettings.queueIndex_ = (queueData) => {
  let multiplier = 1;

  let queue = queueData.queue;
  if (queue == MailProcessor.DAILY)
    multiplier *= QueueSettings.BUFFER_;
  else if (MailProcessor.WEEKDAYS.includes(queue))
    multiplier *= QueueSettings.BUFFER_ * QueueSettings.BUFFER_;
  else if (queue == MailProcessor.MONTHLY)
    multiplier *= QueueSettings.BUFFER_ * QueueSettings.BUFFER_ * QueueSettings.BUFFER_;

  return queueData.index * multiplier;
}

QueueSettings.BUFFER_ = 10000;
