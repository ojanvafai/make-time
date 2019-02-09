import {USER_ID} from './Base.js';
import {gapiFetch} from './Net.js';

export class SendAs {
  senders?: gapi.client.gmail.SendAs[];

  async fetch() {
    var response = await gapiFetch(
        gapi.client.gmail.users.settings.sendAs.list, {'userId': USER_ID});
    this.senders = response.result.sendAs;
  }
}
