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
    doc.onSnapshot((snapshot) => {
      this.data_ = snapshot;
      this.dispatchEvent(new Event(ServerStorageUpdateEventName));
    });
    this.data_ = await doc.get();

    if (!this.data_.exists) {
      await doc.set({});
      this.data_ = await doc.get();
    }
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
  VACATION: string;
  TIMER_DURATION: string;
  AUTO_START_TIMER: string;
  ALLOWED_REPLY_LENGTH: string;
  DAYS_TO_SHOW: string;
  LOG_MATCHING_RULES: string;
  TRACK_LONG_TASKS: string;
  QUEUES: string;
}

let keys: KeyTypes = {
  HAS_SHOWN_FIRST_RUN: 'has_shown_first_run',
  LAST_DEQUEUE_TIME: 'Last dequeue time',
  VACATION: 'vacation',
  TIMER_DURATION: 'timeout',
  AUTO_START_TIMER: 'auto_start_timer',
  ALLOWED_REPLY_LENGTH: 'allowed_reply_length',
  DAYS_TO_SHOW: 'days_to_show',
  LOG_MATCHING_RULES: 'log_matching_rules',
  TRACK_LONG_TASKS: 'track_long_tasks',
  QUEUES: 'queues',
};

// List of allowed keys.
ServerStorage.KEYS = keys;
