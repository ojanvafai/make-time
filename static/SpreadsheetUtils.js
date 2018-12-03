import { gapiFetch } from './Net.js';

export let SpreadsheetUtils = {};

SpreadsheetUtils.a1Notation = (sheetName, startRowIndex, numColumns) => {
  let aCharCode = "A".charCodeAt(0);
  let lastColumn = String.fromCharCode(aCharCode + numColumns - 1);
  return `${sheetName}!A${startRowIndex + 1}:${lastColumn}`;
}

SpreadsheetUtils.fetchSheet = async (spreadsheetId, range) => {
  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  let response =  await gapiFetch(gapi.client.sheets.spreadsheets.values.get, {
    spreadsheetId: spreadsheetId,
    range: range,
  });
  return response.result.values || [];
};

// Assumes rows are all the same length.
SpreadsheetUtils.writeSheet = async (spreadsheetId, sheetName, rows, opt_rowsToOverwrite) => {
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

SpreadsheetUtils.fetch2ColumnSheet = async (spreadsheetId, sheetName) => {
  let range = `${sheetName}!A1:B`;
  let result = {};
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

SpreadsheetUtils.write2ColumnSheet = async (spreadsheetId, sheetName, rows, opt_rowsToOverwrite) => {
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

SpreadsheetUtils.appendToSheet = async (spreadsheetId, sheetName, rows) => {
  let rowCount = Object.keys(rows).length;
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

let getSheetId = async (spreadsheetId, sheetName) => {
  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  let response = await gapiFetch(gapi.client.sheets.spreadsheets.get, {
    spreadsheetId: spreadsheetId,
    ranges: [sheetName],
  });
  // TODO: Handle response.status != 200.
  return response.result.sheets[0].properties.sheetId;
}

SpreadsheetUtils.deleteRows = async (spreadsheetId, sheetName, startIndex, endIndex) => {
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
