import {defined, getCurrentWeekNumber, getPreviousWeekNumber} from './Base.js';
import {IDBKeyVal} from './idb-keyval.js';
import {Thread} from './Thread.js';
import {ThreadBase} from './ThreadBase.js';
import { Labels } from './Labels.js';

// Class with just the basic thread data to fetch a proper Thread.
export class ThreadData extends ThreadBase {
  constructor(thread: (gapi.client.gmail.Thread|Thread), allLabels: Labels) {
    super(defined(thread.id), defined(thread.historyId), allLabels);
  }

  async upgrade(onlyFetchFromDisk: boolean) {
    let messages = await this.fetchFromDisk();
    if (!messages && !onlyFetchFromDisk)
      messages = await this.fetch();
    if (!messages)
      return null;

    let processed = await this.processMessages(messages, []);
    return new Thread(this, processed, this.allLabels);
  }

  async fetchFromDisk() {
    let currentKey = this.getKey(getCurrentWeekNumber());
    let localData = await IDBKeyVal.getDefault().get(currentKey);

    if (!localData) {
      let previousKey = this.getKey(getPreviousWeekNumber());
      localData = await IDBKeyVal.getDefault().get(previousKey);
      if (localData) {
        await IDBKeyVal.getDefault().set(currentKey, localData);
        await IDBKeyVal.getDefault().del(previousKey);
      }
    }

    if (localData)
      return JSON.parse(localData);
    return null;
  }
}