import {defined, USER_ID, parseAddressList} from './Base.js';
import {fetchMessages} from './BaseMain.js';
import {IDBKeyVal} from './idb-keyval.js';

let CONTACT_STORAGE_KEY = 'contacts';
let SEND_COUNT_STORAGE_KEY = 'send-counts';
let MESSAGE_TO_EMAILS_STORAGE_KEY = 'message-to-emails';
// The number of sent messages that we process to produce the count map used for
// sorting autocomplete results.
let NUMBER_SENT_MESSAGES_TO_FETCH = 1000;
let MESSAGE_FETCH_BATCH_SIZE = 50;

interface Contact {
  name: string;
  emails: string[];
}

let instance: Contacts;

export class Contacts {
  private contacts_: Contact[];
  private sendCounts_?: Map<string, number>;

  constructor() {
    this.contacts_ = [];
  }

  static getDefault() {
    if (!instance) {
      instance = new Contacts();
      // These are async, but we want to return the Contacts instance sync, so
      // we can't await them, which means that callers need to handle contacts
      // and sendCounts being uninitialized.
      instance.fetchContactsFromDisk();
      instance.fetchCountsFromDisk();
    }
    return instance;
  }

  getAll() {
    return this.contacts_;
  }

  getSendCounts() {
    return this.sendCounts_;
  }

  async update() {
    this.contacts_ = await this.fetchContactsFromNetwork();
    this.sendCounts_ = await this.fetchCountsFromNetwork_();
  }

  async fetchContactsFromDisk() {
    let contacts = await IDBKeyVal.getDefault().get(CONTACT_STORAGE_KEY);
    if (contacts)
      this.contacts_ = JSON.parse(contacts);
  }

  async fetchContactsFromNetwork() {
    // This is 450kb! Either cache this and fetch infrequently, or find a way of
    // getting the API to not send the data we don't need.
    let response = await fetch(
        'https://www.google.com/m8/feeds/contacts/default/thin?alt=json&access_token=' +
        gapi.auth.getToken().access_token + '&max-results=20000&v=3.0');

    let contacts = [];

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
      contacts.push(contact);
    }

    // Store the final contacts object instead of the data fetched off the
    // network since the latter is order of magnitude larger and can exceed
    // the allowed localStorage quota.
    await IDBKeyVal.getDefault().set(
        CONTACT_STORAGE_KEY, JSON.stringify(contacts));
    return contacts;
  }

  async fetchCountsFromDisk() {
    let counts = await IDBKeyVal.getDefault().get(SEND_COUNT_STORAGE_KEY);
    if (counts)
      this.sendCounts_ = new Map(JSON.parse(counts));
  }

  async fetchAddresses_(messageIds: string[]) {
    var batch = gapi.client.newBatch();
    messageIds.forEach(
        messageId => {batch.add(gapi.client.gmail.users.messages.get({
          userId: USER_ID,
          id: messageId,
          fields: 'id,payload/headers',
        }))});

    let result = (await batch).result;
    let responses = Object.values(result) as
        gapi.client.Response<gapi.client.gmail.Message>[];
    let out = new Map();
    for (let response of responses) {
      let addresses = [];
      let headers = defined(defined(defined(response.result).payload).headers);

      for (let header of headers) {
        let name = defined(header.name).toLowerCase();
        if (name === 'to' || name === 'cc' || name === 'bcc') {
          let emails = parseAddressList(defined(header.value));
          for (let email of emails) {
            if (email.address)
              addresses.push(email.address);
          }
        }
      }
      out.set(defined(response.result.id), addresses);
    }
    return out;
  }

  async fetchCountsFromNetwork_() {
    let cacheData =
        await IDBKeyVal.getDefault().get(MESSAGE_TO_EMAILS_STORAGE_KEY);
    let cache = cacheData ? new Map(JSON.parse(cacheData)) : new Map();
    let newCache = new Map();

    let counts = new Map();

    let processAddresses =
        (id: string, addresses: string) => {
          newCache.set(id, addresses);

          for (let address of addresses) {
            let previous = counts.get(address);
            let count = previous ? previous + 1 : 1;
            counts.set(address, count);
          }
        }

    let needsFetch: string[] = [];
    await fetchMessages(async (message) => {
      let id = defined(message.id);
      let addresses = cache.get(id);
      if (addresses)
        processAddresses(id, addresses);
      else
        needsFetch.push(id);
    }, 'in:sent', NUMBER_SENT_MESSAGES_TO_FETCH);

    while (needsFetch.length) {
      let thisBatch = [];
      while (needsFetch.length && thisBatch.length < MESSAGE_FETCH_BATCH_SIZE) {
        thisBatch.push(defined(needsFetch.pop()));
      }
      let addresses = await this.fetchAddresses_(thisBatch);
      for (let entry of addresses.entries()) {
        let id = entry[0];
        let addresses = entry[1];
        processAddresses(id, addresses);
      }
    }

    await IDBKeyVal.getDefault().set(
        MESSAGE_TO_EMAILS_STORAGE_KEY, JSON.stringify([...newCache]));

    // Store the final contacts object instead of the data fetched off the
    // network since the latter is order of magnitude larger and can exceed
    // the allowed localStorage quota.
    await IDBKeyVal.getDefault().set(
        SEND_COUNT_STORAGE_KEY, JSON.stringify([...counts]));

    return counts;
  }
}
