import {AsyncOnce} from './AsyncOnce.js';
import {Labels} from './Labels.js';
import {Settings} from './Settings.js';
import {SpreadsheetUtils} from './SpreadsheetUtils.js';

export class QueueSettings {
  private fetcher_: AsyncOnce;
  // TODO: Fix these to not assert non-null since they could realistically be
  // null if fetch() isn't completed.
  private map_!: any;

  private static BUFFER_ = 10000;
  static MONTHLY = 'Monthly';
  static WEEKLY = 'Weekly';
  static DAILY = 'Daily';
  static IMMEDIATE = 'Immediate';
  static WEEKDAYS = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
  ];
  static goals = ['Inbox Zero', 'Best Effort']

  constructor(private spreadsheetId_: string) {
    this.fetcher_ = new AsyncOnce(this.fetch_.bind(this))
  }

  async fetch() {
    await this.fetcher_.do()
  }

  async fetch_() {
    let values = await SpreadsheetUtils.fetchSheet(
        this.spreadsheetId_, `${Settings.QUEUED_LABELS_SHEET_NAME}!A2:D`);
    this.populateMap_(values);
  }

  populateMap_(rawData: any) {
    this.map_ = {};

    for (let value of rawData) {
      let labelName = value[0].toLowerCase();
      this.map_[labelName] = this.queueData_(value[1], value[2], value[3]);
    }
  }

  async write(newData: any[]) {
    let originalQueueCount = Object.keys(this.map_).length;
    let dataToWrite = [Settings.QUEUED_LABELS_SHEET_COLUMNS].concat(newData);
    await SpreadsheetUtils.writeSheet(
        this.spreadsheetId_, Settings.QUEUED_LABELS_SHEET_NAME, dataToWrite,
        originalQueueCount);
    this.populateMap_(newData);
  }

  get(labelSuffix: string) {
    return this.map_[labelSuffix.toLowerCase()] || this.queueData_();
    ;
  }

  queueComparator_(a: any, b: any) {
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

  queueData_(opt_queue?: string, opt_goal?: string, opt_index?: number) {
    return {
      queue: opt_queue || QueueSettings.IMMEDIATE,
          goal: opt_goal || QueueSettings.goals[0],
          // For unknown queues, put them first.
          index: opt_index || 0,
    }
  }

  queueEntry_(label: string) {
    let suffix = Labels.removeNeedsTriagePrefix(label);
    let data = this.get(suffix);
    return [label, data];
  }

  queueNameComparator(a: any, b: any) {
    return this.queueComparator_(this.queueEntry_(a), this.queueEntry_(b));
  }

  getSorted(labels: Iterable<string>) {
    let entries: any[] = [];
    for (let label of labels) {
      entries.push(this.queueEntry_(label));
    }
    return entries.sort(this.queueComparator_);
  }

  entries() {
    return Object.entries(this.map_);
  }

  static queueIndex_ = (queueData: any) => {
    let multiplier = 1;

    let queue = queueData.queue;
    if (queue == QueueSettings.DAILY)
      multiplier *= QueueSettings.BUFFER_;
    else if (QueueSettings.WEEKDAYS.includes(queue))
      multiplier *= QueueSettings.BUFFER_ * QueueSettings.BUFFER_;
    else if (queue == QueueSettings.MONTHLY)
      multiplier *=
          QueueSettings.BUFFER_ * QueueSettings.BUFFER_ * QueueSettings.BUFFER_;

    return queueData.index * multiplier;
  }
}
