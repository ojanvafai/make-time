import {defined, assert} from './Base.js';
import {Labels} from './Labels.js';
import {ServerStorage, ServerStorageUpdateEventName, StorageUpdates} from './ServerStorage.js';

export interface QueueData {
  queue: string;
  goal: string;
  index: number;
}

export interface QueueListEntry {
  label: string;
  data: QueueData;
}

export interface AllQueueDatas {
  [property: string]: QueueData;
}

export class QueueSettings {
  private queueDatas_?: AllQueueDatas;

  private static BUFFER_ = 10000;
  static MONTHLY = 'Monthly';
  static WEEKLY = 'Weekly';
  static DAILY = 'Daily';
  static IMMEDIATE = 'Immediate';
  static WEEKDAYS = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
  ];
  static goals = ['Inbox Zero', 'Best Effort']

  constructor(private storage_: ServerStorage) {
    this.storage_.addEventListener(
        ServerStorageUpdateEventName, () => this.resetQueueData_());
  }

  async fetch() {
    this.resetQueueData_();
    if (!this.queueDatas_) {
      let updates: StorageUpdates = {};
      updates[ServerStorage.KEYS.QUEUES] = {};
      await this.storage_.writeUpdates(updates);
      this.resetQueueData_();
      assert(this.queueDatas_);
    }
  }

  async resetQueueData_() {
    this.queueDatas_ = this.storage_.get(ServerStorage.KEYS.QUEUES);
    if (!this.queueDatas_)
      return;

    // Blocked is a special label that dequeues daily, is not best effort, and
    // is always put first.
    this.queueDatas_[Labels.BLOCKED_SUFFIX] =
        this.queueData_(QueueSettings.DAILY);
  }

  get(labelSuffix: string) {
    return defined(this.queueDatas_)[labelSuffix.toLowerCase()] ||
        this.queueData_();
  }

  queueComparator_(a: QueueListEntry, b: QueueListEntry) {
    let aIndex = QueueSettings.queueIndex_(a.data);
    let bIndex = QueueSettings.queueIndex_(b.data);

    // If they have the same index, sort lexicographically.
    if (aIndex == bIndex) {
      if (a.label < b.label)
        return -1;
      else if (a.label > b.label)
        return 1;
      return 0
    }

    return aIndex - bIndex;
  }

  queueData_(opt_queue?: string, opt_goal?: string, opt_index?: number):
      QueueData {
    return {
      queue: opt_queue || QueueSettings.IMMEDIATE,
          goal: opt_goal || QueueSettings.goals[0],
          // For unknown queues, put them first.
          index: opt_index || 0,
    }
  }

  queueEntry_(label: string): QueueListEntry {
    let suffix = Labels.removeNeedsTriagePrefix(label);
    let data = this.get(suffix);
    return {label: label, data: data};
  }

  queueNameComparator(a: string, b: string) {
    return this.queueComparator_(this.queueEntry_(a), this.queueEntry_(b));
  }

  getSorted(labels: Iterable<string>) {
    let entries: QueueListEntry[] = [];
    for (let label of labels) {
      entries.push(this.queueEntry_(label));
    }
    return entries.sort(this.queueComparator_);
  }

  entries() {
    return Object.entries(defined(this.queueDatas_));
  }

  static queueIndex_ = (queueData: QueueData) => {
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
