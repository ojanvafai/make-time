class ServerStorage {
  constructor(spreadsheetId) {
    this.spreadsheetId_ = spreadsheetId;
  }

  async fetch() {
    if (ServerStorage.backendValues_)
      return;

    const rawBackendValues = await fetch2ColumnSheet(this.spreadsheetId_, ServerStorage.BACKEND_SHEET_NAME_);
    ServerStorage.backendValues_ = {};
    // Strip no longer supported backend keys.
    for (let key of Object.values(ServerStorage.KEYS)) {
      let value = rawBackendValues[key];
      if (value !== undefined)
        ServerStorage.backendValues_[key] = value;
    }
  }

  get(key) {
    if (!ServerStorage.backendValues_)
      throw `Attempted to read out of storage before fetching from the network: ${key}.`;
    return ServerStorage.backendValues_[key];
  }

  async write2ColumnSheet_(sheetName, rows) {
    let rowCount = Object.keys(rows).length;
    let requestParams = {
      spreadsheetId: this.spreadsheetId_,
      range: sheetName + '!A1:B' + rowCount,
      valueInputOption: 'RAW',
    };
    let requestBody = {
      values: rows,
    };
    let response = await gapiFetch(gapi.client.sheets.spreadsheets.values.update, requestParams, requestBody);
    // TODO: Handle if response.status != 200.
  }

  async writeUpdates(updates) {
    for (let update of updates) {
      ServerStorage.backendValues_[update.key] = update.value;
    }
    await this.write2ColumnSheet_(ServerStorage.BACKEND_SHEET_NAME_, Object.entries(ServerStorage.backendValues_));
  }
}

// List of keys stored in the backend sheet.
ServerStorage.KEYS = {
  LAST_DEQUEUE_TIME: 'Last dequeue time',
  VACATION_SUBJECT: 'vacation_subject',
  TIMER_DURATION: 'timeout',
  ALLOWED_REPLY_LENGTH: 'allowed_reply_length',
};

ServerStorage.BACKEND_SHEET_NAME_ = 'backend-do-not-modify';
