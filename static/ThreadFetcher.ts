import {assert, defined, USER_ID} from './Base.js';
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

    let data = await ThreadUtils.fetchFromDisk(this.id);
    if (!data && !onlyFetchFromDisk)
      data = await this.fetchFromNetwork();
    if (!data) {
      assert(onlyFetchFromDisk);
      return null;
    }

    let processed = await ThreadUtils.processMessages(
        defined(data.messages), [], this.allLabels_);
    // Make sure to use the historyId that matches the processed threads.
    let thread = new Thread(
        this.id, defined(data.historyId), processed, this.allLabels_);
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
}
