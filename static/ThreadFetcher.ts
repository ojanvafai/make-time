import {assert, defined, getCurrentWeekNumber, getPreviousWeekNumber, USER_ID} from './Base.js';
import {IDBKeyVal} from './idb-keyval.js';
import {Labels} from './Labels.js';
import {gapiFetch} from './Net.js';
import {Thread} from './Thread.js';
import {ThreadUtils} from './ThreadUtils.js';

let memoryCache: Map<string, Thread> = new Map();

export class ThreadFetcher {
  private fetchPromise_:
      Promise<gapi.client.Response<gapi.client.gmail.Thread>>|null = null;

  constructor(
      public id: string, public historyId: string, private allLabels_: Labels) {
  }

  async fetch(onlyFetchFromDisk?: boolean) {
    // TODO: This cache grows indefinitely. A simple fix could be to delete the
    // cache once a day. All the data is on disk, so it shouldn't be too
    // expensive.
    let entry = memoryCache.get(this.id);
    if (entry instanceof Thread) {
      if (entry.historyId != this.historyId)
        await entry.update();
      return entry;
    }

    let messages = await this.fetchFromDisk();
    if (!messages && !onlyFetchFromDisk)
      messages = await this.fetchFromNetwork();
    if (!messages) {
      assert(onlyFetchFromDisk);
      return null;
    }

    let processed =
        await ThreadUtils.processMessages(messages, [], this.allLabels_);
    let thread =
      new Thread(this.id, this.historyId, processed, this.allLabels_);
    memoryCache.set(this.id, thread);
    return thread;
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
