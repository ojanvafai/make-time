import { SpreadsheetUtils } from './SpreadsheetUtils.js';

export class ServerStorage {
  constructor(spreadsheetId) {
    this.spreadsheetId_ = spreadsheetId;
  }

  async fetch() {
    if (ServerStorage.backendValues_)
      return;

    const rawBackendValues = await SpreadsheetUtils.fetch2ColumnSheet(this.spreadsheetId_, ServerStorage.BACKEND_SHEET_NAME_);

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

  async writeUpdates(updates) {
    for (let update of updates) {
      ServerStorage.backendValues_[update.key] = update.value;
    }
    await SpreadsheetUtils.write2ColumnSheet(this.spreadsheetId_, ServerStorage.BACKEND_SHEET_NAME_, Object.entries(ServerStorage.backendValues_));
  }
}

ServerStorage.backendValues_ = null;

// List of keys stored in the backend sheet.
ServerStorage.KEYS = {
  HAS_SHOWN_FIRST_RUN: 'has_shown_first_run',
  LAST_DEQUEUE_TIME: 'Last dequeue time',
  LAST_GC_TIME: 'Last GC time',
  VACATION: 'vacation',
  TIMER_DURATION: 'timeout',
  AUTO_START_TIMER: 'auto_start_timer',
  ALLOWED_REPLY_LENGTH: 'allowed_reply_length',
  DAYS_TO_SHOW: 'days_to_show',
  LOG_MATCHING_RULES: 'log_matching_rules',
};

ServerStorage.BACKEND_SHEET_NAME_ = 'backend-do-not-modify';
