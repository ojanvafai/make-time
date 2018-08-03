
async function gapiFetch(method, requestParams, opt_requestBody) {
  let numRetries = 3;
  for (var i = 0; i < numRetries; i++) {
    try {
      return await method(requestParams, opt_requestBody);
    } catch (e) {
      console.log('Response failed.');
      if (i == numRetries - 1)
        throw e;
    }
  }
}
