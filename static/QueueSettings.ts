import {assert, defined} from './Base.js';
import {IMPORTANT_NAME, RETRIAGE_LABEL_NAME} from './models/TodoModel.js';
import {ServerStorage, ServerStorageUpdateEventName, StorageUpdates} from './ServerStorage.js';
import {STUCK_LABEL_NAME} from './Thread.js';

export enum MergeOption {
  separate = 'Separate',
  merge = 'Merge',
}

export enum ThrottleOption {
  throttle = 'Throttle',
  immediate = 'Immediate',
}

export interface QueueData {
  queue: string;
  index: number;
  merge: MergeOption;
  throttle: ThrottleOption;
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
  private mergeMap_?: Map<string, string>;
  private retriageQueueData_: QueueListEntry;
  private stuckQueueData_: QueueListEntry;
  private importantQueueData_: QueueListEntry;

  private static BUFFER_ = 10000;
  static MONTHLY = 'Monthly';
  static WEEKLY = 'Weekly';
  static DAILY = 'Daily';
  static IMMEDIATE = 'Immediate';
  static WEEKDAYS = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
  ];

  constructor(private storage_: ServerStorage) {
    this.storage_.addEventListener(
        ServerStorageUpdateEventName, () => this.resetQueueData_());

    // Gnarly hack to put retriage threads in between immediate/daily and
    // weekly/monthly queues. This relies on QueueSettings.queueIndex
    // multiplying weekly/monthly groups by a buffer. As such,
    // QueueSettings.BUFFER_ * QueueSettings.BUFFER_ is the transition point
    // from daily to weekly queues.
    let maxDailyQueueIndex = QueueSettings.BUFFER_ * QueueSettings.BUFFER_ - 1;
    this.retriageQueueData_ = {
      label: RETRIAGE_LABEL_NAME,
      data: this.queueData_(QueueSettings.IMMEDIATE, maxDailyQueueIndex)
    };

    this.stuckQueueData_ = {
      label: STUCK_LABEL_NAME,
      data: this.queueData_(QueueSettings.IMMEDIATE, maxDailyQueueIndex - 1)
    };

    this.importantQueueData_ = {
      label: IMPORTANT_NAME,
      data: this.queueData_(QueueSettings.IMMEDIATE, 0)
    };
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

    // Legacy queue datas don't have the throttle field set.
    for (let queueData of Object.values(this.queueDatas_)) {
      queueData.throttle = queueData.throttle || ThrottleOption.immediate;
    }

    let datas = Object.entries(this.queueDatas_)
                    .sort(
                        (a, b) => QueueSettings.queueIndex_(a[1]) -
                            QueueSettings.queueIndex_(b[1]));

    this.mergeMap_ = new Map();
    let group = [];
    for (let data of datas) {
      let merge = group.length && data[1].merge === MergeOption.merge;
      if (!merge) {
        if (group.length) {
          this.setMappedGroup_(group);
          group = [];
        }
      }
      group.push(data[0]);
    }

    if (group.length)
      this.setMappedGroup_(group);
  }

  setMappedGroup_(names: string[]) {
    let map = defined(this.mergeMap_);
    let mergedName = names.join(', ');
    for (let name of names) {
      map.set(name, mergedName);
    }
  }

  getMappedGroupName(groupName: string) {
    return defined(this.mergeMap_).get(groupName);
  }

  get(label: string) {
    return defined(this.queueDatas_)[label.toLowerCase()] || this.queueData_();
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

  queueData_(
      opt_queue?: string, opt_index?: number, mergeOption?: MergeOption,
      throttleOption?: ThrottleOption): QueueData {
    return {
      queue: opt_queue || QueueSettings.IMMEDIATE,
      // For unknown queues, put them first.
      index: opt_index || 0,
      merge: mergeOption || MergeOption.separate,
      throttle: throttleOption || ThrottleOption.immediate,
    };
  }

  queueEntry_(label: string): QueueListEntry {
    if (label === RETRIAGE_LABEL_NAME)
      return this.retriageQueueData_;

    if (label === STUCK_LABEL_NAME)
      return this.stuckQueueData_;

    if (label === IMPORTANT_NAME)
      return this.importantQueueData_;

    let data = this.get(label);
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
