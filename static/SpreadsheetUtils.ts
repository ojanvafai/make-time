import {ASSERT_STRING} from './Base.js';
import {gapiFetch} from './Net.js';

interface TwoColumnSheet {
  [property: string]: string;
}

async function getSheetId(
    spreadsheetId: string, sheetName: string): Promise<any> {
  let response = await gapiFetch(gapi.client.sheets.spreadsheets.get, {
    spreadsheetId: spreadsheetId,
    ranges: [sheetName],
  });
  if (!response || !response.result || !response.result.sheets)
    throw ASSERT_STRING;
  let sheet = response.result.sheets[0];
  if (!sheet.properties)
    throw ASSERT_STRING;
  return sheet.properties.sheetId;
}

export class SpreadsheetUtils {
  static a1Notation =
      (sheetName: string, startRowIndex: number, numColumns: number) => {
        let aCharCode = 'A'.charCodeAt(0);
        let lastColumn = String.fromCharCode(aCharCode + numColumns - 1);
        return `${sheetName}!A${startRowIndex + 1}:${lastColumn}`;
      }

  static fetchSheet = async (spreadsheetId: string, range: string) => {
    let response = await gapiFetch(gapi.client.sheets.spreadsheets.values.get, {
      spreadsheetId: spreadsheetId,
      range: range,
    });
    return response.result.values || [];
  };

  // Assumes rows are all the same length.
  static writeSheet =
      async (
          spreadsheetId: string, sheetName: string, rows: (string|number)[][],
          opt_rowsToOverwrite = 0) => {
    let requestParams = {
      spreadsheetId: spreadsheetId,
      range: SpreadsheetUtils.a1Notation(sheetName, 0, rows[0].length),
      valueInputOption: 'RAW',
    };
    let requestBody = {
      values: rows,
    };
    let response = await gapiFetch(
        gapi.client.sheets.spreadsheets.values.update, requestParams,
        requestBody);
    // TODO: Handle if response.status != 200.

    // Ensure at least opt_rowsToOverwrite get overridden so that old values get
    // cleared.
    if (response.status == 200 && opt_rowsToOverwrite > rows.length) {
      let startRow = rows.length + 1;
      let finalRow = opt_rowsToOverwrite;
      // TODO: Handle sheets with more than ZZ columns.
      let requestParams = {
        spreadsheetId: spreadsheetId,
        range: `${sheetName}!A${startRow}:ZZ${finalRow}`,
      };
      await gapiFetch(
          gapi.client.sheets.spreadsheets.values.clear, requestParams, {});
    }
  }

  static fetch2ColumnSheet =
      async (spreadsheetId: string, sheetName: string) => {
    let range = `${sheetName}!A1:B`;
    let result: TwoColumnSheet = {};
    let values = await SpreadsheetUtils.fetchSheet(spreadsheetId, range);
    if (!values)
      return result;

    for (var i = 0; i < values.length; i++) {
      let key = String(values[i][0]);
      let value = String(values[i][1]);
      if (key !== '' && value !== '')
        result[key] = value;
    }
    return result;
  }

  static write2ColumnSheet =
      async (
          spreadsheetId: string, sheetName: string, rows: (string|number)[][],
          opt_rowsToOverwrite = 0) => {
    let requestParams = {
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A1:B`,
      valueInputOption: 'RAW',
    };
    let requestBody = {
      values: rows,
    };
    let response = await gapiFetch(
        gapi.client.sheets.spreadsheets.values.update, requestParams,
        requestBody);
    // TODO: Handle if response.status != 200.

    // Ensure at least opt_rowsToOverwrite get overridden so that old values get
    // cleared.
    if (response.status == 200 && opt_rowsToOverwrite > rows.length) {
      let startRow = rows.length + 1;
      let finalRow = opt_rowsToOverwrite;
      let requestParams = {
        spreadsheetId: spreadsheetId,
        range: `${sheetName}!A${startRow}:B${finalRow}`,
      };
      await gapiFetch(
          gapi.client.sheets.spreadsheets.values.clear, requestParams, {});
    }
  }

  static appendToSheet =
      async (
          spreadsheetId: string, sheetName: string,
          rows: (string|number)[][]) => {
    let requestParams = {
      spreadsheetId: spreadsheetId,
      range: sheetName,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
    };
    let requestBody = {
      values: rows,
    };
    await gapiFetch(
        gapi.client.sheets.spreadsheets.values.append, requestParams,
        requestBody);
    // TODO: Handle if response.status != 200.
  }

  static deleteRows = async (
      spreadsheetId: string, sheetName: string, startIndex: number,
      endIndex: number) => {
    var params = {
      spreadsheetId: spreadsheetId,
    };

    var sheetId = await getSheetId(spreadsheetId, sheetName);
    if (sheetId === undefined)
      throw `Could not get sheetId for sheet ${sheetName}`;

    var batchUpdateSpreadsheetRequestBody = {
      requests: [
        {
          'deleteDimension': {
            'range': {
              'sheetId': sheetId,
              'dimension': 'ROWS',
              'startIndex': startIndex,
              'endIndex': endIndex,
            }
          }
        },
      ],
    };

    await gapiFetch(
        gapi.client.sheets.spreadsheets.batchUpdate, params,
        batchUpdateSpreadsheetRequestBody);
    // TODO: Handle response.status != 200.
  }
}
