import {defined, getCurrentWeekNumber, getPreviousWeekNumber, USER_ID} from './Base.js';
import {IDBKeyVal} from './idb-keyval.js';
import {Labels} from './Labels.js';
import {gapiFetch} from './Net.js';
import {Thread} from './Thread.js';
import {ThreadUtils} from './ThreadUtils.js';

// Class with just the basic thread data to fetch a proper Thread.
export class ThreadFetcher {
  private fetchPromise_:
      Promise<gapi.client.Response<gapi.client.gmail.Thread>>|null = null;

  constructor(
      public id: string, public historyId: string, private allLabels_: Labels) {
  }

  async fetch(onlyFetchFromDisk: boolean) {
    let messages = await this.fetchFromDisk();
    if (!messages && !onlyFetchFromDisk)
      messages = await this.fetchFromNetwork();
    if (!messages)
      return null;

    let processed =
        await ThreadUtils.processMessages(messages, [], this.allLabels_);
    return new Thread(this.id, this.historyId, processed, this.allLabels_);
  }

  async fetchFromNetwork() {
    if (!this.fetchPromise_) {
      this.fetchPromise_ = gapiFetch(gapi.client.gmail.users.threads.get, {
        userId: USER_ID,
        id: this.id,
      })
    }
    let resp = await this.fetchPromise_;
    this.fetchPromise_ = null;

    // If modifications have come in since we first created this Thread
    // instance then the historyId will have changed.
    this.historyId = defined(resp.result.historyId);

    let messages = defined(resp.result.messages);
    await ThreadUtils.serializeMessageData(messages, this.historyId);
    return messages;
  }

  async fetchFromDisk() {
    let currentKey = ThreadUtils.getKey(getCurrentWeekNumber(), this.historyId);
    let localData = await IDBKeyVal.getDefault().get(currentKey);

    if (!localData) {
      let previousKey =
          ThreadUtils.getKey(getPreviousWeekNumber(), this.historyId);
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
