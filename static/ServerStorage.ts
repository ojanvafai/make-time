import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {notNull} from './Base.js';
import {firebaseAuth, firestore} from './BaseMain.js';

export interface StorageUpdates {
  [property: string]: any;
}

export const ServerStorageUpdateEventName = 'server-storage-update';

export class ServerStorage extends EventTarget {
  private data_?: firebase.firestore.DocumentSnapshot;
  static KEYS: KeyTypes;

  constructor() {
    super();
  }

  // TODO: Rename to init.
  async fetch() {
    if (this.data_)
      return;

    let doc = this.getDocument_();
    this.data_ = await doc.get();

    if (!this.data_.exists) {
      await doc.set({});
      this.data_ = await doc.get();
    }

    doc.onSnapshot((snapshot) => {
      let oldData = this.data_;
      this.data_ = snapshot;
      if (!oldData)
        return;

      for (let key of KEYS_TO_DISPATCH_UPDATE_EVENT) {
        if (JSON.stringify(oldData.get(key)) !==
            JSON.stringify(this.data_.get(key))) {
          this.dispatchEvent(new Event(ServerStorageUpdateEventName));
          return;
        }
      }
    });
  }

  getDocument_() {
    let db = firestore();
    let uid = notNull(firebaseAuth().currentUser).uid;
    // TODO: Migrate this over to db.collection(uid).doc('user') so all the data
    // for this user can be under a single collection, which will allow us to
    // query all the data for example. It also means we don't need to add a new
    // security rule for each new document we want to add for a user.
    // When doing this, update firestore.rules to remove the users collection.
    return db.collection('users').doc(uid);
  }

  get(key: string) {
    if (!this.data_) {
      throw `Attempted to read out of storage before fetching from the network: ${
          key}.`;
    }
    return this.data_.get(key);
  }

  async writeUpdates(updates: StorageUpdates) {
    let doc = this.getDocument_();
    await doc.update(updates);
  }
}

interface KeyTypes {
  HAS_SHOWN_FIRST_RUN: string;
  LAST_DEQUEUE_TIME: string;
  BACKGROUND: string;
  VACATION: string;
  TIMER_DURATION: string;
  ALLOWED_PIN_COUNT: string;
  ALLOWED_MUST_DO_COUNT: string;
  ALLOWED_URGENT_COUNT: string;
  LOCAL_OFFICES: string;
  LOG_MATCHING_RULES: string;
  TRACK_LONG_TASKS: string;
  QUEUES: string;
  CALENDAR_SORT: string;
}

let keys: KeyTypes = {
  HAS_SHOWN_FIRST_RUN: 'has_shown_first_run',
  LAST_DEQUEUE_TIME: 'Last dequeue time',
  BACKGROUND: 'background',
  VACATION: 'vacation',
  TIMER_DURATION: 'timeout',
  ALLOWED_PIN_COUNT: 'allowed_pin_count',
  ALLOWED_MUST_DO_COUNT: 'allowed_must_do_count',
  ALLOWED_URGENT_COUNT: 'allowed_urgent_count',
  LOCAL_OFFICES: 'local_offices',
  LOG_MATCHING_RULES: 'log_matching_rules',
  TRACK_LONG_TASKS: 'track_long_tasks',
  QUEUES: 'queues',
  CALENDAR_SORT: 'calendar_sort',
};

// TODO: Setup a proper listening system for each key and make that the only way
// to get at the key's value so callers are forced to handle updates.
let KEYS_TO_DISPATCH_UPDATE_EVENT = [
  keys.BACKGROUND,
  keys.VACATION,
  keys.TIMER_DURATION,
  keys.ALLOWED_PIN_COUNT,
  keys.ALLOWED_MUST_DO_COUNT,
  keys.ALLOWED_URGENT_COUNT,
  keys.LOCAL_OFFICES,
  keys.LOG_MATCHING_RULES,
  keys.TRACK_LONG_TASKS,
  keys.QUEUES,
  keys.CALENDAR_SORT,
];

// List of allowed keys.
ServerStorage.KEYS = keys;
