import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {notNull} from './Base.js';
import {firebaseAuth, firestore} from './BaseMain.js';
import {SpreadsheetUtils} from './SpreadsheetUtils.js';

export interface StorageUpdates {
  [property: string]: any;
}

export const ServerStorageUpdateEventName = 'server-storage-update';

export class ServerStorage extends EventTarget {
  private static data_: firebase.firestore.DocumentSnapshot;
  static BACKEND_SHEET_NAME_: string;
  static KEYS: KeyTypes;

  constructor(public spreadsheetId: string) {
    super();
  }

  // TODO: Rename to init.
  async fetch() {
    if (ServerStorage.data_)
      return;

    let doc = this.getDocument_();
    doc.onSnapshot((snapshot) => {
      ServerStorage.data_ = snapshot;
      this.dispatchEvent(new Event(ServerStorageUpdateEventName));
    });
    ServerStorage.data_ = await doc.get();

    if (!ServerStorage.data_.exists) {
      // TODO: Delete this one all users are migrated to firestore.
      let spreadsheetData = await this.fetchSpreadsheetValues_();
      await doc.set(spreadsheetData || {});
      ServerStorage.data_ = await doc.get();
    }
  }

  private async fetchSpreadsheetValues_() {
    const rawBackendValues = await SpreadsheetUtils.fetch2ColumnSheet(
        this.spreadsheetId, ServerStorage.BACKEND_SHEET_NAME_);

    let values: any = {};
    // Strip no longer supported backend keys.
    for (let key of Object.values(ServerStorage.KEYS)) {
      let value = rawBackendValues[key];
      // TODO: Remove the string check once clients have updated to not have
      // stray undefineds in their settings.
      if (value === 'undefined') {
        value = '';
      }
      if (value !== undefined)
        values[key] = value;
    }
    return values;
  }

  getDocument_() {
    let db = firestore();
    let uid = notNull(firebaseAuth().currentUser).uid;
    return db.collection('users').doc(uid);
  }

  get(key: string) {
    if (!ServerStorage.data_) {
      throw `Attempted to read out of storage before fetching from the network: ${
          key}.`;
    }
    return ServerStorage.data_.get(key);
  }

  async writeUpdates(updates: StorageUpdates) {
    let doc = this.getDocument_();
    doc.update(updates);
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

// List of keys stored in the backend sheet.
ServerStorage.KEYS = keys;

ServerStorage.BACKEND_SHEET_NAME_ = 'backend-do-not-modify';
