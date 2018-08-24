let SpreadsheetUtils = {};

(() => {

SpreadsheetUtils.fetchSheet = async (spreadsheetId, sheetName) => {
  let response =  await gapiFetch(gapi.client.sheets.spreadsheets.values.get, {
    spreadsheetId: spreadsheetId,
    range: sheetName,
  });
  return response.result.values;
};

SpreadsheetUtils.fetch2ColumnSheet = async (spreadsheetId, sheetName, opt_startRowIndex) => {
  let result = {};
  let values = await SpreadsheetUtils.fetchSheet(spreadsheetId, sheetName);
  if (!values)
    return result;

  let startRowIndex = opt_startRowIndex || 0;
  for (var i = startRowIndex; i < values.length; i++) {
    let value = values[i];
    result[value[0]] = value[1];
  }
  return result;
}

SpreadsheetUtils.write2ColumnSheet = async (spreadsheetId, sheetName, rows) => {
  let requestParams = {
    spreadsheetId: spreadsheetId,
    range: sheetName + '!A1:B' + rows.length,
    valueInputOption: 'RAW',
  };
  let requestBody = {
    values: rows,
  };
  let response = await gapiFetch(gapi.client.sheets.spreadsheets.values.update, requestParams, requestBody);
  // TODO: Handle if response.status != 200.
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
  let response = await gapiFetch(gapi.client.sheets.spreadsheets.values.append, requestParams, requestBody);
  // TODO: Handle if response.status != 200.
}

let getSheetId = async (spreadsheetId, sheetName) => {
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

  let response = await gapiFetch(gapi.client.sheets.spreadsheets.batchUpdate, params, batchUpdateSpreadsheetRequestBody);
  // TODO: Handle response.status != 200.
}

})();