import { USER_ID } from './Base.js';
import { initialLogin } from './BaseMain.js';
import { IDBKeyVal } from './idb-keyval.js';
import { gapiFetch } from './Net.js';

let instance: SendAs;
let STORAGE_KEY = 'send-as';

export class SendAs {
  senders?: gapi.client.gmail.SendAs[];

  static async getDefault() {
    if (!instance) {
      instance = new SendAs();
      await instance.fetch_();
    }
    return instance;
  }

  private async fetch_() {
    let senders = await IDBKeyVal.getDefault().get(STORAGE_KEY);
    if (senders) this.senders = JSON.parse(senders);
    else await this.update();
  }

  async update() {
    // Need to login before calling out to gmail API. Usually we'll already be
    // logged in, but not always if we get here from fetch_.
    await initialLogin();
    var response = await gapiFetch(gapi.client.gmail.users.settings.sendAs.list, {
      userId: USER_ID,
    });
    this.senders = response.result.sendAs;
    await IDBKeyVal.getDefault().set(STORAGE_KEY, JSON.stringify(this.senders));
  }
}
