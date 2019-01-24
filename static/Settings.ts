import {AsyncOnce} from './AsyncOnce.js';
import {assert, defined, notNull, showDialog} from './Base.js';
import {ErrorLogger} from './ErrorLogger.js';
import {ServerStorage, StorageUpdate} from './ServerStorage.js';
import {SpreadsheetUtils} from './SpreadsheetUtils.js';

export interface HeaderFilterRule {
  name: string;
  value: string;
}

export interface FilterRule {
  label: string;
  matchallmessages?: string;
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
export function setFilterField(rule: FilterRule, name: string, value: string) {
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

    case 'matchallmessages':
      rule.matchallmessages = value;
      break;

    default:
      return false;
  }
  return true;
}

export function getFilterField(rule: FilterRule, name: string): string|boolean|
    undefined {
  switch (name) {
    case 'label':
      return rule.label;

    case 'to':
      return rule.to;

    case 'from':
      return rule.from;

    case 'subject':
      return rule.subject

      case 'plaintext': return rule.plaintext

      case 'htmlcontent': return rule.htmlcontent

      case 'matchallmessages': return rule.matchallmessages;

    case 'nolistid':
      return rule.nolistid;

    case 'nocc':
      return rule.nocc;

    default:
      // Throw instead of asserting here so that TypeScript knows that this
      // function never returns undefined.
      throw new Error('This should never happen.');
  }
}

export class Settings {
  private fetcher_: AsyncOnce<void>;
  // TODO: Fix these to not assert non-null since they could realistically be
  // null if fetch() isn't completed.
  spreadsheetId!: string;
  private storage_!: ServerStorage;
  private filters_: FilterRule[]|null;

  static QUEUED_LABELS_SHEET_NAME = 'queued_labels';
  static QUEUED_LABELS_SHEET_COLUMNS = ['label', 'queue', 'goal', 'index'];
  static FILTERS_SHEET_NAME_ = 'filters';
  static FILTERS_RULE_DIRECTIVES =
      ['to', 'from', 'subject', 'plaintext', 'htmlcontent', 'header'];
  static FILTERS_SHEET_COLUMNS_ = ['label'].concat(
      Settings.FILTERS_RULE_DIRECTIVES, 'matchallmessages', 'nolistid', 'nocc');

  static sheetData_ = [
    {
      name: Settings.FILTERS_SHEET_NAME_,
      initialData: [Settings.FILTERS_SHEET_COLUMNS_],
    },
    {
      name: Settings.QUEUED_LABELS_SHEET_NAME,
      initialData: [Settings.QUEUED_LABELS_SHEET_COLUMNS],
    },
    {
      name: 'statistics',
      initialData: [[
        'timestamp', 'num_threads_labelled', 'total_time', 'per_label_counts'
      ]],
    },
    {
      name: 'daily_stats',
      initialData: [[
        'date', 'total_threads', 'archived_threads_count',
        'non_archived_threads_count', 'immediate_count', 'daily_count',
        'weekly_count', 'monthly_count', 'num_invocations',
        'total_running_time', 'min_running_time', 'max_running_time'
      ]],
    },
    {
      name: 'backend-do-not-modify',
    },
  ];

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
    this.filters_ = null;
  }

  async fetch() {
    await this.fetcher_.do();
  }

  async fetch_() {
    this.spreadsheetId = await this.getSpreadsheetId_();
    this.storage_ = new ServerStorage(this.spreadsheetId);
    await this.storage_.fetch();
  }

  async getSpreadsheetId_() {
    let response = await gapi.client.drive.files.list({
      q: 'trashed=false and name=\'make-time backend (do not rename!)\'',
      spaces: 'drive',
    });

    if (!response || !response.result || !response.result.files)
      throw `Couldn't fetch settings spreadsheet.`;

    if (!response.result.files.length)
      await this.showSetupDialog_();
    let id = response.result.files[0].id;
    return assert(id, 'Fetched spreadsheet file, but has no spreadsheetId');
  }

  async showSetupDialog_() {
    return new Promise(() => {
      let generateBackendLink = document.createElement('a');
      generateBackendLink.append(
          'Click here to generate a backend spreadsheet');
      generateBackendLink.onclick = async () => {
        generateBackendLink.textContent = 'generating...';
        setTimeout(
            () => ErrorLogger.log(
                'Hmmm...this is taking a while, something might have gone wrong. Keep waiting a bit or reload to try again.'),
            30000);
        await this.generateSpreadsheet();
        window.location.reload();
      };

      let contents = document.createElement('div');
      contents.style.overflow = 'auto';
      contents.append(
          `make-time is a side project and I don't want to deal with storing sensitive data on a server. So all data is stored in a spreadsheet of your making or in your browser's local storage.\n\n`,
          generateBackendLink);

      let dialog = showDialog(contents);
      dialog.style.whiteSpace = 'pre-wrap';
      dialog.oncancel = () => {
        alert(`Make-time requires a settings spreadsheet to function.`);
        window.location.reload();
      };
    });
  }

  async generateSpreadsheet() {
    let response = await gapi.client.sheets.spreadsheets.create(
        {}, {'properties': {'title': 'make-time backend (do not rename!)'}});
    let spreadsheetId = assert(
        response.result.spreadsheetId,
        'Something went wrong generating the spreadsheet.');

    let addSheetRequests: {}[] = [];
    for (let i = 0; i < Settings.sheetData_.length; i++) {
      let data = Settings.sheetData_[i];
      addSheetRequests.push({addSheet: {properties: {title: data.name}}});
    }
    addSheetRequests.push({deleteSheet: {sheetId: 0}});

    let addSheetsResponse = await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      resource: {requests: addSheetRequests},
    });

    let sheetNameToId: any = {};

    let replies = assert(
        addSheetsResponse.result.replies, 'Generating spreadsheet failed.');

    for (let reply of replies) {
      if (!reply.addSheet)
        continue;
      let properties =
          assert(reply.addSheet.properties, 'Generating spreadsheet failed.');
      sheetNameToId[defined(properties.title)] = properties.sheetId;
    }

    let formatSheetRequests: {}[] = [];

    for (let i = 0; i < Settings.sheetData_.length; i++) {
      let data = Settings.sheetData_[i];

      if (!data.initialData)
        continue;

      let values = data.initialData;
      await gapi.client.sheets.spreadsheets.values.update(
          {
            spreadsheetId: spreadsheetId,
            range: SpreadsheetUtils.a1Notation(data.name, 0, values[0].length),
            valueInputOption: 'USER_ENTERED',
          },
          {
            majorDimension: 'ROWS',
            values: values,
          });

      let sheetId = sheetNameToId[data.name];

      // Bold first row
      formatSheetRequests.push({
        'repeatCell': {
          'range': {'sheetId': sheetId, 'startRowIndex': 0, 'endRowIndex': 1},
          'cell': {'userEnteredFormat': {'textFormat': {'bold': true}}},
          'fields': 'userEnteredFormat(textFormat)',
        }
      });

      // Freeze first row
      formatSheetRequests.push({
        'updateSheetProperties': {
          'properties': {
            'sheetId': sheetId,
            'gridProperties': {
              'frozenRowCount': 1,
            }
          },
          'fields': 'gridProperties.frozenRowCount'
        }
      });

      if (data.name == 'daily_stats')
        this.addDailyStatsCharts_(sheetId, formatSheetRequests);
    }

    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      resource: {requests: formatSheetRequests},
    });

    return spreadsheetId;
  }

  addDailyStatsCharts_(sheetId: string, requests: any[]) {
    requests.push({
      'addChart': {
        'chart': {
          'position': {'newSheet': true},
          'spec': {
            'basicChart': {
              'chartType': 'AREA',
              'stackedType': 'STACKED',
              'legendPosition': 'TOP_LEGEND',
              'headerCount': 1,
              'domains': [{
                'domain': {
                  'sourceRange': {
                    'sources': [{
                      'sheetId': sheetId,
                      'startRowIndex': 0,
                      'startColumnIndex': 0,
                      'endColumnIndex': 1
                    }]
                  }
                }
              }],
              'series': [
                {
                  'series': {
                    'sourceRange': {
                      'sources': [{
                        'sheetId': sheetId,
                        'startRowIndex': 0,
                        'startColumnIndex': 4,
                        'endColumnIndex': 5
                      }]
                    }
                  },
                  'targetAxis': 'LEFT_AXIS'
                },
                {
                  'series': {
                    'sourceRange': {
                      'sources': [{
                        'sheetId': sheetId,
                        'startRowIndex': 0,
                        'startColumnIndex': 5,
                        'endColumnIndex': 6
                      }]
                    }
                  },
                  'targetAxis': 'LEFT_AXIS'
                },
                {
                  'series': {
                    'sourceRange': {
                      'sources': [{
                        'sheetId': sheetId,
                        'startRowIndex': 0,
                        'startColumnIndex': 6,
                        'endColumnIndex': 7
                      }]
                    }
                  },
                  'targetAxis': 'LEFT_AXIS'
                },
                {
                  'series': {
                    'sourceRange': {
                      'sources': [{
                        'sheetId': sheetId,
                        'startRowIndex': 0,
                        'startColumnIndex': 7,
                        'endColumnIndex': 8
                      }]
                    }
                  },
                  'targetAxis': 'LEFT_AXIS'
                },
              ],
            }
          },
        }
      }
    });

    requests.push({
      'addChart': {
        'chart': {
          'position': {'newSheet': true},
          'spec': {
            'basicChart': {
              'chartType': 'AREA',
              'stackedType': 'STACKED',
              'legendPosition': 'TOP_LEGEND',
              'headerCount': 1,
              'domains': [{
                'domain': {
                  'sourceRange': {
                    'sources': [{
                      'sheetId': sheetId,
                      'startRowIndex': 0,
                      'startColumnIndex': 0,
                      'endColumnIndex': 1
                    }]
                  }
                }
              }],
              'series': [
                {
                  'series': {
                    'sourceRange': {
                      'sources': [{
                        'sheetId': sheetId,
                        'startRowIndex': 0,
                        'startColumnIndex': 2,
                        'endColumnIndex': 3
                      }]
                    }
                  },
                  'targetAxis': 'LEFT_AXIS'
                },
                {
                  'series': {
                    'sourceRange': {
                      'sources': [{
                        'sheetId': sheetId,
                        'startRowIndex': 0,
                        'startColumnIndex': 3,
                        'endColumnIndex': 4
                      }]
                    }
                  },
                  'targetAxis': 'LEFT_AXIS'
                },
              ],
            }
          },
        }
      }
    });
  }

  has(setting: string) {
    let value = this.storage_.get(setting);
    return value !== undefined;
  }

  get(setting: string) {
    let value = this.storage_.get(setting);
    if (value === undefined)
      return this.defaultValue_(setting);
    let settingData = Settings.fields.find((item) => item.key == setting);
    if (settingData && settingData.type == 'checkbox')
      return value === 'TRUE';
    return value;
  }

  async writeUpdates(updates: StorageUpdate[]) {
    await this.storage_.writeUpdates(updates);
  }

  defaultValue_(setting: string) {
    for (let field of Settings.fields) {
      if (field.key == setting)
        return field.default;
    }
    throw `No such setting: ${setting}`;
  }

  async getFilters() {
    if (this.filters_)
      return this.filters_;

    let rawRules = await SpreadsheetUtils.fetchSheet(
        this.spreadsheetId, Settings.FILTERS_SHEET_NAME_);
    this.filters_ = [];

    let ruleNames = rawRules[0];
    let hasDeprecatedHeaderRule = false;

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
              hasDeprecatedHeaderRule = true;

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

          case 'nolistid':
            ruleObj.nolistid = value === 'true';
            break;

          case 'nocc':
            ruleObj.nocc = value === 'true';
            break;

          default:
            let validField = setFilterField(ruleObj, name, value);
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

      this.filters_.push(ruleObj);
    }

    if (hasDeprecatedHeaderRule)
      await this.writeFilters(this.filters_, true);
    return this.filters_;
  }

  async writeFilters(rules: FilterRule[], keepInMemory?: boolean) {
    let rows = [Settings.FILTERS_SHEET_COLUMNS_];
    for (let rule of rules) {
      let newRule: string[] = [];

      let invalidField = Object.keys(rule).find(
          x => !Settings.FILTERS_SHEET_COLUMNS_.includes(x));
      assert(!invalidField && rule.label !== '');

      for (let column of Settings.FILTERS_SHEET_COLUMNS_) {
        let value;
        if (column == 'header') {
          value = JSON.stringify(rule.header);
        } else {
          value = getFilterField(rule, column);
        }
        newRule.push(value ? String(value) : '');
      }
      rows.push(newRule);
    }

    let originalFilterSheetRowCount = notNull(this.filters_).length + 1;
    await SpreadsheetUtils.writeSheet(
        this.spreadsheetId, Settings.FILTERS_SHEET_NAME_, rows,
        originalFilterSheetRowCount);

    // Null out the filters so they get refetched. In theory could avoid the
    // network request and populate the filters from the rules argument to
    // writeFilters, but doesn't seem worth the potential extra code that needs
    // to have the rules be in the right format.
    if (!keepInMemory)
      this.filters_ = null;
  }
}
