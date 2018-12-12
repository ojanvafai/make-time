import { gapiFetch } from './Net.js';

async function getSheetId(spreadsheetId: string, sheetName: string): Promise<any> {
  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  let response = await gapiFetch(gapi.client.sheets.spreadsheets.get, {
    spreadsheetId: spreadsheetId,
    ranges: [sheetName],
  });
  // TODO: Handle response.status != 200.
  return response.result.sheets[0].properties.sheetId;
}

export class SpreadsheetUtils{
  static a1Notation = (sheetName: string, startRowIndex: number, numColumns: number) => {
    let aCharCode = "A".charCodeAt(0);
    let lastColumn = String.fromCharCode(aCharCode + numColumns - 1);
    return `${sheetName}!A${startRowIndex + 1}:${lastColumn}`;
  }

  static fetchSheet = async (spreadsheetId: string, range: string) => {
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let response =  await gapiFetch(gapi.client.sheets.spreadsheets.values.get, {
      spreadsheetId: spreadsheetId,
      range: range,
    });
    return response.result.values || [];
  };

  // Assumes rows are all the same length.
  static writeSheet = async (spreadsheetId: string, sheetName: string, rows: (string | number)[][], opt_rowsToOverwrite = 0) => {
    let requestParams = {
      spreadsheetId: spreadsheetId,
      range: SpreadsheetUtils.a1Notation(sheetName, 0, rows[0].length),
      valueInputOption: 'RAW',
    };
    let requestBody = {
      values: rows,
    };
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let response = await gapiFetch(gapi.client.sheets.spreadsheets.values.update, requestParams, requestBody);
    // TODO: Handle if response.status != 200.

    // Ensure at least opt_rowsToOverwrite get overridden so that old values get cleared.
    if (response.status == 200 && opt_rowsToOverwrite > rows.length) {
      let startRow = rows.length + 1;
      let finalRow = opt_rowsToOverwrite;
      // TODO: Handle sheets with more than ZZ columns.
      let requestParams = {
        spreadsheetId: spreadsheetId,
        range: `${sheetName}!A${startRow}:ZZ${finalRow}`,
      }
      // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
      await gapiFetch(gapi.client.sheets.spreadsheets.values.clear, requestParams, {});
    }
  }

  static fetch2ColumnSheet = async (spreadsheetId: string, sheetName: string) => {
    let range = `${sheetName}!A1:B`;
    let result: any = {};
    let values = await SpreadsheetUtils.fetchSheet(spreadsheetId, range);
    if (!values)
      return result;

    for (var i = 0; i < values.length; i++) {
      let value = values[i];
      if (value[0] || value[1])
        result[value[0]] = value[1];
    }
    return result;
  }

  static write2ColumnSheet = async (spreadsheetId: string, sheetName: string, rows: (string | number)[][], opt_rowsToOverwrite = 0) => {
    let requestParams = {
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A1:B`,
      valueInputOption: 'RAW',
    };
    let requestBody = {
      values: rows,
    };
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let response = await gapiFetch(gapi.client.sheets.spreadsheets.values.update, requestParams, requestBody);
    // TODO: Handle if response.status != 200.

    // Ensure at least opt_rowsToOverwrite get overridden so that old values get cleared.
    if (response.status == 200 && opt_rowsToOverwrite > rows.length) {
      let startRow = rows.length + 1;
      let finalRow = opt_rowsToOverwrite;
      let requestParams = {
        spreadsheetId: spreadsheetId,
        range: `${sheetName}!A${startRow}:B${finalRow}`,
      }
      // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
      await gapiFetch(gapi.client.sheets.spreadsheets.values.clear, requestParams, {});
    }
  }

  static appendToSheet = async (spreadsheetId: string, sheetName: string, rows: (string | number)[][]) => {
    let requestParams = {
      spreadsheetId: spreadsheetId,
      range: sheetName,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
    };
    let requestBody = {
      values: rows,
    };
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let response = await gapiFetch(gapi.client.sheets.spreadsheets.values.append, requestParams, requestBody);
    // TODO: Handle if response.status != 200.
  }

  static deleteRows = async (spreadsheetId: string, sheetName: string, startIndex: number, endIndex: number) => {
    var params = {
      spreadsheetId: spreadsheetId,
    };

    var sheetId = await getSheetId(spreadsheetId, sheetName);
    if (sheetId === undefined)
      throw `Could not get sheetId for sheet ${sheetName}`;

    var batchUpdateSpreadsheetRequestBody = {
      requests: [
        {
          "deleteDimension": {
            "range": {
              "sheetId": sheetId,
              "dimension": "ROWS",
              "startIndex": startIndex,
              "endIndex": endIndex,
            }
          }
        },
      ],
    };

    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let response = await gapiFetch(gapi.client.sheets.spreadsheets.batchUpdate, params, batchUpdateSpreadsheetRequestBody);
    // TODO: Handle response.status != 200.
  }
}
