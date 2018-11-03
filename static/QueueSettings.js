import { Labels } from './Labels.js';
import { QueuesView } from './views/Queues.js';
import { Settings } from './Settings.js';
import { SpreadsheetUtils } from './SpreadsheetUtils.js';

export class QueueSettings {
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

  get(labelSuffix) {
    return this.map_[labelSuffix.toLowerCase()] || this.queueData_();;
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
      queue: opt_queue || QueueSettings.IMMEDIATE,
      goal: opt_goal || QueuesView.goals_[0],
      // For unknown queues, put them first.
      index: opt_index || 0,
    }
  }

  queueEntry_(label) {
    let suffix = Labels.removeNeedsTriagePrefix(label);
    let data = this.get(suffix);
    return [label, data];
  }

  queueNameComparator(a, b) {
    return this.queueComparator_(this.queueEntry_(a), this.queueEntry_(b));
  }

  getSorted(labels) {
    let entries = [];
    for (let label of labels) {
      entries.push(this.queueEntry_(label));
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
  if (queue == QueueSettings.DAILY)
    multiplier *= QueueSettings.BUFFER_;
  else if (QueueSettings.WEEKDAYS.includes(queue))
    multiplier *= QueueSettings.BUFFER_ * QueueSettings.BUFFER_;
  else if (queue == QueueSettings.MONTHLY)
    multiplier *= QueueSettings.BUFFER_ * QueueSettings.BUFFER_ * QueueSettings.BUFFER_;

  return queueData.index * multiplier;
}

QueueSettings.BUFFER_ = 10000;

QueueSettings.MONTHLY = 'Monthly';
QueueSettings.WEEKLY = 'Weekly';
QueueSettings.DAILY = 'Daily';
QueueSettings.IMMEDIATE = 'Immediate';
QueueSettings.WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
