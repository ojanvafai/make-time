import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {AsyncOnce} from './AsyncOnce.js';
import {assert, defined, notNull} from './Base.js';
import {firebaseAuth, firestore} from './BaseMain.js';
import {ServerStorage, StorageUpdates} from './ServerStorage.js';
import {SpreadsheetUtils} from './SpreadsheetUtils.js';

export interface HeaderFilterRule {
  name: string;
  value: string;
}

export interface FilterRule {
  label: string;
  matchallmessages?: boolean;
  nolistid?: boolean;
  nocc?: boolean;
  to?: string;
  from?: string;
  subject?: string;
  plaintext?: string;
  htmlcontent?: string;
  header?: HeaderFilterRule[];
}

export const HEADER_FILTER_PREFIX = '$';

export function isHeaderFilterField(fieldName: string) {
  return fieldName.indexOf(HEADER_FILTER_PREFIX) == 0;
}

// TODO: Is there a less verbose way to do this while still having strict
// typing?
export function setFilterStringField(
    rule: FilterRule, name: string, value: string) {
  switch (name) {
    case 'label':
      rule.label = value;
      break;

    case 'to':
      rule.to = value;
      break;

    case 'from':
      rule.from = value;
      break;

    case 'subject':
      rule.subject = value;
      break;

    case 'plaintext':
      rule.plaintext = value;
      break;

    case 'htmlcontent':
      rule.htmlcontent = value;
      break;

    default:
      return false;
  }
  return true;
}

let FILTERS_KEY = 'filters';

export class Settings {
  private fetcher_: AsyncOnce<void>;
  spreadsheetId!: string;
  // TODO: Pass this in as a constructor argument and remove the assert !.
  private storage_!: ServerStorage;
  private filters_?: firebase.firestore.DocumentSnapshot;

  private static FILTERS_SHEET_NAME_ = 'filters';
  static FILTERS_RULE_DIRECTIVES =
      ['to', 'from', 'subject', 'plaintext', 'htmlcontent', 'header'];
  private static FILTER_RULE_FIELDS_ = ['label'].concat(
      Settings.FILTERS_RULE_DIRECTIVES, 'matchallmessages', 'nolistid', 'nocc');

  static fields = [
    {
      key: ServerStorage.KEYS.VACATION,
      name: 'Vacation',
      description:
          `Queue name to show when on vacation so you can have peace of mind by seeing only urgent mail. Cannot be a Best Effort queue.`,
    },
    {
      key: ServerStorage.KEYS.TIMER_DURATION,
      name: 'Triage countdown timer',
      description:
          `Number of seconds to triage a single thread. When the timeout is hit, you are forced to take a triage action.`,
      default: 60,
      type: 'number',
    },
    {
      key: ServerStorage.KEYS.AUTO_START_TIMER,
      name: 'Auto start timer',
      description:
          `Timer automatically starts after triaging the first thread.`,
      default: true,
      type: 'checkbox',
    },
    {
      key: ServerStorage.KEYS.ALLOWED_REPLY_LENGTH,
      name: 'Allowed quick reply length',
      description:
          `Allowed length of quick replies. Longer messages will refuse to send.`,
      default: 280,
      type: 'number',
    },
    {
      key: ServerStorage.KEYS.DAYS_TO_SHOW,
      name: 'Wicked witch count',
      description:
          `For times when you're melting, only show emails from the past N days.`,
      type: 'number',
    },
    {
      key: ServerStorage.KEYS.LOG_MATCHING_RULES,
      name: 'Log matching rules',
      description:
          `Log the matching filter rule to the chrome developer console.`,
      default: false,
      type: 'checkbox',
    },
    {
      key: ServerStorage.KEYS.TRACK_LONG_TASKS,
      name: 'Visualize jank',
      description: `Flash the screen red whenever make-time is frozen.`,
      default: false,
      type: 'checkbox',
    },
  ];

  constructor() {
    this.fetcher_ = new AsyncOnce<void>(this.fetch_.bind(this));
  }

  async fetch() {
    await this.fetcher_.do();
  }

  async fetch_() {
    this.spreadsheetId = await this.getSpreadsheetId_();
  }

  setStorage(storage: ServerStorage) {
    this.storage_ = storage;
  }

  async getSpreadsheetId_() {
    let response = await gapi.client.drive.files.list({
      q: 'trashed=false and name=\'make-time backend (do not rename!)\'',
      spaces: 'drive',
    });

    if (!response || !response.result || !response.result.files)
      throw `Couldn't fetch settings spreadsheet.`;

    assert(response.result.files.length);
    let id = response.result.files[0].id;
    return assert(id, 'Fetched spreadsheet file, but has no spreadsheetId');
  }

  has(setting: string) {
    let value = this.storage_.get(setting);
    return value !== undefined;
  }

  getNonDefault(setting: string) {
    return this.storage_.get(setting);;
  }

  get(setting: string) {
    let value = this.storage_.get(setting);
    if (value === null || value === undefined)
      return this.defaultValue_(setting);
    return value;
  }

  async writeUpdates(updates: StorageUpdates) {
    await this.storage_.writeUpdates(updates);
  }

  defaultValue_(setting: string) {
    for (let field of Settings.fields) {
      if (field.key == setting)
        return field.default;
    }
    throw `No such setting: ${setting}`;
  }

  getFiltersDocument_() {
    let db = firestore();
    let uid = notNull(firebaseAuth().currentUser).uid;
    return db.collection(uid).doc('filters');
  }

  filtersObject_(rules: FilterRule[]) {
    return {
      filters: rules,
    }
  }

  async getFilters() {
    if (!this.filters_) {
      let doc = this.getFiltersDocument_();
      doc.onSnapshot((snapshot) => {
        this.filters_ = snapshot;
      });
      this.filters_ = await doc.get();

      if (!this.filters_.exists) {
        // TODO: Delete this one all users are migrated to firestore.
        let spreadsheetData = await this.fetchSpreadsheetValues_();
        await doc.set(this.filtersObject_(spreadsheetData));
        this.filters_ = await doc.get();
      }
    }

    return this.filters_.get(FILTERS_KEY);
  }

  async fetchSpreadsheetValues_() {
    let rawRules = await SpreadsheetUtils.fetchSheet(
        this.spreadsheetId, Settings.FILTERS_SHEET_NAME_);
    let filters = [];
    let ruleNames = rawRules[0];

    for (let i = 1, l = rawRules.length; i < l; i++) {
      let ruleObj: FilterRule = {label: ''};
      for (let j = 0; j < ruleNames.length; j++) {
        let rawName = defined(ruleNames[j]);
        let name = String(rawName).toLowerCase();
        let value = rawRules[i][j];

        if (!value)
          continue;

        value = String(value).toLowerCase().trim();

        switch (name) {
          case 'header':
            let headers: HeaderFilterRule[];
            try {
              headers = JSON.parse(value);
            } catch (e) {
              // TODO: Remove all this once all clients have migrated over to $
              // syntax.
              let colonIndex = value.indexOf(':');
              assert(colonIndex !== -1);
              headers = [{
                name: value.substring(0, colonIndex).trim(),
                value: value.substring(colonIndex + 1).toLowerCase().trim(),
              }];
            }

            // For historical reasons this is called header instead of headers.
            // TODO: Change this once we're on a proper storage system and doing
            // so will be easier.
            ruleObj.header = headers;
            break;

          case 'matchallmessages':
            ruleObj.matchallmessages = value === 'true';
            break;

          case 'nolistid':
            ruleObj.nolistid = value === 'true';
            break;

          case 'nocc':
            ruleObj.nocc = value === 'true';
            break;

          default:
            let validField = setFilterStringField(ruleObj, name, value);
            assert(validField);
        }
      }

      if (ruleObj.label === '') {
        console.warn(`There's filter with no label:`, ruleObj);
        // Give it a fallback label. This shouldn't ever happen, but if we have
        // a bug such that it does at least prevent the rule from being totally
        // ignored and discarded.
        ruleObj.label = 'nolabel';
      }

      filters.push(ruleObj);
    }
    return filters;
  }

  async writeFilters(rules: FilterRule[]) {
    for (let rule of rules) {
      let invalidField = Object.keys(rule).find(
          x => !Settings.FILTER_RULE_FIELDS_.includes(x));
      assert(!invalidField && rule.label !== '');
    }
    this.getFiltersDocument_().update(this.filtersObject_(rules));
  }
}
