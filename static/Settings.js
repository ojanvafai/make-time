class Settings {
  async fetch() {
    this.spreadsheetId = await this.getSpreadsheetId_();
    this.storage_ = new ServerStorage(this.spreadsheetId);
    await this.storage_.fetch();
  }

  async getSpreadsheetId_() {
    if (localStorage.spreadsheetId)
      return localStorage.spreadsheetId;

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
        setTimeout(() => alert('Hmmm...this is taking a while, something might have gone wrong. Keep waiting a bit or reload to try again.'), 30000);
        await this.generateSpreadsheet();
        window.location.reload();
      };

      let contents = document.createElement('div');
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

      var aCharCode = "A".charCodeAt(0);
      let lastRow = values.length;
      let lastColumn = String.fromCharCode(aCharCode + values[0].length - 1);
      let range = `${data.name}!A1:${lastColumn}${lastRow}`;

      let addDataResponse = await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: range,
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

      switch (data.name) {
      case 'filters':
        this.addFiltersRules_(sheetId, formatSheetRequests);
        break;
      case 'queued_labels':
        this.addQueuedLabelsRules_(sheetId, formatSheetRequests);
        break;
      case 'daily_stats':
        this.addDailyStatsCharts_(sheetId, formatSheetRequests);
        break;
      }
    }

    let formatSheetsResponse = await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      resource: {requests: formatSheetRequests},
    });

    return spreadsheetId;
  }

  addFiltersRules_(sheetId, requests) {
    // Add data validation for matchallmessages column.
    requests.push({
      setDataValidation: {
        "range": {
          "sheetId": sheetId,
          "startRowIndex": 1,
          "startColumnIndex": 7,
          "endColumnIndex": 8,
        },
        "rule": {
          "condition": {
            "type": 'ONE_OF_LIST',
            "values": [
              {userEnteredValue: 'yes'},
              {userEnteredValue: 'no'},
            ],
          },
          "strict": true,
          "showCustomUi": true
        }
      }
    });
  }

  addQueuedLabelsRules_(sheetId, requests) {
    // Add data validation for queue delivery time.
    requests.push({
      setDataValidation: {
        "range": {
          "sheetId": sheetId,
          "startRowIndex": 1,
          "startColumnIndex": 1,
          "endColumnIndex": 2,
        },
        "rule": {
          "condition": {
            "type": 'ONE_OF_LIST',
            "values": [
              {userEnteredValue: 'Daily'},
              {userEnteredValue: 'Monthly'},
              {userEnteredValue: 'Monday'},
              {userEnteredValue: 'Tuesday'},
              {userEnteredValue: 'Wednesday'},
              {userEnteredValue: 'Thursday'},
              {userEnteredValue: 'Friday'},
              {userEnteredValue: 'Saturday'},
              {userEnteredValue: 'Sunday'},
            ],
          },
          "strict": true,
          "showCustomUi": true
        }
      }
    });

    // Add data validation for queue label names.
    requests.push({
      setDataValidation: {
        "range": {
          "sheetId": sheetId,
          "startRowIndex": 1,
          "startColumnIndex": 0,
          "endColumnIndex": 1,
        },
        "rule": {
          "condition": {
            "type": 'ONE_OF_RANGE',
            "values": [
              {userEnteredValue: '=queued_labels!D2:D900'},
            ],
          },
          "strict": false,
          "showCustomUi": true
        }
      }
    });
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
                          "startColumnIndex": 3,
                          "endColumnIndex": 4
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
}

Settings.sheetData_ = [
  {
    name: 'filters',
    initialData: [['label', 'to', 'from', 'subject', 'plaintext', 'htmlcontent', 'header', 'matchallmessages']],
  },
  {
    name: 'queued_labels',
    initialData: [
      ['label', 'day', '', 'Known Label Names'],
      ['', '', '', 'blocked'],
      ['', '', '', '=UNIQUE(filters!A2:A)'],
    ],
  },
  {
    name: 'statistics',
    initialData: [['timestamp', 'num_threads_labelled', 'total_time', 'per_label_counts']],
  },
  {
    name: 'daily_stats',
    initialData: [['date total_threads', 'archived_threads_count', 'non_archived_threads_count', 'immediate_count', 'daily_count', 'weekly_count', 'monthly_count', 'num_invocations', 'total_running_time', 'min_running_time', 'max_running_time']],
  },
  {
    name: 'backend-do-not-modify',
  },
];

Settings.fields = [
  {
    key: ServerStorage.KEYS.VACATION_SUBJECT,
    name: 'Vacation subject',
    description: `String to search subject lines to search for to show. When on vacation, you can restrict make-time to only process and show urgent messages so you can be on vacation with the peace of mind that nothing urgent has come up without actually getting embroiled in non-urgent vacation activities.`,
  },
  {
    key: ServerStorage.KEYS.TIMER_DURATION,
    name: 'Triage countdown timer',
    description: `Number of seconds to triage a single thread. When the timeout is hit, you are forced to take a triage action.`,
    default: 20,
    type: 'number',
  },
  {
    key: ServerStorage.KEYS.ALLOWED_REPLY_LENGTH,
    name: 'Allowed quick reply length',
    description: `Allowed length of quick replies. Longer messages will refuse to send.`,
    default: 280,
    type: 'number',
  },
];
