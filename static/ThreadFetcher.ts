import {assert, defined, getCurrentWeekNumber, getPreviousWeekNumber, USER_ID} from './Base.js';
import {IDBKeyVal} from './idb-keyval.js';
import {Labels} from './Labels.js';
import {gapiFetch} from './Net.js';
import {Thread} from './Thread.js';
import {ThreadUtils} from './ThreadUtils.js';

let memoryCache: Map<string, Thread> = new Map();

interface SerializedMessages {
  historyId?: string;
  messages?: gapi.client.gmail.Message[];
}

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

    let data = await this.fetchFromDisk();
    if (!data && !onlyFetchFromDisk)
      data = await this.fetchFromNetwork();
    if (!data) {
      assert(onlyFetchFromDisk);
      return null;
    }

    let processed = await ThreadUtils.processMessages(
        defined(data.messages), [], this.allLabels_);
    let thread =
        new Thread(this.id, this.historyId, processed, this.allLabels_);
    if (data.historyId != this.historyId)
      await thread.update();
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

    let messages = defined(resp.result.messages);
    await ThreadUtils.serializeMessageData(messages, this.id, this.historyId);
    return resp.result;
  }

  async fetchFromDisk(): Promise<SerializedMessages|null> {
    let currentWeekKey = ThreadUtils.getKey(getCurrentWeekNumber(), this.id);
    let localData = await IDBKeyVal.getDefault().get(currentWeekKey);

    let oldKey;
    if (!localData) {
      oldKey = ThreadUtils.getKey(getPreviousWeekNumber(), this.id);
      localData = await IDBKeyVal.getDefault().get(oldKey);
    }

    // TODO: Remove this once all clients have updated.
    if (!localData) {
      oldKey = ThreadUtils.getKey(getCurrentWeekNumber(), this.historyId);
      localData = await IDBKeyVal.getDefault().get(oldKey);
    }

    // TODO: Remove this once all clients have updated.
    if (!localData) {
      oldKey = ThreadUtils.getKey(getPreviousWeekNumber(), this.historyId);
      localData = await IDBKeyVal.getDefault().get(oldKey);
    }

    if (!localData)
      return null;

    let parsed = JSON.parse(localData);
    // TODO: Remove this version below once all clients have updated.
    if (Array.isArray(parsed)) {
      if (!oldKey)
        oldKey = currentWeekKey;

      parsed = {
        historyId: this.historyId,
        messages: parsed,
      }
    }

    if (oldKey) {
      // TODO: Use the localData string once we remove the isArray block above.
      await IDBKeyVal.getDefault().del(oldKey);
      await IDBKeyVal.getDefault().set(currentWeekKey, JSON.stringify(parsed));
    }

    return parsed;
  }
}
