import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {AsyncOnce} from './AsyncOnce.js';
import {assert, defined} from './Base.js';
import {firestoreUserCollection} from './BaseMain.js';
import {AllCalendarSortDatas, CALENDAR_ALLOWED_COLORS, CalendarSortListEntry, DEFAULT_CALENDAR_DATA, EventType, UNBOOKED_TYPES} from './calendar/Constants.js';
import {QueueNames} from './QueueNames.js';
import {QueueSettings} from './QueueSettings.js';
import {ServerStorage, StorageUpdates} from './ServerStorage.js';
import {THEMES} from './Themes.js';

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

export enum Frequency {
  Either,
  Recurring,
  NotRecurring,
}

export enum AttendeeCount {
  Any,
  None,
  One,
  Many,
}

export interface CalendarRule {
  label: string;
  title: string;
  attendees: AttendeeCount;
  frequency: Frequency;
}

export interface Filters {
  filters?: FilterRule[], calendar?: CalendarRule[],
}

export interface Setting {
  key: string;
  name: string;
  description: string|HTMLElement;
  values?: string[];
  type?: string;
  min?: number;
  max?: number;
  default?: any;
}

export const ANY_TITLE = '<any>';

// TODO: Settings shouldn't have all this calendar specific knowledge.
export let BuiltInRules: CalendarRule[] = [
  {
    label: EventType.OutOfOffice,
    title: 'regexp:.*(OOO|Holiday|Out of office).*',
    attendees: AttendeeCount.None,
    frequency: Frequency.Either,
  },
  {
    label: EventType.Interview,
    title: 'Interview',
    attendees: AttendeeCount.None,
    frequency: Frequency.Either,
  },
  {
    label: EventType.Email,
    title: 'Email',
    attendees: AttendeeCount.None,
    frequency: Frequency.Either,
  },
  {
    label: EventType.FocusRecurring,
    title: ANY_TITLE,
    attendees: AttendeeCount.None,
    frequency: Frequency.Recurring,
  },
  {
    label: EventType.FocusNonRecurring,
    title: ANY_TITLE,
    attendees: AttendeeCount.None,
    frequency: Frequency.NotRecurring,
  },
  {
    label: EventType.OneOnOneRecurring,
    title: ANY_TITLE,
    attendees: AttendeeCount.One,
    frequency: Frequency.Recurring,
  },
  {
    label: EventType.OneOnOneNonRecurring,
    title: ANY_TITLE,
    attendees: AttendeeCount.One,
    frequency: Frequency.NotRecurring,
  },
  {
    label: EventType.MeetingRecurring,
    title: ANY_TITLE,
    attendees: AttendeeCount.Many,
    frequency: Frequency.Recurring,
  },
  {
    label: EventType.MeetingNonRecurring,
    title: ANY_TITLE,
    attendees: AttendeeCount.Many,
    frequency: Frequency.NotRecurring,
  },
];

export const REGEXP_PREFIX = 'regexp:';
export const HEADER_FILTER_PREFIX = '$';
const FILTERS_KEY = 'filters';
const CALENDAR_FILTERS_KEY = 'calendar';

export function isHeaderFilterField(fieldName: string) {
  return fieldName.indexOf(HEADER_FILTER_PREFIX) == 0;
}

export function stringFilterMatches(ruleText: string, value: string) {
  let re = ruleRegexp(ruleText);
  if (re) {
    return re.test(value);
  } else {
    return value.toLowerCase().includes(ruleText.toLowerCase());
  }
}

export function ruleRegexp(ruleText: string) {
  if (ruleText.startsWith(REGEXP_PREFIX)) {
    let reText = ruleText.replace(REGEXP_PREFIX, '');
    return new RegExp(reText, 'mi');
  }
  return null;
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

export function setCalendarFilterStringField(
    rule: CalendarRule, name: string, value: string) {
  switch (name) {
    case 'label':
      rule.label = value;
      break;

    case 'title':
      rule.title = value;
      break;

    default:
      return false;
  }
  return true;
}

export class FiltersChangedEvent extends Event {
  static NAME = 'filters-changed';
  constructor() {
    super(FiltersChangedEvent.NAME);
  }
}

export class Settings extends EventTarget {
  private filters_?: firebase.firestore.DocumentSnapshot;
  private queueSettings_?: QueueSettings;
  private labelSelect_?: HTMLSelectElement;
  private labelSelectCreator_?: AsyncOnce<HTMLSelectElement>;

  static CALENDAR_RULE_DIRECTIVES = ['title'];
  private static CALENDAR_RULE_FIELDS_ = ['label'].concat(
      Settings.CALENDAR_RULE_DIRECTIVES, 'frequency', 'attendees');
  static FILTERS_RULE_DIRECTIVES =
      ['to', 'from', 'subject', 'plaintext', 'htmlcontent', 'header'];
  private static FILTER_RULE_FIELDS_ = ['label'].concat(
      Settings.FILTERS_RULE_DIRECTIVES, 'matchallmessages', 'nolistid', 'nocc');

  static SINGLE_GROUP = 'Group important threads';
  static IGNORE_IMPORTANCE = 'Ignore importance';

  static fields = [
    {
      key: ServerStorage.KEYS.THEME,
      name: 'Theme',
      description: `Set a theme.`,
      values: THEMES.map(x => x.name),
    },
    {
      key: ServerStorage.KEYS.PRIORITY_INBOX,
      name: 'Priority inbox',
      description: `Configure how important messages are grouped.`,
      values: [Settings.SINGLE_GROUP, Settings.IGNORE_IMPORTANCE],
      default: Settings.IGNORE_IMPORTANCE,
    },
    {
      key: ServerStorage.KEYS.BACKGROUND,
      name: 'Background',
      description:
          `Override the theme's background. Can be any CSS background including "url(image-url-here)".`,
    },
    {
      key: ServerStorage.KEYS.VACATION,
      name: 'Vacation',
      description:
          `Label to show when on vacation so you can have peace of mind by seeing only urgent mail.`,
    },
    {
      key: ServerStorage.KEYS.THROTTLE_DURATION,
      name: 'Untriaged frequency',
      description:
          `How frequently, in hours, to show untriaged threads in throttled queues.`,
      default: 2,
      type: 'number',
    },
    {
      key: ServerStorage.KEYS.TIMER_DURATION,
      name: 'Triage countdown timer',
      description:
          `Number of seconds to triage a single thread. When the timeout is hit, you are forced to take a triage action.`,
      default: 120,
      type: 'number',
    },
    {
      key: ServerStorage.KEYS.ALLOWED_PIN_COUNT,
      name: 'Allowed pins',
      description:
          `Number of threads that can be marked pinned. Use 0 for no limit.`,
      default: 3,
      type: 'number',
    },
    {
      key: ServerStorage.KEYS.ALLOWED_MUST_DO_COUNT,
      name: 'Allowed must dos',
      description:
          `Number of threads that can be marked must do. Use 0 for no limit.`,
      default: 9,
      type: 'number',
    },
    {
      key: ServerStorage.KEYS.ALLOWED_URGENT_COUNT,
      name: 'Allowed urgents',
      description:
          `Number of threads that can be marked urgent. Use 0 for no limit.`,
      default: 27,
      type: 'number',
    },
    {
      key: ServerStorage.KEYS.LOCAL_OFFICES,
      name: 'Local offices',
      description:
          `Comma separated list of offices to user when finding rooms that are missing a local conference room (substring matched).`,
      type: 'string',
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

  // TODO: Extract this out of Settings.
  async getCalendarSortData(useDefaults?: boolean) {
    let labels = Array.from(await this.getCalendarLabels()).sort();

    let allData: AllCalendarSortDatas =
        this.storage_.get(ServerStorage.KEYS.CALENDAR_SORT);

    let calendarSortListEntries: CalendarSortListEntry[] = labels.map(x => {
      let data =
          useDefaults || !allData ? DEFAULT_CALENDAR_DATA[x] : allData[x];
      let color = data ? data.color : CALENDAR_ALLOWED_COLORS.Red;
      let index = data ? data.index : 0;
      let eventType = x as EventType;
      return {label: eventType, data: {color: color, index: index}};
    });

    calendarSortListEntries.sort(
        (a: CalendarSortListEntry, b: CalendarSortListEntry) => {
          let aIndex = a.data.index;
          let bIndex = b.data.index;

          // If they have the same index, sort lexicographically.
          if (aIndex == bIndex) {
            if (a.label < b.label)
              return -1;
            else if (a.label > b.label)
              return 1;
            return 0
          }

          return aIndex - bIndex;
        });

    return calendarSortListEntries;
  }

  getFiltersDocument_() {
    return firestoreUserCollection().doc('filters');
  }

  filtersObject_(rules?: FilterRule[], calendarRules?: CalendarRule[]) {
    let obj: Filters = {};
    if (rules)
      obj[FILTERS_KEY] = rules;
    if (calendarRules)
      obj[CALENDAR_FILTERS_KEY] = calendarRules;
    return obj;
  }

  async filtersData_() {
    if (!this.filters_) {
      let doc = this.getFiltersDocument_();
      this.filters_ = await doc.get();

      if (!this.filters_.exists) {
        await doc.set(this.filtersObject_([], []));
        this.filters_ = await doc.get();
      }

      doc.onSnapshot((snapshot) => {
        this.filters_ = snapshot;
        this.dispatchEvent(new FiltersChangedEvent());
      });
    }
    return this.filters_;
  }

  async getFilters() {
    let filtersData = await this.filtersData_();
    return filtersData.get(FILTERS_KEY) || [];
  }

  async getCalendarFilters() {
    let filtersData = await this.filtersData_();
    return filtersData.get(CALENDAR_FILTERS_KEY) || [];
  }

  async writeCalendarFilters(rules: CalendarRule[]) {
    for (let rule of rules) {
      let invalidField = Object.keys(rule).find(
          x => !Settings.CALENDAR_RULE_FIELDS_.includes(x));
      assert(!invalidField && rule.label !== '');
    }
    this.getFiltersDocument_().update(this.filtersObject_(undefined, rules));
  }

  async writeFilters(rules: FilterRule[]) {
    for (let rule of rules) {
      let invalidField = Object.keys(rule).find(
          x => !Settings.FILTER_RULE_FIELDS_.includes(x));
      assert(!invalidField && rule.label !== '');
    }
    this.getFiltersDocument_().update(this.filtersObject_(rules));
  }

  async getCalendarLabels() {
    let filters = await this.getCalendarFilters();
    let labels: Set<string> =
        new Set([...BuiltInRules.map(x => x.label), ...UNBOOKED_TYPES]);
    for (let rule of filters) {
      labels.add(defined(rule.label));
    }
    return labels;
  }

  async getLabelSelectTemplate() {
    if (!this.labelSelectCreator_) {
      this.labelSelectCreator_ = new AsyncOnce(async () => {
        this.labelSelect_ = document.createElement('select');
        let queueNames = QueueNames.create();
        let labels = await queueNames.getAllNames(true);
        labels.sort();
        for (let label of labels) {
          let option = document.createElement('option');
          option.append(label);
          this.labelSelect_.append(option);
        }
        return this.labelSelect_;
      });
    }
    return await this.labelSelectCreator_.do();
  }

  async getLabelSelect() {
    return (await this.getLabelSelectTemplate()).cloneNode(true) as
        HTMLSelectElement;
  }

  addLabel(label: string) {
    let option = document.createElement('option');
    option.append(label);
    let select = assert(this.labelSelect_);
    select.prepend(option.cloneNode(true));
    return option;
  }
}
