import type * as firebase from 'firebase/app';

import { deepEqual } from './Base.js';
import { firestore, currentUserId, firestoreUserCollection } from './BaseMain.js';
import { EventTargetPolyfill } from './EventTargetPolyfill.js';

export interface StorageUpdates {
  [property: string]: any;
}

export const ServerStorageUpdateEventName = 'server-storage-update';
export class PushLabelsToGmailUpdateEventName extends Event {
  static NAME = 'push-labels-to-gmail-update';
  constructor() {
    super(PushLabelsToGmailUpdateEventName.NAME);
  }
}

const SERVER_STORAGE_DOC_NAME = 'ServerStorage';

export class ServerStorage extends EventTargetPolyfill {
  private data_?: firebase.firestore.DocumentSnapshot;
  static KEYS: KeyTypes;

  constructor() {
    super();
  }

  // TODO: Rename to init.
  async fetch() {
    if (this.data_) return;

    let doc = this.getDocument_();
    this.data_ = await doc.get();

    if (!this.data_.exists) {
      // TODO: Remove legacy support once everyone is migrated as well as the security.rules bits.
      const legacyDoc = firestore().collection('users').doc(currentUserId());
      this.data_ = await legacyDoc.get();
      if (this.data_.exists) {
        doc.set(this.data_.data()!);
      } else {
        await doc.set({});
        this.data_ = await doc.get();
      }
    }

    doc.onSnapshot((snapshot) => {
      let oldData = this.data_;
      this.data_ = snapshot;
      if (!oldData) return;

      if (
        !deepEqual(
          oldData.get(keys.PUSH_LABELS_TO_GMAIL),
          this.data_.get(keys.PUSH_LABELS_TO_GMAIL),
        )
      ) {
        this.dispatchEvent(new PushLabelsToGmailUpdateEventName());
      }

      for (let key of KEYS_TO_DISPATCH_UPDATE_EVENT) {
        if (!deepEqual(oldData.get(key), this.data_.get(key))) {
          this.dispatchEvent(new Event(ServerStorageUpdateEventName));
          return;
        }
      }
    });
  }

  getDocument_() {
    return firestoreUserCollection().doc(SERVER_STORAGE_DOC_NAME);
  }

  get(key: string) {
    if (!this.data_) {
      throw `Attempted to read out of storage before fetching from the network: ${key}.`;
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
  LAST_DETHROTTLE_TIME: string;
  THEME: string;
  PUSH_LABELS_TO_GMAIL: string;
  UNTRIAGED_SUMMARY: string;
  PRIORITY_INBOX: string;
  VACATION: string;
  TIMER_DURATION: string;
  THROTTLE_DURATION: string;
  ALLOWED_PIN_COUNT: string;
  ALLOWED_MUST_DO_COUNT: string;
  ALLOWED_URGENT_COUNT: string;
  PIN_CADENCE: string;
  BOOKMARK_CADENCE: string;
  MUST_DO_CADENCE: string;
  URGENT_CADENCE: string;
  BACKLOG_CADENCE: string;
  LOCAL_OFFICES: string;
  LOG_MATCHING_RULES: string;
  REDACT_MESSAGES: string;
  TRACK_LONG_TASKS: string;
  QUEUES: string;
  CALENDAR_SORT: string;
}

let keys: KeyTypes = {
  HAS_SHOWN_FIRST_RUN: 'has_shown_first_run',
  LAST_DEQUEUE_TIME: 'Last dequeue time',
  LAST_DETHROTTLE_TIME: 'last_dethrottle_time',
  THEME: 'theme',
  PUSH_LABELS_TO_GMAIL: 'push_labels_to_gmail',
  UNTRIAGED_SUMMARY: 'untriaged_summary',
  PRIORITY_INBOX: 'priority_inbox',
  VACATION: 'vacation',
  TIMER_DURATION: 'timeout',
  THROTTLE_DURATION: 'throttle_duration',
  ALLOWED_PIN_COUNT: 'allowed_pin_count',
  ALLOWED_MUST_DO_COUNT: 'allowed_must_do_count',
  ALLOWED_URGENT_COUNT: 'allowed_urgent_count',
  PIN_CADENCE: 'pin_cadence',
  BOOKMARK_CADENCE: 'bookmark_cadence',
  MUST_DO_CADENCE: 'must_do_cadence',
  URGENT_CADENCE: 'urgent_cadence',
  BACKLOG_CADENCE: 'backlog_cadence',
  LOCAL_OFFICES: 'local_offices',
  LOG_MATCHING_RULES: 'log_matching_rules',
  REDACT_MESSAGES: 'redact_messages',
  TRACK_LONG_TASKS: 'track_long_tasks',
  QUEUES: 'queues',
  CALENDAR_SORT: 'calendar_sort',
};

// TODO: Setup a proper listening system for each key and make that the only
// way to get at the key's value so callers are forced to handle updates.
let KEYS_TO_DISPATCH_UPDATE_EVENT = [
  keys.THEME,
  keys.PRIORITY_INBOX,
  keys.VACATION,
  keys.TIMER_DURATION,
  keys.THROTTLE_DURATION,
  keys.ALLOWED_PIN_COUNT,
  keys.ALLOWED_MUST_DO_COUNT,
  keys.ALLOWED_URGENT_COUNT,
  keys.PIN_CADENCE,
  keys.BOOKMARK_CADENCE,
  keys.MUST_DO_CADENCE,
  keys.URGENT_CADENCE,
  keys.BACKLOG_CADENCE,
  keys.LOCAL_OFFICES,
  keys.LOG_MATCHING_RULES,
  keys.REDACT_MESSAGES,
  keys.TRACK_LONG_TASKS,
  keys.QUEUES,
  keys.CALENDAR_SORT,
];

// List of allowed keys.
ServerStorage.KEYS = keys;
