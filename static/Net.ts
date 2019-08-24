import {redirectToSignInPage} from './Base.js';

let queuedRequests_: ((value?: {}|PromiseLike<{}>|undefined) => void)[] = [];
let TEN_SECONDS = 10 * 1000;
export const CONNECTION_FAILURE_KEY = 'trouble-connecting-to-internet';

function backOnline() {
  return new Promise(resolve => queuedRequests_.push(resolve));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

window.addEventListener('online', (_e) => {
  for (let request of queuedRequests_) {
    request();
  }
  queuedRequests_ = [];
});

// TODO: Parameterize the return value of this so that we can have strong types
// for all the code that calls gapiFetch.
export async function gapiFetch<T>(
    method: (params: any, body?: any) => gapi.client.Request<T>,
    requestParams: any, requestBody?: any) {
  let numRetries = 3;
  for (var i = 0; i < numRetries; i++) {
    try {
      if (!navigator.onLine)
        await backOnline();
      let response = await method(requestParams, requestBody);
      window.dispatchEvent(new Event(CONNECTION_FAILURE_KEY));
      return response;
    } catch (e) {
      // For auth errors, reload the page so it redirects to the login screen.
      if (e.status === 401)
        redirectToSignInPage();
      // Don't retry 404s as they should never work on retry.
      if (e.status === 404)
        throw e;
      console.log('Response failed.');
      if (i == numRetries - 1)
        throw e;
      await sleep(TEN_SECONDS);
    }
  }
  // Throw instead of asserting here so that TypeScript knows that this function
  // never returns undefined.
  throw new Error('This should never happen.');
}
