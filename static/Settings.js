import { AsyncOnce } from './AsyncOnce.js';
import { ErrorLogger } from './ErrorLogger.js';
import { ServerStorage } from './ServerStorage.js';
import { SpreadsheetUtils } from './SpreadsheetUtils.js';
import { showDialog } from './main.js';

export class Settings {
  constructor() {
    this.fetcher_ = new AsyncOnce(this.fetch_.bind(this))
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
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let response = await gapi.client.drive.files.list({
      q: "trashed=false and name='make-time backend (do not rename!)'",
      spaces: 'drive',
    });

    if (!response.result.files.length)
      await this.showSetupDialog_();
    return response.result.files[0].id;
  }

  async showSetupDialog_() {
    return new Promise((resolve, reject) => {
      let generateBackendLink = document.createElement('a');
      generateBackendLink.append('Click here to generate a backend spreadsheet');
      generateBackendLink.onclick = async () => {
        generateBackendLink.textContent = 'generating...';
        setTimeout(() => ErrorLogger.log('Hmmm...this is taking a while, something might have gone wrong. Keep waiting a bit or reload to try again.'), 30000);
        await this.generateSpreadsheet();
        window.location.reload();
      };

      let contents = document.createElement('div');
      contents.style.overflow = 'auto';
      contents.append(`make-time is a side project and I don't want to deal with storing sensitive data on a server. So all data is stored in a spreadsheet of your making or in your browser's local storage.\n\n`, generateBackendLink);

      let dialog = showDialog(contents);
      dialog.style.whiteSpace = 'pre-wrap';
      dialog.oncancel = () => {
        alert(`Make-time requires a settings spreadsheet to function.`);
        window.location.reload();
      };
    });
  }

  async generateSpreadsheet() {
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let response = await gapi.client.sheets.spreadsheets.create({},
      {"properties": {"title": 'make-time backend (do not rename!)'}
    });
    let spreadsheetId = response.result.spreadsheetId;
    let spreadheetUrl = response.result.spreadsheetUrl;

    let addSheetRequests = [];
    for (let i = 0; i < Settings.sheetData_.length; i++) {
      let data = Settings.sheetData_[i];
      addSheetRequests.push({addSheet: {properties: {title: data.name}}});
    }
    addSheetRequests.push({deleteSheet: {sheetId: 0}});

    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let addSheetsResponse = await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      resource: {requests: addSheetRequests},
    });

    let sheetNameToId = {};

    for (let reply of addSheetsResponse.result.replies) {
      if (!reply.addSheet)
        continue;
      let properties = reply.addSheet.properties;
      sheetNameToId[properties.title] = properties.sheetId;
    }

    let formatSheetRequests = [];

    for (let i = 0; i < Settings.sheetData_.length; i++) {
      let data = Settings.sheetData_[i];

      if (!data.initialData)
        continue;

      let values = data.initialData;
      // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
      let addDataResponse = await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: SpreadsheetUtils.a1Notation(data.name, 0, values[0].length),
        valueInputOption: 'USER_ENTERED',
      }, {
        majorDimension: 'ROWS',
        values: values,
      });

      let sheetId = sheetNameToId[data.name];

      // Bold first row
      formatSheetRequests.push({
        "repeatCell": {
          "range": {
            "sheetId": sheetId,
            "startRowIndex": 0,
            "endRowIndex": 1
          },
          "cell": {
            "userEnteredFormat": {
              "textFormat": {
                "bold": true
              }
            }
          },
          "fields": "userEnteredFormat(textFormat)",
        }
      });

      // Freeze first row
      formatSheetRequests.push({
        "updateSheetProperties": {
          "properties": {
            "sheetId": sheetId,
            "gridProperties": {
              "frozenRowCount": 1,
            }
          },
          "fields": "gridProperties.frozenRowCount"
        }
      });

      if (data.name == 'daily_stats')
        this.addDailyStatsCharts_(sheetId, formatSheetRequests);
    }

    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let formatSheetsResponse = await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      resource: {requests: formatSheetRequests},
    });

    return spreadsheetId;
  }

  addDailyStatsCharts_(sheetId, requests) {
    requests.push({
      "addChart": {
        "chart": {
          "position": { "newSheet": true },
          "spec": {
            "basicChart": {
              "chartType": "AREA",
              "stackedType": "STACKED",
              "legendPosition": "TOP_LEGEND",
              "headerCount": 1,
              "domains": [
                {
                  "domain": {
                    "sourceRange": {
                      "sources": [
                        {
                          "sheetId": sheetId,
                          "startRowIndex": 0,
                          "startColumnIndex": 0,
                          "endColumnIndex": 1
                        }
                      ]
                    }
                  }
                }
              ],
              "series": [
                {
                  "series": {
                    "sourceRange": {
                      "sources": [
                        {
                          "sheetId": sheetId,
                          "startRowIndex": 0,
                          "startColumnIndex": 4,
                          "endColumnIndex": 5
                        }
                      ]
                    }
                  },
                  "targetAxis": "LEFT_AXIS"
                },
                {
                  "series": {
                    "sourceRange": {
                      "sources": [
                        {
                          "sheetId": sheetId,
                          "startRowIndex": 0,
                          "startColumnIndex": 5,
                          "endColumnIndex": 6
                        }
                      ]
                    }
                  },
                  "targetAxis": "LEFT_AXIS"
                },
                {
                  "series": {
                    "sourceRange": {
                      "sources": [
                        {
                          "sheetId": sheetId,
                          "startRowIndex": 0,
                          "startColumnIndex": 6,
                          "endColumnIndex": 7
                        }
                      ]
                    }
                  },
                  "targetAxis": "LEFT_AXIS"
                },
                {
                  "series": {
                    "sourceRange": {
                      "sources": [
                        {
                          "sheetId": sheetId,
                          "startRowIndex": 0,
                          "startColumnIndex": 7,
                          "endColumnIndex": 8
                        }
                      ]
                    }
                  },
                  "targetAxis": "LEFT_AXIS"
                },
              ],
            }
          },
        }
      }
    });

    requests.push({
      "addChart": {
        "chart": {
          "position": { "newSheet": true },
          "spec": {
            "basicChart": {
              "chartType": "AREA",
              "stackedType": "STACKED",
              "legendPosition": "TOP_LEGEND",
              "headerCount": 1,
              "domains": [
                {
                  "domain": {
                    "sourceRange": {
                      "sources": [
                        {
                          "sheetId": sheetId,
                          "startRowIndex": 0,
                          "startColumnIndex": 0,
                          "endColumnIndex": 1
                        }
                      ]
                    }
                  }
                }
              ],
              "series": [
                {
                  "series": {
                    "sourceRange": {
                      "sources": [
                        {
                          "sheetId": sheetId,
                          "startRowIndex": 0,
                          "startColumnIndex": 2,
                          "endColumnIndex": 3
                        }
                      ]
                    }
                  },
                  "targetAxis": "LEFT_AXIS"
                },
                {
                  "series": {
                    "sourceRange": {
                      "sources": [
                        {
                          "sheetId": sheetId,
                          "startRowIndex": 0,
                          "startColumnIndex": 3,
                          "endColumnIndex": 4
                        }
                      ]
                    }
                  },
                  "targetAxis": "LEFT_AXIS"
                },
              ],
            }
          },
        }
      }
    });
  }

  has(setting) {
    let value = this.storage_.get(setting);
    return value !== undefined;
  }

  get(setting) {
    let value = this.storage_.get(setting);
    if (value === undefined)
      return this.defaultValue_(setting);
    let settingData = Settings.fields.find((item) => item.key == setting);
    if (settingData && settingData.type == 'checkbox')
      return value === 'TRUE';
    return value;
  }

  async writeUpdates(updates) {
    await this.storage_.writeUpdates(updates);
  }

  defaultValue_(setting) {
    for (let field of Settings.fields) {
      if (field.key == setting)
        return field.default;
    }
    throw `No such setting: ${setting}`;
  }

  async getFilters() {
    if (this.filters_)
      return this.filters_;

    let rawRules = await SpreadsheetUtils.fetchSheet(this.spreadsheetId, Settings.FILTERS_SHEET_NAME_);
    let rules = [];
    let labels = {};
    this.filters_ = {
      rules: rules,
    }
    let ruleNames = rawRules[0];
    let labelColumn = ruleNames.indexOf('label');

    for (let i = 1, l = rawRules.length; i < l; i++) {
      let ruleObj = {};
      for (let j = 0; j < ruleNames.length; j++) {
        let name = ruleNames[j];
        let value = rawRules[i][j];
        if (j == labelColumn)
          labels[value] = true;
        if (!value)
          continue;
        ruleObj[name] = value.toLowerCase().trim();
      }
      rules.push(ruleObj);
    }

    return this.filters_;
  }

  async writeFilters(rules) {
    let rows = [Settings.FILTERS_SHEET_COLUMNS_];
    for (let rule of rules) {
      let newRule = [];

      for (let field in rule) {
        if (!Settings.FILTERS_SHEET_COLUMNS_.includes(field))
          throw `Invalid filter rule field: ${field}. Not saving filters.`;
      }

      for (let column of Settings.FILTERS_SHEET_COLUMNS_) {
        let value = rule[column];
        newRule.push(value || '');
      }
      rows.push(newRule);
    }

    let originalFilterSheetRowCount = this.filters_.rules.length + 1;
    await SpreadsheetUtils.writeSheet(this.spreadsheetId, Settings.FILTERS_SHEET_NAME_, rows, originalFilterSheetRowCount);

    // Null out the filters so they get refetched. In theory could avoid the network request
    // and populate the filters from the rules argument to writeFilters, but doesn't seem
    // worth the potential extra code that needs to have the rules be in the right format.
    this.filters_ = null;
  }
}

Settings.QUEUED_LABELS_SHEET_NAME = 'queued_labels';
Settings.QUEUED_LABELS_SHEET_COLUMNS = ['label', 'queue', 'goal', 'index'];
Settings.FILTERS_SHEET_NAME_ = 'filters';
Settings.FILTERS_RULE_DIRECTIVES = ['to', 'from', 'subject', 'plaintext', 'htmlcontent', 'header'];
Settings.FILTERS_SHEET_COLUMNS_ = [].concat('label', Settings.FILTERS_RULE_DIRECTIVES, 'matchallmessages', 'nolistid');

Settings.sheetData_ = [
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
    initialData: [['timestamp', 'num_threads_labelled', 'total_time', 'per_label_counts']],
  },
  {
    name: 'daily_stats',
    initialData: [['date', 'total_threads', 'archived_threads_count', 'non_archived_threads_count', 'immediate_count', 'daily_count', 'weekly_count', 'monthly_count', 'num_invocations', 'total_running_time', 'min_running_time', 'max_running_time']],
  },
  {
    name: 'backend-do-not-modify',
  },
];

Settings.fields = [
  {
    key: ServerStorage.KEYS.VACATION,
    name: 'Vacation',
    description: `Queue name to show when on vacation so you can have peace of mind by seeing only urgent mail.`,
  },
  {
    key: ServerStorage.KEYS.TIMER_DURATION,
    name: 'Triage countdown timer',
    description: `Number of seconds to triage a single thread. When the timeout is hit, you are forced to take a triage action.`,
    default: 60,
    type: 'number',
  },
  {
    key: ServerStorage.KEYS.AUTO_START_TIMER,
    name: 'Auto start timer',
    description: `Timer automatically starts after triaging the first thread.`,
    default: true,
    type: 'checkbox',
  },
  {
    key: ServerStorage.KEYS.ALLOWED_REPLY_LENGTH,
    name: 'Allowed quick reply length',
    description: `Allowed length of quick replies. Longer messages will refuse to send.`,
    default: 280,
    type: 'number',
  },
  {
    key: ServerStorage.KEYS.DAYS_TO_SHOW,
    name: 'Wicked witch count',
    description: `For times when you're melting, only show emails from the past N days.`,
    type: 'number',
  },
  {
    key: ServerStorage.KEYS.LOG_MATCHING_RULES,
    name: 'Log matching rules',
    description: `Log the matching filter rule to the chrome developer console.`,
    default: false,
    type: 'checkbox',
  },
];
