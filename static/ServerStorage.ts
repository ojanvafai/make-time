import {SpreadsheetUtils, SpreadsheetCellValue} from './SpreadsheetUtils.js';

export interface StorageUpdate {
  key: string;
  value: SpreadsheetCellValue;
}

export class ServerStorage {
  private static backendValues_: any;
  static BACKEND_SHEET_NAME_: string;
  static KEYS: KeyTypes;

  constructor(private spreadsheetId_: string) {}

  async fetch() {
    if (ServerStorage.backendValues_)
      return;

    const rawBackendValues = await SpreadsheetUtils.fetch2ColumnSheet(
        this.spreadsheetId_, ServerStorage.BACKEND_SHEET_NAME_);

    // TODO: Remove the string check once clients have updated to not have
    // stray undefineds in their settings.
    let hasInvalidValues = false;
    ServerStorage.backendValues_ = {};
    // Strip no longer supported backend keys.
    for (let key of Object.values(ServerStorage.KEYS)) {
      let value = rawBackendValues[key];
      // TODO: Remove the string check once clients have updated to not have
      // stray undefineds in their settings.
      if (value === 'undefined') {
        hasInvalidValues = true;
        value = '';
      }
      if (value !== undefined)
        ServerStorage.backendValues_[key] = value;
    }

    // Write out the valid values and remove this once all clients update.
    if (hasInvalidValues)
      await this.writeUpdates([]);
  }

  get(key: string) {
    if (!ServerStorage.backendValues_)
      throw `Attempted to read out of storage before fetching from the network: ${
          key}.`;
    return ServerStorage.backendValues_[key];
  }

  async writeUpdates(updates: StorageUpdate[]) {
    for (let update of updates) {
      ServerStorage.backendValues_[update.key] = update.value;
    }
    await SpreadsheetUtils.write2ColumnSheet(
        this.spreadsheetId_, ServerStorage.BACKEND_SHEET_NAME_,
        Object.entries(ServerStorage.backendValues_));
  }
}

interface KeyTypes {
  HAS_SHOWN_FIRST_RUN: string;
  LAST_DEQUEUE_TIME: string;
  LAST_GC_TIME: string;
  VACATION: string;
  TIMER_DURATION: string;
  AUTO_START_TIMER: string;
  ALLOWED_REPLY_LENGTH: string;
  DAYS_TO_SHOW: string;
  LOG_MATCHING_RULES: string;
}

let keys: KeyTypes = {
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

// List of keys stored in the backend sheet.
ServerStorage.KEYS = keys;

ServerStorage.BACKEND_SHEET_NAME_ = 'backend-do-not-modify';
