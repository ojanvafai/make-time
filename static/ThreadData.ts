import {defined, getCurrentWeekNumber, getPreviousWeekNumber} from './Base.js';
import {IDBKeyVal} from './idb-keyval.js';
import {Thread} from './Thread.js';
import {ThreadBase} from './ThreadBase.js';
import { Labels } from './Labels.js';

// Class with just the basic thread data to fetch a proper Thread.
export class ThreadData extends ThreadBase {
  constructor(thread: (gapi.client.gmail.Thread|Thread), private labels_: Labels) {
    super(defined(thread.id), defined(thread.historyId));
  }

  async upgrade(onlyFetchFromDisk: boolean) {
    let messages = await this.fetchFromDisk();
    if (!messages && !onlyFetchFromDisk)
      messages = await this.fetch();
    if (!messages)
      return null;

    let thread = new Thread(this, this.labels_);
    await thread.processMessages(messages);
    return thread;
  }

  async fetchFromDisk() {
    let currentKey = this.getKey_(getCurrentWeekNumber());
    let localData = await IDBKeyVal.getDefault().get(currentKey);

    if (!localData) {
      let previousKey = this.getKey_(getPreviousWeekNumber());
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
