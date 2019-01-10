import { ErrorLogger } from "./ErrorLogger.js";
import { IDBKeyVal } from "./idb-keyval.js";

let CONTACT_STORAGE_KEY = 'contacts';

interface Contact {
  name: string;
  emails: string[];
}

export class Contacts {
  private contacts_: Contact[];

  constructor() {
    this.contacts_ = [];
  }

  getAll() {
    return this.contacts_;
  }

  async fetch(token: gapi.auth.GoogleApiOAuth2TokenObject) {
    if (this.contacts_.length)
      return;

    // This is 450kb! Either cache this and fetch infrequently, or find a way of
    // getting the API to not send the data we don't need.
    let response;
    try {
      response = await fetch(
          'https://www.google.com/m8/feeds/contacts/default/thin?alt=json&access_token=' +
          token.access_token + '&max-results=20000&v=3.0');
    } catch (e) {
      let message =
          `Failed to fetch contacts. Google Contacts API is hella unsupported. See https://issuetracker.google.com/issues/115701813.`;

      let contacts = await IDBKeyVal.getDefault().get(CONTACT_STORAGE_KEY);
      if (!contacts) {
        ErrorLogger.log(message);
        return;
      }

      ErrorLogger.log(`Using locally stored version of contacts. ${message}`);

      // Manually copy each contact instead of just assigning because contacts_ is
      // passed around and stored.
      let parsed = JSON.parse(contacts);
      for (let contact of parsed) {
        this.contacts_.push(contact);
      }
      return;
    }

    let json = await response.json();
    for (let entry of json.feed.entry) {
      if (!entry.gd$email)
        continue;
      let contact = <Contact>{};
      if (entry.title.$t)
        contact.name = entry.title.$t;
      contact.emails = [];
      for (let email of entry.gd$email) {
        contact.emails.push(email.address);
      }
      this.contacts_.push(contact);
    }

    // Store the final contacts object instead of the data fetched off the network
    // since the latter can is order of magnitude larger and can exceed the
    // allowed localStorage quota.
    await IDBKeyVal.getDefault().set(
        CONTACT_STORAGE_KEY, JSON.stringify(this.contacts_));
  }
}
