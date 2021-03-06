import { defined, parseAddressList, USER_ID } from './Base.js';
import { FetchRequestParameters } from './Base.js';
import { IDBKeyVal } from './idb-keyval.js';
import { gapiFetch } from './Net.js';

let CONTACT_STORAGE_KEY = 'contacts';
let SEND_COUNT_STORAGE_KEY = 'send-counts';
let MESSAGE_TO_EMAILS_STORAGE_KEY = 'message-to-emails';
// The number of sent messages that we process to produce the count map used for
// sorting autocomplete results.
let NUMBER_SENT_MESSAGES_TO_FETCH = 1000;
let MESSAGE_FETCH_BATCH_SIZE = 50;
// Gmail API caps maxResults at 500.
let MAX_RESULTS_CAP = 500;

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
    if (contacts) this.contacts_ = JSON.parse(contacts);
  }

  async fetchContactsFromNetwork() {
    // TODO: Use nextSyncToken to do more frequent incremental contact syncing.
    let contacts: Contact[] = [];

    const appendContacts = (connections: gapi.client.people.Person[]) => {
      contacts = [
        ...contacts,
        ...connections
          .filter((x) => x.emailAddresses)
          .map(
            (x): Contact => {
              return {
                // TODO: Include all the names, not just the first one.
                name: x.names?.find((y) => y.displayName)?.displayName ?? '',
                emails: x.emailAddresses!.filter((y) => y.value).map((y) => y.value!),
              };
            },
          ),
      ];
    };

    const fetchAllPages = async (
      callback: (
        nextPageToken?: string,
      ) => Promise<[gapi.client.people.Person[] | undefined, string | undefined]>,
      nextPageToken?: string,
    ) => {
      const [connections, nextNextPageToken] = await callback(nextPageToken);
      if (connections) {
        appendContacts(connections);
      }
      if (nextNextPageToken) {
        await fetchAllPages(callback, nextNextPageToken);
      }
    };

    await fetchAllPages(async (pageToken?: string) => {
      let response = await gapiFetch(gapi.client.people.people.connections.list, {
        resourceName: 'people/me',
        pageSize: 1000,
        personFields: 'names,emailAddresses',
        pageToken,
      });
      return [response.result.connections, response.result.nextPageToken];
    });

    await fetchAllPages(async (pageToken?: string) => {
      let response = await gapiFetch(gapi.client.people.otherContacts.list, {
        pageSize: 1000,
        readMask: 'names,emailAddresses',
        pageToken,
      });
      return [response.result.otherContacts, response.result.nextPageToken];
    });

    // Store the final contacts object instead of the data fetched off the
    // network since the latter is order of magnitude larger and can exceed
    // the allowed localStorage quota.
    await IDBKeyVal.getDefault().set(CONTACT_STORAGE_KEY, JSON.stringify(contacts));
    return contacts;
  }

  async fetchCountsFromDisk() {
    let counts = await IDBKeyVal.getDefault().get(SEND_COUNT_STORAGE_KEY);
    if (counts) this.sendCounts_ = new Map(JSON.parse(counts));
  }

  async fetchAddresses_(messageIds: string[]) {
    var batch = gapi.client.newBatch();
    messageIds.forEach((messageId) => {
      batch.add(
        gapi.client.gmail.users.messages.get({
          userId: USER_ID,
          id: messageId,
          fields: 'id,payload/headers',
        }),
      );
    });

    let result = (await batch).result;
    let responses = Object.values(result) as gapi.client.Response<gapi.client.gmail.Message>[];
    let out = new Map();
    for (let response of responses) {
      let addresses = [];
      let headers = defined(defined(defined(response.result).payload).headers);

      for (let header of headers) {
        let name = defined(header.name).toLowerCase();
        if (name === 'to' || name === 'cc' || name === 'bcc') {
          let emails = parseAddressList(defined(header.value));
          for (let email of emails) {
            if (email.address) addresses.push(email.address);
          }
        }
      }
      out.set(defined(response.result.id), addresses);
    }
    return out;
  }

  private async fetchSentMessages_(forEachMessage: (message: gapi.client.gmail.Message) => void) {
    // Chats don't expose their bodies in the gmail API, so just skip them.
    let query = `in:sent AND -in:chats`;

    let resultCountLeft = NUMBER_SENT_MESSAGES_TO_FETCH;

    let getPageOfThreads = async (opt_pageToken?: string) => {
      let maxForThisFetch = Math.min(resultCountLeft, MAX_RESULTS_CAP);
      resultCountLeft -= maxForThisFetch;

      let requestParams = <FetchRequestParameters>{
        userId: USER_ID,
        q: query,
        maxResults: maxForThisFetch,
      };

      if (opt_pageToken) requestParams.pageToken = opt_pageToken;

      let resp = await gapiFetch(gapi.client.gmail.users.messages.list, requestParams);
      let messages = resp.result.messages || [];
      for (let message of messages) {
        await forEachMessage(message);
      }

      if (resultCountLeft <= 0) return;

      let nextPageToken = resp.result.nextPageToken;
      if (nextPageToken) await getPageOfThreads(nextPageToken);
    };

    await getPageOfThreads();
  }

  async fetchCountsFromNetwork_() {
    let cacheData = await IDBKeyVal.getDefault().get(MESSAGE_TO_EMAILS_STORAGE_KEY);
    let cache = cacheData ? new Map(JSON.parse(cacheData)) : new Map();
    let newCache = new Map();

    let counts = new Map();

    let processAddresses = (id: string, addresses: string) => {
      newCache.set(id, addresses);

      for (let address of addresses) {
        let previous = counts.get(address);
        let count = previous ? previous + 1 : 1;
        counts.set(address, count);
      }
    };

    let needsFetch: string[] = [];
    await this.fetchSentMessages_(async (message) => {
      let id = defined(message.id);
      let addresses = cache.get(id);
      if (addresses) processAddresses(id, addresses);
      else needsFetch.push(id);
    });

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

    await IDBKeyVal.getDefault().set(MESSAGE_TO_EMAILS_STORAGE_KEY, JSON.stringify([...newCache]));

    // Store the final contacts object instead of the data fetched off the
    // network since the latter is order of magnitude larger and can exceed
    // the allowed localStorage quota.
    await IDBKeyVal.getDefault().set(SEND_COUNT_STORAGE_KEY, JSON.stringify([...counts]));

    return counts;
  }
}
