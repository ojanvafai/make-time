import { Thread } from "./Thread.js";
import { Labels } from "./Labels.js";
import { AsyncOnce } from "./AsyncOnce.js";
import { Settings } from "./Settings.js";
import { QueueSettings } from "./QueueSettings.js";
import { ThreadGroups } from "./ThreadGroups.js";
import { View } from "./views/View.js";

let settings_: Settings;
let labels_: Labels;
let queuedLabelMap_: QueueSettings;
let loginDialog_: HTMLDialogElement;
let currentView_: View;
let titleStack_: any[] = [];
let loaderTitleStack_: any[] = [];
export let threads_ = new ThreadGroups();

// Client ID and API key from the Developer Console
let CLIENT_ID: string;
let isGoogle = location.toString().includes(':5555/') || location.toString().includes('https://com-mktime');
if (isGoogle)
  CLIENT_ID = '800053010416-p1p6n47o6ovdm04329v9p8mskl618kuj.apps.googleusercontent.com';
else
  CLIENT_ID = '475495334695-0i3hbt50i5lj8blad3j7bj8j4fco8edo.apps.googleusercontent.com';

// Array of API discovery doc URLs for APIs used by the quickstart
let DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest",
    "https://sheets.googleapis.com/$discovery/rest?version=v4",
    "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
let SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/spreadsheets https://www.google.com/m8/feeds https://www.googleapis.com/auth/drive.metadata.readonly';

let isSignedIn_ = false;

export async function addThread(thread: Thread) {
  // Don't ever show best effort threads when on vacation.
  let settings = await getSettings();
  let ServerStorage = await serverStorage();
  let vacation = settings.get(ServerStorage.KEYS.VACATION);

  if (!vacation && threads_.getBestEffort() && await isBestEffortQueue(thread)) {
    if (await isBankrupt(thread)) {
      await bankruptThread(thread);
      return;
    } else if (threads_.getBestEffort()) {
      // Check again that getBestEffort is non-null in case best effort threads started being
      // triaged in the async time from the threads_.getBestEffort() call above.
      threads_.pushBestEffort(thread);
      return;
    }
  }

  await currentView_.addThread(thread);
}

export function showDialog(contents: HTMLElement) {
  let dialog = document.createElement('dialog');
  // Subtract out the top/bottom, padding and border from the max-height.
  dialog.style.cssText = `
    top: 15px;
    padding: 8px;
    border: 3px solid grey;
    max-height: calc(100vh - 30px - 16px - 6px);
    max-width: 800px;
    position: fixed;
    display: flex;
    overscroll-behavior: none;
  `;
  dialog.addEventListener('close', () => dialog.remove());

  dialog.append(contents);
  document.body.append(dialog);

  dialog.showModal();
  return dialog;
}

async function queueSettings() {
  return (await import('./QueueSettings.js')).QueueSettings;
}

async function isBestEffortQueue(thread: Thread) {
  let queue = await thread.getQueue();
  let parts = queue.split('/');
  let lastPart = parts[parts.length - 1];
  let data = (await getQueuedLabelMap()).get(lastPart);
  return data && data.goal == 'Best Effort';
}

// This function is all gross and hardcoded. Also, the constants themselves
// aren't great. Would be best to know how long the email was actually in the
// inbox rather than when the last email was sent, e.g. if someone was on vacation.
// Could track the last N dequeue dates for each queue maybe?
async function isBankrupt(thread: Thread) {
  let messages = await thread.getMessages();
  let date = messages[messages.length - 1].date;
  let queue = await thread.getQueue();
  let queueData = (await getQueuedLabelMap()).get(queue);

  let numDays = 7;
  let QueueSettings = await queueSettings();
  if (queueData.queue == QueueSettings.WEEKLY)
    numDays = 14;
  else if (queueData.queue == QueueSettings.MONTHLY)
    numDays = 42;

  let oneDay = 24 * 60 * 60 * 1000;
  let diffDays = (Date.now() - date.getTime()) / (oneDay);
  return diffDays > numDays;
}

async function bankruptThread(thread: Thread) {
  let queue = await thread.getQueue();
  queue = Labels.removeNeedsTriagePrefix(queue);
  let newLabel = Labels.addBankruptPrefix(queue);
  await thread.markTriaged(newLabel);
}

export async function getLabels() {
  await fetchTheSettingsThings();
  return labels_;
}

export async function getSettings() {
  await fetchTheSettingsThings();
  return settings_;
}

export async function serverStorage() {
  return (await import('./ServerStorage.js')).ServerStorage;
}

export function getView() {
  return currentView_;
}

export async function setView(view: View) {
  threads_.setListener(view);
  currentView_ = view;

  var content = <HTMLElement> document.getElementById('content');
  content.textContent = '';
  content.append(view);

  await login();
  await view.fetch();
}

let settingThingsFetcher_: AsyncOnce;
async function fetchTheSettingsThings() {
  if (!settingThingsFetcher_) {
    settingThingsFetcher_ = new AsyncOnce(async () => {
      if (settings_ || labels_)
        throw 'Tried to fetch settings or labels twice.';

      await login();

      let Settings = (await import('./Settings.js')).Settings;
      settings_ = new Settings();
      labels_ = new Labels();

      // Don't await this here so we fetch settings in parallel.
      let labelsPromise = labels_.fetch();

      await settings_.fetch();

      let ServerStorage = await serverStorage();
      let storage = new ServerStorage(settings_.spreadsheetId);
      if (!storage.get(ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN)) {
        await showHelp();
        storage.writeUpdates([{key: ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN, value: true}]);
      }

      await labelsPromise;
      await migrateLabels(labels_);
    });
  }
  await settingThingsFetcher_.do();
}

async function migrateLabels(labels: Labels) {
  // Rename parent labesl before sublabels.
  await labels.rename(Labels.OLD_MAKE_TIME_PREFIX, Labels.MAKE_TIME_PREFIX);
  await labels.rename(Labels.OLD_TRIAGED_LABEL, Labels.TRIAGED_LABEL);
  await labels.rename(Labels.OLD_QUEUED_LABEL, Labels.QUEUED_LABEL);

  await labels.rename(Labels.OLD_PRIORITY_LABEL, Labels.PRIORITY_LABEL);
  await labels.rename(Labels.OLD_NEEDS_TRIAGE_LABEL, Labels.NEEDS_TRIAGE_LABEL);
  await labels.rename(Labels.OLD_PROCESSED_LABEL, Labels.PROCESSED_LABEL);
  await labels.rename(Labels.OLD_MUTED_LABEL, Labels.MUTED_LABEL);
}

let queueSettingsFetcher_: AsyncOnce;
export async function getQueuedLabelMap() {
  if (!queueSettingsFetcher_) {
    queueSettingsFetcher_ = new AsyncOnce(async () => {
      let QueueSettings = await queueSettings();
      queuedLabelMap_ = new QueueSettings((await getSettings()).spreadsheetId);
      await queuedLabelMap_.fetch();
    });
  }
  await queueSettingsFetcher_.do();
  return queuedLabelMap_;
}

export async function showHelp() {
  let help = await import('./help.js');
  help.showHelp();
}

function loadGapi() {
  return new Promise((resolve) => {
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    gapi.load('client:auth2', () => resolve());
  });
};

let queuedLogin_: ((value?: {} | PromiseLike<{}> | undefined) => void);

async function login() {
  if (isSignedIn_)
    return;

  updateLoaderTitle('login', 'Logging in...');

  await loadGapi();
  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  await gapi.client.init({
    discoveryDocs: DISCOVERY_DOCS,
    clientId: CLIENT_ID,
    scope: SCOPES
  });
  // Listen for sign-in state changes.
  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);
  // Handle the initial sign-in state.
  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  let isSignedIn = gapi.auth2.getAuthInstance().isSignedIn.get();
  updateSigninStatus(isSignedIn);

  if (!isSignedIn) {
    await new Promise((resolve) => {
      if (queuedLogin_)
        throw 'login() was called twice while waiting for login to finish.'
      queuedLogin_ = resolve;
    });
  }

  updateLoaderTitle('login');
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
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    loginButton.onclick = () => gapi.auth2.getAuthInstance().signIn();
    loginDialog_ = showDialog(loginButton);
  }
}

export function updateTitle(key: string, ...opt_title: string[]) {
  let node = document.getElementById('title');
  updateTitleBase(titleStack_, node!, key, ...opt_title);
}

export function updateLoaderTitle(key: string, ...opt_title: string[]) {
  let node = document.getElementById('loader-title');
  updateTitleBase(loaderTitleStack_, node!, key, ...opt_title);

  let titleContainer = <HTMLElement> document.getElementById('loader');
  titleContainer.style.display = loaderTitleStack_.length ? '' : 'none';
}

function updateTitleBase(stack: any[], node: HTMLElement, key: string, ...opt_title: string[]) {
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
