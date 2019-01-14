import {defined, USER_ID} from './Base.js';
import {gapiFetch} from './Net.js';

export class ThreadBase {
  private fetchPromise_:
      Promise<gapi.client.Response<gapi.client.gmail.Thread>>|null = null;

  constructor(public id: string, public historyId: string) {}

  protected getKey_(weekNumber: number) {
    return `thread-${weekNumber}-${this.historyId}`;
  }

  async fetch(_forceNetwork?: boolean, _skipNetwork?: boolean) {
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
    return defined(resp.result.messages);
  }
}
