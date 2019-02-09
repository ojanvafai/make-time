// TODO: This file probably shouldn't exist. It's a holdover from early
// spaghetti code that was extracted out to remove circular dependencies between
// modules. It's not trivial to detangle though. It's mostly reused functions
// that have to know about Threads and things like that.

import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';
// Sigh: We need the auth.js file to be imported after app.js, so import an
// unused dummy name to make clang-format sort it correctly. Then we need to use
// the import to keep typescript from stripping it.
import * as usedForSideEffects from '../third_party/firebasejs/5.8.2/firebase-auth.js';
usedForSideEffects;
import * as usedForSideEffects2 from '../third_party/firebasejs/5.8.2/firebase-firestore.js';
usedForSideEffects2;

import {AsyncOnce} from './AsyncOnce.js';
import {assert, defined, getDefinitelyExistsElementById, USER_ID} from './Base.js';
import {ErrorLogger} from './ErrorLogger.js';
import {Labels} from './Labels.js';
import {gapiFetch} from './Net.js';
import {COMPLETED_EVENT_NAME, RadialProgress} from './RadialProgress.js';
import {ServerStorage, StorageUpdates} from './ServerStorage.js';
import {Settings} from './Settings.js';
import {ThreadFetcher} from './ThreadFetcher.js';
import {HelpDialog} from './views/HelpDialog.js';

// Extract these before rendering any threads since the threads can have
// elements with IDs in them.
const title = getDefinitelyExistsElementById('title');
const loader = getDefinitelyExistsElementById('loader');

interface TitleEntry {
  key: string;
  title: (HTMLElement|string)[];
}

let storage_ = new ServerStorage();
let labels_ = new Labels();
let settings_: Settings;
let titleStack_: TitleEntry[] = [];
let loaderTitleStack_: TitleEntry[] = [];

// Client ID and API key from the Developer Console
let clientId: string;
let firebaseConfig: {apiKey: string, authDomain: string, projectId: string};
let isGoogle = location.toString().includes(':8000/') ||
    location.toString().includes('https://com-mktime');

if (isGoogle) {
  firebaseConfig = {
    apiKey: 'AIzaSyCcuBNlI6FgtgiLub2ihGInrNwDc3_UZSY',
    authDomain: 'com-mktime.firebaseapp.com',
    projectId: 'google.com:mktime',
  };
  clientId =
      '800053010416-p1p6n47o6ovdm04329v9p8mskl618kuj.apps.googleusercontent.com';
} else {
  firebaseConfig = {
    apiKey: 'AIzaSyDFj2KpiXCNYnmp7VxKz5wpjJ4RquGB8qA',
    authDomain: 'mk-time.firebaseapp.com',
    projectId: 'mk-time',
  };
  clientId =
      '475495334695-0i3hbt50i5lj8blad3j7bj8j4fco8edo.apps.googleusercontent.com';
}

// Array of API discovery doc URLs for APIs used by the quickstart
let DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest',
  'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
];

// Authorization scopes required by the Google API.
let SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.google.com/m8/feeds',
  'https://www.googleapis.com/auth/calendar.readonly',
];

let isSignedIn_ = false;

export async function getLabels() {
  await login();
  return labels_;
}

export async function getSettings() {
  await login();
  return settings_;
}

// Intentionally don't fetch here so that the onload sequence can listen to
// events on ServerStorage without forcing a login.
export async function getServerStorage() {
  return storage_;
}

function showPleaseReload() {
  ErrorLogger.log(
      `Something went wrong loading MakeTime and you need to reload. This usually happens if you're not connected to the internet when loading MakeTime.`);
}

function loadGapi() {
  return new Promise((resolve) => {
    gapi.load('client:auth2', () => resolve());
  });
};

function redirectToSignInPage_() {
  var provider = new firebase.auth.GoogleAuthProvider();
  SCOPES.forEach(x => provider.addScope(x));
  firebase.auth().signInWithRedirect(provider);
}

let loginOnce_: AsyncOnce<void>;
let loadedGapi_ = false;

export async function login() {
  if (!loginOnce_)
    loginOnce_ = new AsyncOnce<void>(login_);
  await loginOnce_.do();
}

async function login_() {
  if (isSignedIn_)
    return;

  let progress = updateLoaderTitle('login', 1, 'Logging in...');

  // Assert that we're not initializing firebase more than once.
  assert(!firebase.apps.length);

  try {
    await firebase.initializeApp(firebaseConfig);

    // getRedirectResult triggers onIdTokenChanged, so no need to handle the
    // result, but we do need to call it.
    await firebase.auth().getRedirectResult();

    await new Promise(resolve => {
      // Use onIdTokenChanged instead of onAuthStateChanged since that captures
      // id token revocation in addition to login/logout.
      firebase.auth().onIdTokenChanged(async (user) => {
        if (user) {
          if (loadedGapi_)
            return;
          loadedGapi_ = true;
          await loadGapi();
          await gapi.client.init({
            discoveryDocs: DISCOVERY_DOCS,
            clientId: clientId,
            scope: SCOPES.join(' '),
          });

          // This returns false in multilogin scenarios. Calling
          // gapi.auth2.getAuthInstance().signIn() prompts the user to pick an
          // account.
          if (!gapi.auth2.getAuthInstance().isSignedIn.get()) {
            // @ts-ignore gapi.auth2.SigninOptions in DefinitelyTyped doesn't
            // know about ux_mode. :(
            gapi.auth2.getAuthInstance().signIn({ux_mode: 'redirect'});
            return;
          }

          await Promise.all([labels_.fetch(), storage_.fetch()]);

          // This has to happen after storage_.fetch().
          settings_ = new Settings(storage_);
          await settings_.fetch();

          if (!storage_.get(ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN)) {
            await showHelp();
            let updates: StorageUpdates = {};
            updates[ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN] = true;
            storage_.writeUpdates(updates);
          }

          // Firebase APIs don't detect signout of google accounts. They manage
          // firebase tokens only. It's weird though, since they fire
          // onIdTokenChanged but still pass a user object as if you're still
          // signed in.
          gapi.auth2.getAuthInstance().isSignedIn.listen(
              (isSignedIn: boolean) => {
                if (!isSignedIn)
                  redirectToSignInPage_();
              });

          progress.incrementProgress();
          resolve();
        } else {
          redirectToSignInPage_();
        }
      });
    });
  } catch (e) {
    showPleaseReload();
    console.log(e);
    return;
  }
}

let firestore_: firebase.firestore.Firestore;
export function firestore() {
  if (!firestore_) {
    firestore_ = firebase.firestore();
  }
  return firestore_;
}

export function firebaseAuth() {
  return firebase.auth();
}

export function updateTitle(key: string, ...opt_title: string[]) {
  updateTitleBase(titleStack_, title, key, ...opt_title);
}

let progressElements: Map<string, RadialProgress> = new Map();

export function updateLoaderTitle(
    key: string, count: number, ...opt_title: (HTMLElement|string)[]) {
  let progress = progressElements.get(key);
  if (!progress) {
    progress = new RadialProgress();
    progressElements.set(key, progress);
    progress.addEventListener(COMPLETED_EVENT_NAME, () => {
      clearLoaderTitle(key);
    });
  }

  progress.addToTotal(count);

  updateTitleBase(loaderTitleStack_, loader, key, ...opt_title, progress);
  return progress;
}

function clearLoaderTitle(key: string) {
  updateTitleBase(loaderTitleStack_, loader, key);
}

function updateTitleBase(
    stack: TitleEntry[], node: HTMLElement, key: string,
    ...opt_title: (HTMLElement|string)[]) {
  let index = stack.findIndex((item) => item.key == key);
  if (!opt_title[0]) {
    if (index != -1)
      stack.splice(index, 1);
  } else if (index == -1) {
    stack.push({
      key: key,
      title: opt_title,
    });
  } else {
    let entry = stack[index];
    entry.title = opt_title;
  }

  node.textContent = '';
  if (stack.length)
    node.append(...stack[stack.length - 1].title);
}

interface FetchRequestParameters {
  userId: string;
  q: string;
  pageToken?: string;
  maxResults?: number;
}

// Gmail API only allows 500 as the cap for max results.
let MAX_RESULTS_CAP = 500;

export async function fetchThreads(
    forEachThread: (fetcher: ThreadFetcher) => void, query: string,
    maxResults: number = 0) {
  // If the query is empty or just whitespace, then we would fetch all mail by
  // accident.
  assert(query.trim() !== '');

  // Chats don't expose their bodies in the gmail API, so just skip them.
  query = `(${query}) AND -in:chats`;

  let resultCountLeft = maxResults || MAX_RESULTS_CAP;

  let getPageOfThreads = async (opt_pageToken?: string) => {
    let maxForThisFetch = Math.min(resultCountLeft, MAX_RESULTS_CAP);
    resultCountLeft -= maxForThisFetch;

    let requestParams = <FetchRequestParameters>{
      'userId': USER_ID,
      'q': query,
      'maxResults': maxForThisFetch,
    };

    if (maxResults)
      requestParams.maxResults = maxResults;

    if (opt_pageToken)
      requestParams.pageToken = opt_pageToken;

    let resp =
        await gapiFetch(gapi.client.gmail.users.threads.list, requestParams);
    let threads = resp.result.threads || [];
    for (let rawThread of threads) {
      await forEachThread(new ThreadFetcher(
          defined(rawThread.id), defined(rawThread.historyId),
          await getLabels()));
    }

    if (resultCountLeft <= 0)
      return;

    let nextPageToken = resp.result.nextPageToken;
    if (nextPageToken)
      await getPageOfThreads(nextPageToken);
  };

  await getPageOfThreads();
}

// TODO: Share some code with fetchThreads.
export async function fetchMessages(
    forEachMessage: (message: gapi.client.gmail.Message) => void, query: string,
    maxResults: number = 0) {
  // If the query is empty or just whitespace, then we would fetch all mail by
  // accident.
  assert(query.trim() !== '');

  // Chats don't expose their bodies in the gmail API, so just skip them.
  query = `(${query}) AND -in:chats`;

  let resultCountLeft = maxResults || MAX_RESULTS_CAP;

  let getPageOfThreads = async (opt_pageToken?: string) => {
    let maxForThisFetch = Math.min(resultCountLeft, MAX_RESULTS_CAP);
    resultCountLeft -= maxForThisFetch;

    let requestParams = <FetchRequestParameters>{
      'userId': USER_ID,
      'q': query,
      'maxResults': maxForThisFetch,
    };

    if (maxResults)
      requestParams.maxResults = maxResults;

    if (opt_pageToken)
      requestParams.pageToken = opt_pageToken;

    let resp =
        await gapiFetch(gapi.client.gmail.users.messages.list, requestParams);
    let messages = resp.result.messages || [];
    for (let message of messages) {
      await forEachMessage(message);
    }

    if (resultCountLeft <= 0)
      return;

    let nextPageToken = resp.result.nextPageToken;
    if (nextPageToken)
      await getPageOfThreads(nextPageToken);
  };

  await getPageOfThreads();
}

export function showHelp() {
  new HelpDialog(
      `make-time is an opinionated way of handling unreasonable amounts of email.

<b style='font-size:120%'>Disclaimers</b>
Patches welcome, but otherwise, I built it for my needs. :) Feature requests are very welcome though. Often you'll think of something I want that I don't have and I'll build it. Contact ojan@ or file issues at https://github.com/ojanvafai/make-time if you want to contribute, give feedback, etc.

<span style='color: red'>This is a side project. While I use it for my day to day email management, you might not want to. It has bugs.</span> They may be hard to deal with if you're not willing to dig into the code when they happen.

<b style="font-size:120%">Keyboard shortcuts</b>
Type '?' anywhere in make-time to see keyboard shortcuts.

<b style='font-size:120%'>Triage</b>

All the triage actions mark a thread as read, remove it from the inbox, and remove the maketime labels. <b>Aside from archiving messages (and bugs), maketime will only modify labels under the "maketime" parent label.</b> So you can do whatever you want with other labels.

The goal of triage is to get in the flow of doing all the triage quickly. After triage is done, you enter make-time mode where you work through each thread in priority order. This helps avoid flip-flopping back and forth between quick triage and deep thinking.

<b style='font-size:120%'>Filtering</b>

Philosopy: Labels are a triage tool, not a search/organization tool. The goal is to have all your labels and inbox be empty when you're done with triage. The first filter that applies to a thread wins, so every thread gets exactly one label. This enables richer filtering by taking advantage of ordering, e.g. I can have emails to me from my team show up in my inbox immediately, but emails to me from others only show up once a day. See the fillter settings dialog for more information.

Make-time processes all emails in your inbox and all emails in the maketime/unprocessed label. You don't have to, but typically, people will delete all their gmail filters and just use make-time filtering. See the Settings dialog for adding filters and modifying queues. Queues can be setup to show up in a specific order and/or only show once a day/week/month. See the queues settings dialog for more information.

Whether you leave emails in your inbox by default or moved them into the unprocessed label so you don't see them in in gmail itself till they've been processed is up to you. If you want all your mail to be unprocessed by default, create a real gmail filter with:
    Has the words: -in:chats -label:mute -from:me
  Do this: Skip Inbox,
      Apply label 'maketime/unprocessed'

<span style = 'color: red'>Emails are only processed when MakeTime is open in a browser tab. Otherwise, your mail will stay in the unprocessed label.Would love to move this to a server cron, but this is a side project and I can't be bothered to figure out how to manage server-side gmail API oauth. <b>Patches *very* welcome for this.</b></span> `);
}
