// TODO: This file probably shouldn't exist. It's a holdover from early
// spaghetti code that was extracted out to remove circular dependencies between
// modules. It's not trivial to detangle though. It's mostly reused functions
// that have to know about Threads and things like that.

import {AsyncOnce} from './AsyncOnce.js';
import {getDefinitelyExistsElementById, showDialog, USER_ID} from './Base.js';
import {Labels} from './Labels.js';
import {gapiFetch} from './Net.js';
import {QueueSettings} from './QueueSettings.js';
import {COMPLETED_EVENT_NAME, RadialProgress} from './RadialProgress.js';
import {ServerStorage} from './ServerStorage.js';
import {Settings} from './Settings.js';
import {Thread} from './Thread.js';
import {HelpDialog} from './views/HelpDialog.js';

// Extract these before rendering any threads since the threads can have
// elements with IDs in them.
const title = getDefinitelyExistsElementById('title');
const loader = getDefinitelyExistsElementById('loader');

export class ThreadData {
  constructor(public id: string, public historyId: string) {}
  equals(other: ThreadData) {
    return this.id == other.id && this.historyId == other.historyId;
  }
}

interface TitleEntry {
  key: string;
  title: (HTMLElement|string)[];
}

class ThreadCache {
  cache_: Map<string, Thread>;

  constructor() {
    this.cache_ = new Map();
  }

  async get(threadData: ThreadData, onlyFetchThreadsFromDisk?: boolean) {
    // TODO: This cache grows indefinitely. It needs to be GC'ed, possibly after
    // each update call? A simple step could be to delete the cache once a day.
    // All the data is on disk, so it shouldn't be too expensive.
    let entry = this.cache_.get(threadData.id);
    if (entry) {
      if (entry.historyId != threadData.historyId)
        await entry.update();
      return entry;
    }

    let thread = new Thread(threadData, await getLabels());
    this.cache_.set(threadData.id, thread);

    await thread.fetch(false, onlyFetchThreadsFromDisk);
    return thread;
  }
}

let settings_: Settings;
let labels_: Labels;
let queuedLabelMap_: QueueSettings;
let loginDialog_: HTMLDialogElement;
let titleStack_: TitleEntry[] = [];
let loaderTitleStack_: TitleEntry[] = [];
let threadCache_: ThreadCache;

// Client ID and API key from the Developer Console
let CLIENT_ID: string;
let isGoogle = location.toString().includes(':8000/') ||
    location.toString().includes('https://com-mktime');
if (isGoogle)
  CLIENT_ID =
      '800053010416-p1p6n47o6ovdm04329v9p8mskl618kuj.apps.googleusercontent.com';
else
  CLIENT_ID =
      '475495334695-0i3hbt50i5lj8blad3j7bj8j4fco8edo.apps.googleusercontent.com';

// Array of API discovery doc URLs for APIs used by the quickstart
let DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest',
  'https://sheets.googleapis.com/$discovery/rest?version=v4',
  'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
  'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
let SCOPES =
    'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/spreadsheets https://www.google.com/m8/feeds https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/calendar.readonly';

let isSignedIn_ = false;

export async function getLabels() {
  await fetchTheSettingsThings();
  return labels_;
}

export async function getSettings() {
  await fetchTheSettingsThings();
  return settings_;
}

let settingThingsFetcher_: AsyncOnce<void>;
async function fetchTheSettingsThings() {
  if (!settingThingsFetcher_) {
    settingThingsFetcher_ = new AsyncOnce<void>(async () => {
      if (settings_ || labels_)
        throw 'Tried to fetch settings or labels twice.';

      await login();

      settings_ = new Settings();
      labels_ = new Labels();

      // Don't await this here so we fetch settings in parallel.
      let labelsPromise = labels_.fetch();

      await settings_.fetch();

      let storage = new ServerStorage(settings_.spreadsheetId);
      if (!storage.get(ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN)) {
        await showHelp();
        storage.writeUpdates(
            [{key: ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN, value: true}]);
      }

      await labelsPromise;
      await migrateLabels(labels_);
    });
  }
  await settingThingsFetcher_.do();
}


async function doLabelMigration(
    addLabelIds: string[], removeLabelIds: string[], query: string) {
  await fetchThreads(async (thread: Thread) => {
    await thread.modify(addLabelIds, removeLabelIds);
  }, query);
}

async function migrateLabels(labels: Labels) {
  // Rename parent labesl before sublabels.
  await labels.rename(
      Labels.OLD_MAKE_TIME_PREFIX, Labels.MAKE_TIME_PREFIX, doLabelMigration);
  await labels.rename(
      Labels.OLD_TRIAGED_LABEL, Labels.TRIAGED_LABEL, doLabelMigration);
  await labels.rename(
      Labels.OLD_QUEUED_LABEL, Labels.QUEUED_LABEL, doLabelMigration);

  await labels.rename(
      Labels.OLD_PRIORITY_LABEL, Labels.PRIORITY_LABEL, doLabelMigration);
  await labels.rename(
      Labels.OLD_NEEDS_TRIAGE_LABEL, Labels.NEEDS_TRIAGE_LABEL,
      doLabelMigration);
  await labels.rename(
      Labels.OLD_PROCESSED_LABEL, Labels.PROCESSED_LABEL, doLabelMigration);
  await labels.rename(
      Labels.OLD_MUTED_LABEL, Labels.MUTED_LABEL, doLabelMigration);
}

let queueSettingsFetcher_: AsyncOnce<void>;
export async function getQueuedLabelMap() {
  if (!queueSettingsFetcher_) {
    queueSettingsFetcher_ = new AsyncOnce<void>(async () => {
      queuedLabelMap_ = new QueueSettings((await getSettings()).spreadsheetId);
      await queuedLabelMap_.fetch();
    });
  }
  await queueSettingsFetcher_.do();
  return queuedLabelMap_;
}

function loadGapi() {
  return new Promise((resolve) => {
    gapi.load('client:auth2', () => resolve());
  });
};

let queuedLogin_: ((value?: {}|PromiseLike<{}>|undefined) => void);

export async function login() {
  if (isSignedIn_)
    return;

  let progress = updateLoaderTitle('login', 1, 'Logging in...');

  await loadGapi();
  await gapi.client.init(
      {discoveryDocs: DISCOVERY_DOCS, clientId: CLIENT_ID, scope: SCOPES});
  // Listen for sign-in state changes.
  gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);
  // Handle the initial sign-in state.
  let isSignedIn = gapi.auth2.getAuthInstance().isSignedIn.get();
  updateSigninStatus(isSignedIn);

  if (!isSignedIn) {
    await new Promise((resolve) => {
      if (queuedLogin_)
        throw 'login() was called twice while waiting for login to finish.';
      queuedLogin_ = resolve;
    });
  }

  progress.incrementProgress();
}

async function updateSigninStatus(isSignedIn: boolean) {
  isSignedIn_ = isSignedIn;
  if (isSignedIn_) {
    if (loginDialog_)
      loginDialog_.close();
    if (queuedLogin_)
      queuedLogin_();
  } else {
    let loginButton = document.createElement('button');
    loginButton.style.cssText = `font-size: 40px;`;
    loginButton.textContent = 'Log In';
    loginButton.onclick = () => gapi.auth2.getAuthInstance().signIn();
    loginDialog_ = showDialog(loginButton);
  }
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

export async function getCachedThread(
    response: ThreadData, onlyFetchThreadsFromDisk?: boolean) {
  if (!threadCache_)
    threadCache_ = new ThreadCache();
  return await threadCache_.get(response, onlyFetchThreadsFromDisk);
}

interface FetchRequestParameters {
  userId: string;
  q: string;
  pageToken?: string;
  maxResults?: number;
}

export async function fetchThreads(
    forEachThread: (thread: Thread) => void, query: string,
    onlyFetchThreadsFromDisk: boolean = false, maxResults: number = 0) {
  // If the query is empty or just whitespace, then
  if (query.trim() === '')
    throw 'This should never happen';

  // Chats don't expose their bodies in the gmail API, so just skip them.
  query = `(${query}) AND -in:chats`;

  // let daysToShow = (await
  // getSettings()).get(ServerStorage.KEYS.DAYS_TO_SHOW); if (daysToShow)
  //   query += ` newer_than:${daysToShow}d`;

  // let count = 0;

  let getPageOfThreads = async (opt_pageToken?: string) => {
    let requestParams = <FetchRequestParameters>{
      'userId': USER_ID,
      'q': query,
    };

    if (maxResults)
      requestParams.maxResults = maxResults;

    if (opt_pageToken)
      requestParams.pageToken = opt_pageToken;

    let resp =
        await gapiFetch(gapi.client.gmail.users.threads.list, requestParams);
    let threads = resp.result.threads || [];
    console.log('Got', threads.length, 'threads. Max should be', maxResults);
    for (let rawThread of threads) {
      let thread = await getCachedThread(rawThread, onlyFetchThreadsFromDisk);
      await forEachThread(thread);
    }

    // count += threads.length;
    // if (count > maxResults)
    //   return;

    // let nextPageToken = resp.result.nextPageToken;
    // if (nextPageToken)
    //   await getPageOfThreads(nextPageToken);
  };

  await getPageOfThreads();
}

export function showHelp() {
  new HelpDialog(
      `make-time is an opinionated way of handling unreasonable amounts of email.

<b style="font-size:120%">Disclaimers</b>
Patches welcome, but otherwise, I built it for my needs. :) Feature requests are very welcome though. Often you'll think of something I want that I don't have and I'll build it. Contact ojan@ or file issues at https://github.com/ojanvafai/make-time if you want to contribute, give feedback, etc.

<span style="color: red">This is a side project. While I use it for my day to day email management, you might not want to. It has bugs.</span> They may be hard to deal with if you're not willing to dig into the code when they happen.

<b style="font-size:120%">Keyboard shortcuts</b>
Type "?" anywhere in make-time to see keyboard shortcuts.

<b style="font-size:120%">Triage</b>

All the triage actions mark a thread as read, remove it from the inbox, and remove the maketime labels. <b>Aside from archiving messages (and bugs), maketime will only modify labels under the "maketime" parent label.</b> So you can do whatever you want with other labels.

The goal of triage is to get in the flow of doing all the triage quickly. After triage is done, you enter make-time mode where you work through each thread in priority order. This helps avoid flip-flopping back and forth between quick triage and deep thinking.

<b style="font-size:120%">Filtering</b>

Philosopy: Labels are a triage tool, not a search/organization tool. The goal is to have all your labels and inbox be empty when you're done with triage. The first filter that applies to a thread wins, so every thread gets exactly one label. This enables richer filtering by taking advantage of ordering, e.g. I can have emails to me from my team show up in my inbox immediately, but emails to me from others only show up once a day. See the fillter settings dialog for more information.

Make-time processes all emails in your inbox and all emails in the maketime/unprocessed label. You don't have to, but typically, people will delete all their gmail filters and just use make-time filtering. See the Settings dialog for adding filters and modifying queues. Queues can be setup to show up in a specific order and/or only show once a day/week/month. See the queues settings dialog for more information.

Whether you leave emails in your inbox by default or moved them into the unprocessed label so you don't see them in in gmail itself till they've been processed is up to you. If you want all your mail to be unprocessed by default, create a real gmail filter with:
    Has the words: -in:chats -label:mute -from:me
    Do this: Skip Inbox, Apply label "maketime/unprocessed"

<span style="color: red">Emails are only processed when make-time is open in a browser tab. Otherwise, your mail will stay in the unprocessed label. Would love to move this to a server cron, but this is a side project and I can't be bothered to figure out how to manage server-side gmail API oauth. <b>Patches *very* welcome for this.</b></span>
`);
}
