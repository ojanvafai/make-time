import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {assert, defined, Labels} from './Base.js';
import {firestoreUserCollection} from './BaseMain.js';
import {QueueSettings} from './QueueSettings.js';
import {ServerStorage, StorageUpdates} from './ServerStorage.js';

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

export class FiltersChangedEvent extends Event {
  static NAME = 'filters-changed';
  constructor() {
    super(FiltersChangedEvent.NAME);
  }
}

export class Settings extends EventTarget {
  private filters_?: firebase.firestore.DocumentSnapshot;
  private queueSettings_?: QueueSettings;

  static FILTERS_RULE_DIRECTIVES =
      ['to', 'from', 'subject', 'plaintext', 'htmlcontent', 'header'];
  private static FILTER_RULE_FIELDS_ = ['label'].concat(
      Settings.FILTERS_RULE_DIRECTIVES, 'matchallmessages', 'nolistid', 'nocc');

  static fields = [
    {
      key: ServerStorage.KEYS.VACATION,
      name: 'Vacation',
      description:
          `Label to show when on vacation so you can have peace of mind by seeing only urgent mail.`,
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

  constructor(private storage_: ServerStorage) {
    super();
  }

  has(setting: string) {
    let value = this.storage_.get(setting);
    return value !== undefined;
  }

  getNonDefault(setting: string) {
    return this.storage_.get(setting);
    ;
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

  async fetch() {
    this.queueSettings_ = new QueueSettings(this.storage_);
    await this.queueSettings_.fetch();
  }

  getQueueSettings() {
    return defined(this.queueSettings_);
  }

  getFiltersDocument_() {
    return firestoreUserCollection().doc('filters');
  }

  filtersObject_(rules: FilterRule[]) {
    return {
      filters: rules,
    }
  }

  async getFilters() {
    if (!this.filters_) {
      let doc = this.getFiltersDocument_();
      this.filters_ = await doc.get();

      if (!this.filters_.exists) {
        await doc.set(this.filtersObject_([]));
        this.filters_ = await doc.get();
      }

      doc.onSnapshot((snapshot) => {
        this.filters_ = snapshot;
        this.dispatchEvent(new FiltersChangedEvent());
      });
    }

    return this.filters_.get(FILTERS_KEY);
  }

  async writeFilters(rules: FilterRule[]) {
    for (let rule of rules) {
      let invalidField = Object.keys(rule).find(
          x => !Settings.FILTER_RULE_FIELDS_.includes(x));
      assert(!invalidField && rule.label !== '');
    }
    this.getFiltersDocument_().update(this.filtersObject_(rules));
  }

  async getLabels() {
    let filters = await this.getFilters();
    let labels: Set<string> = new Set();
    for (let rule of filters) {
      labels.add(defined(rule.label));
    }
    labels.add(Labels.Fallback);
    return labels;
  }
}
