import { ErrorLogger } from './ErrorLogger.js';
import { gapiFetch } from './Net.js';
import { IDBKeyVal } from './idb-keyval.js';
import { Labels } from './Labels.js';
import { Router } from './Router.js';
import { QueueSettings } from './QueueSettings.js';
import { ServerStorage } from './ServerStorage.js';
import { Settings } from './Settings.js';
import { ThreadCache } from './ThreadCache.js';
import { ThreadGroups } from './ThreadGroups.js';

// Client ID and API key from the Developer Console
let CLIENT_ID = location.toString().includes('appspot') ? '410602498749-pe1lolovqrgun0ia1jipke33ojpcmbpq.apps.googleusercontent.com' : '749725088976-5n899es2a9o5p85epnamiqekvkesluo5.apps.googleusercontent.com';

// Array of API discovery doc URLs for APIs used by the quickstart
let DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest",
    "https://sheets.googleapis.com/$discovery/rest?version=v4",
    "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
let SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/spreadsheets https://www.google.com/m8/feeds https://www.googleapis.com/auth/drive.metadata.readonly';

export let USER_ID = 'me';
let authorizeButton = document.getElementById('authorize-button');

let currentView_;
let settings_;
let labels_;
let queuedLabelMap_;
let threadCache_ = new ThreadCache();
let contacts_ = [];
let titleStack_ = [];
let loaderTitleStack_ = [];
let isProcessingMail_ = false;
let threads_ = new ThreadGroups();
let WEEKS_TO_STORE_ = 2;

var router = new Router();

async function routeToCurrentLocation() {
  await router.run(window.location, true);
}

window.onpopstate = () => {
  routeToCurrentLocation();
}

router.add('/compose', async (params) => {
  if (currentView_) {
    await currentView_.tearDown();
  }
  await viewCompose(params);
});
router.add('/', routeToTriage);
router.add('/triage', routeToTriage);
router.add('/make-time', async (params) => {
  if (currentView_)
    await currentView_.tearDown();
  await viewMakeTime();
});
// TODO: best-effort should not be a URL since it's not a proper view.
// or should it be a view instead?
router.add('/best-effort', async (params) => {
  if (currentView_)
    await currentView_.tearDown();

  threads_.processBestEffort();
  await router.run('/triage');
});

async function routeToTriage() {
  if (currentView_) {
    await currentView_.tearDown();
  }
  await viewTriage();
}

let DRAWER_OPEN = 'drawer-open';
let CURRENT_PAGE_CLASS = 'current-page';

function showBackArrow(show) {
  document.getElementById('hambuger-menu-toggle').style.display = show ? 'none' : '';
  document.getElementById('back-arrow').style.display = show ? '' : 'none';
}

function openMenu() {
  let menuItems = document.getElementById('drawer').querySelectorAll('a.item');
  for (let item of menuItems) {
    if (item.pathname == location.pathname) {
      item.classList.add(CURRENT_PAGE_CLASS);
    } else {
      item.classList.remove(CURRENT_PAGE_CLASS);
    }
  }

  let mainContent = document.getElementById('main-content');
  mainContent.classList.add(DRAWER_OPEN);
}

function closeMenu() {
  let mainContent = document.getElementById('main-content');
  mainContent.classList.remove(DRAWER_OPEN);
}

function toggleMenu() {
  let mainContent = document.getElementById('main-content');
  if (mainContent.classList.contains(DRAWER_OPEN))
    closeMenu();
  else
    openMenu();
}

document.getElementById('back-arrow').addEventListener('click', async (e) => {
  if (currentView_.goBack)
    await currentView_.goBack();
});

document.getElementById('hambuger-menu-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu();
});

document.getElementById('main-content').addEventListener('click', (e) => {
  let mainContent = document.getElementById('main-content');
  if (mainContent.classList.contains(DRAWER_OPEN)) {
    e.preventDefault();
    closeMenu();
  }
})

export function showDialog(contents) {
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

async function viewCompose(params) {
  let ComposeView = (await import('./views/ComposeView.js')).ComposeView;
  setView(new ComposeView(contacts_, updateLoaderTitle, params));
}

async function viewTriage() {
  updateLoaderTitle('viewTriage', 'Fetching threads to triage...');
  let TriageView = (await import('./views/TriageView.js')).TriageView;

  let settings = await getSettings();
  let autoStartTimer = settings.get(ServerStorage.KEYS.AUTO_START_TIMER);
  let timerDuration = settings.get(ServerStorage.KEYS.TIMER_DURATION);
  let allowedReplyLength =  settings.get(ServerStorage.KEYS.ALLOWED_REPLY_LENGTH);
  let vacation = settings.get(ServerStorage.KEYS.VACATION_SUBJECT);
  setView(new TriageView(threads_, await getMailProcessor(), getScroller(), await getLabels(), vacation, updateLoaderTitle, setSubject, showBackArrow, allowedReplyLength, contacts_, autoStartTimer, timerDuration, await getQueuedLabelMap()));

  updateLoaderTitle('viewTriage', '');
}

async function viewMakeTime() {
  let MakeTimeView = (await import('./views/MakeTimeView.js')).MakeTimeView;

  let settings = await getSettings();
  // Don't show triaged queues view when in vacation mode as that's non-vacation work.
  let vacation = settings.get(ServerStorage.KEYS.VACATION_SUBJECT);
  let autoStartTimer = settings.get(ServerStorage.KEYS.AUTO_START_TIMER);
  let timerDuration = settings.get(ServerStorage.KEYS.TIMER_DURATION);
  let allowedReplyLength =  settings.get(ServerStorage.KEYS.ALLOWED_REPLY_LENGTH);
  setView(new MakeTimeView(threads_, await getMailProcessor(), getScroller(), await getLabels(), vacation, updateLoaderTitle, setSubject, showBackArrow, allowedReplyLength, contacts_, autoStartTimer, timerDuration));
}

function setView(view) {
  threads_.setListener(view);
  currentView_ = view;

  var content = document.getElementById('content');
  content.textContent = '';
  content.append(view);
}

function getScroller() {
  return document.getElementById('content');
}

async function updateSigninStatus(isSignedIn) {
  if (!isSignedIn) {
    authorizeButton.parentNode.style.display = '';
    return;
  }
  authorizeButton.parentNode.style.display = 'none';
  await onLoad();
}

function setSubject(...items) {
  let subject = document.getElementById('subject');
  subject.textContent = '';
  subject.append(...items);
}

function updateTitle(key, opt_title) {
  let node = document.getElementById('title');
  updateTitleBase(titleStack_, node, key, opt_title);
}

function updateLoaderTitle(key, opt_title) {
  let node = document.getElementById('loader-title');
  updateTitleBase(loaderTitleStack_, node, key, opt_title);

  let titleContainer = document.getElementById('loader');
  titleContainer.style.display = loaderTitleStack_.length ? '' : 'none';
}

function updateTitleBase(stack, node, key, ...opt_title) {
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

export async function fetchThread(id) {
  let requestParams = {
    'userId': USER_ID,
    'id': id,
  };
  let resp = await gapiFetch(gapi.client.gmail.users.threads.get, requestParams);
  let thread = threadCache_.get(resp.result, await getLabels());
  // If we have a stale thread we just fetched, then it's not stale anymore.
  // This can happen if we refetch a thread that wasn't actually modified
  // by a modify call.
  thread.stale = false;
  return thread;
}

export async function fetchThreads(forEachThread, options) {
  // Chats don't expose their bodies in the gmail API, so just skip them.
  let query = '-in:chats ';

  if (options.query)
    query += ' ' + options.query;

  let daysToShow = (await getSettings()).get(ServerStorage.KEYS.DAYS_TO_SHOW);
  if (daysToShow)
    query += ` newer_than:${daysToShow}d`;

  let labels = await getLabels();

  let getPageOfThreads = async (opt_pageToken) => {
    let requestParams = {
      'userId': USER_ID,
      'q': query,
    };

    if (opt_pageToken)
      requestParams.pageToken = opt_pageToken;

    let resp = await gapiFetch(gapi.client.gmail.users.threads.list, requestParams);
    let threads = resp.result.threads || [];
    for (let rawThread of threads) {
      let thread = threadCache_.get(rawThread, labels);
      await forEachThread(thread);
    }

    let nextPageToken = resp.result.nextPageToken;
    if (nextPageToken)
      await getPageOfThreads(nextPageToken);
  };

  await getPageOfThreads();
}

async function isBestEffortQueue(thread) {
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
async function isBankrupt(thread) {
  let messages = await thread.getMessages();
  let date = messages[messages.length - 1].date;
  let queue = await thread.getQueue();
  let queueData = (await getQueuedLabelMap()).get(queue);

  let numDays = 7;
  if (queueData.queue == QueueSettings.WEEKLY)
    numDays = 14;
  else if (queueData.queue == QueueSettings.MONTHLY)
    numDays = 42;

  let oneDay = 24 * 60 * 60 * 1000;
  let diffDays = (Date.now() - date.getTime()) / (oneDay);
  return diffDays > numDays;
}

async function bankruptThread(thread) {
  let queue = await thread.getQueue();
  queue = Labels.removeNeedsTriagePrefix(queue);
  let newLabel = Labels.addBankruptPrefix(queue);
  await thread.markTriaged(newLabel);
}

// TODO: Don't export this.
export async function addThread(thread) {
  let vacationSubject = (await getSettings()).get(ServerStorage.KEYS.VACATION_SUBJECT);
  if (vacationSubject) {
    let subject = await thread.getSubject();
    if (!subject || !subject.toLowerCase().includes(vacationSubject.toLowerCase()))
      return;
  }

  if (threads_.getBestEffort() && await isBestEffortQueue(thread)) {
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

  if (currentView_.addThread)
    await currentView_.addThread(thread);
}

function createMenuItem(name, options) {
  let a = document.createElement('a');
  a.append(name);
  a.className = 'item';

  if (options.nested)
    a.classList.add('nested');

  if (options.href)
    a.href = options.href;

  if (options.onclick)
    a.onclick = options.onclick;

  a.addEventListener('click', closeMenu);

  return a;
}

async function getLabels() {
  if (!labels_)
    await fetchTheSettingsThings();
  return labels_;
}

async function getSettings() {
  if (!settings_)
    await fetchTheSettingsThings();
  return settings_;
}

async function showHelp() {
  let help = await import('./help.js');
  help.showHelp(await getSettings());
}

async function fetchTheSettingsThings() {
  if (settings_ || labels_)
    throw 'Tried to fetch settings or labels twice.';

  settings_ = new Settings();
  labels_ = new Labels();

  // Don't await this here so we fetch settings in parallel.
  let labelsPromise = labels_.fetch();

  await settings_.fetch();

  let storage = new ServerStorage(settings_.spreadsheetId);
  if (!storage.get(ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN)) {
    await showHelp();
    storage.writeUpdates([{key: ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN, value: true}]);
  }

  await labelsPromise;
}

async function migrateLabels() {
  let labels = await getLabels();

  // Rename parent labesl before sublabels.
  await labels.rename(Labels.OLD_MAKE_TIME_PREFIX, Labels.MAKE_TIME_PREFIX);
  await labels.rename(Labels.OLD_TRIAGED_LABEL, Labels.TRIAGED_LABEL);
  await labels.rename(Labels.OLD_QUEUED_LABEL, Labels.QUEUED_LABEL);

  await labels.rename(Labels.OLD_PRIORITY_LABEL, Labels.PRIORITY_LABEL);
  await labels.rename(Labels.OLD_NEEDS_TRIAGE_LABEL, Labels.NEEDS_TRIAGE_LABEL);
  await labels.rename(Labels.OLD_PROCESSED_LABEL, Labels.PROCESSED_LABEL);
  await labels.rename(Labels.OLD_MUTED_LABEL, Labels.MUTED_LABEL);

  // Delete labels after the renames since the label names to delete are using the new names.
  if (labels.isParentLabel(Labels.DAILY))
    await labels.delete(Labels.DAILY, true);
  if (labels.isParentLabel(Labels.WEEKLY))
    await labels.delete(Labels.WEEKLY, true);
  if (labels.isParentLabel(Labels.MONTHLY))
    await labels.delete(Labels.MONTHLY, true);

  let markMustDo = async (thread) => {
    await thread.markTriaged(Labels.MUST_DO_LABEL);
  };
  await fetchThreads(markMustDo, {
    query: `in:${Labels.ACTION_ITEM_LABEL} -(in:${labels.getPriorityLabelNames().join(' OR in:')})`,
  });
  await labels.delete(Labels.ACTION_ITEM_LABEL);

  // This label's life was very brief.
  await labels.delete(Labels.addMakeTimePrefix('archive'));

  for (let label of Labels.HIDDEN_LABELS) {
    await labels.updateVisibility(label);
  }
}

async function onLoad() {
  await migrateLabels();

  let settingsButton = createMenuItem('Settings', {
    onclick: async () => {
      let SettingsView = (await import('./views/Settings.js')).SettingsView;
      new SettingsView(await getSettings(), await getQueuedLabelMap());
    }
  });

  let helpButton = createMenuItem('Help', {
    onclick: async () => showHelp(),
  });

  let menuTitle = document.createElement('div');
  menuTitle.append('MakeTime phases');

  document.getElementById('drawer').append(
    menuTitle,
    createMenuItem('Compose', {href: '/compose', nested: true}),
    createMenuItem('Triage', {href: '/triage', nested: true}),
    createMenuItem('MakeTime', {href: '/make-time', nested: true}),
    settingsButton,
    helpButton);

  await routeToCurrentLocation();

  // Don't want to show the earlier title, but still want to indicate loading is happening.
  // since we're going to processMail still. It's a less jarring experience if the loading
  // spinner doesn't go away and then come back when conteacts are done being fetched.
  updateLoaderTitle('onLoad', '\xa0');

  await fetchContacts(gapi.auth.getToken());

  update();
  // Wait until we've fetched all the threads before trying to process updates regularly.
  setInterval(update, 1000 * 60);

  updateLoaderTitle('onLoad');
}

let CONTACT_STORAGE_KEY_ = 'contacts';

async function fetchContacts(token) {
  if (contacts_.length)
    return;

  // This is 450kb! Either cache this and fetch infrequently, or find a way of getting the API to not send
  // the data we don't need.
  let response;
  try {
    response = await fetch("https://www.google.com/m8/feeds/contacts/default/thin?alt=json&access_token=" + token.access_token + "&max-results=20000&v=3.0");
  } catch(e) {
    let message = `Failed to fetch contacts. Google Contacts API is hella unsupported. See https://issuetracker.google.com/issues/115701813.`;

    let contacts = localStorage.getItem(CONTACT_STORAGE_KEY_);
    if (!contacts) {
      ErrorLogger.log(message);
      return;
    }

    ErrorLogger.log(`Using locally stored version of contacts. ${message}`);
    contacts_ = JSON.parse(contacts);
    return;
  }

  let json = await response.json();
  for (let entry of json.feed.entry) {
    if (!entry.gd$email)
      continue;
    let contact = {};
    if (entry.title.$t)
      contact.name = entry.title.$t;
    contact.emails = [];
    for (let email of entry.gd$email) {
      contact.emails.push(email.address);
    }
    contacts_.push(contact);
  }

  // Store the final contacts object instead of the data fetched off the network since the latter
  // can is order of magnitude larger and can exceed the allowed localStorage quota.
  localStorage.setItem(CONTACT_STORAGE_KEY_, JSON.stringify(contacts_));
}

async function getQueuedLabelMap() {
  if (!queuedLabelMap_) {
    queuedLabelMap_ = new QueueSettings((await getSettings()).spreadsheetId);
    await queuedLabelMap_.fetch();
  }
  return queuedLabelMap_;
}

async function getMailProcessor() {
  let MailProcessor = (await import('./MailProcessor.js')).MailProcessor;
  return new MailProcessor(await getSettings(), addThread, await getQueuedLabelMap(), await getLabels(), updateLoaderTitle);
}

// TODO: Move this to a cron
async function processMail() {
  if (isProcessingMail_)
    return;

  isProcessingMail_ = true;

  let mailProcessor = await getMailProcessor();
  await mailProcessor.processUnprocessed();
  await mailProcessor.processQueues();
  await mailProcessor.collapseStats();

  isProcessingMail_ = false;
}

// TODO: Put this somewhere better.
export function getCurrentWeekNumber() {
  let today = new Date();
  var januaryFirst = new Date(today.getFullYear(), 0, 1);
  var msInDay = 86400000;
  return Math.ceil((((today - januaryFirst) / msInDay) + januaryFirst.getDay()) / 7);
}

async function gcLocalStorage() {
  let storage = new ServerStorage((await getSettings()).spreadsheetId);
  let lastGCTime = storage.get(ServerStorage.KEYS.LAST_GC_TIME);
  let oneDay = 24 * 60 * 60 * 1000;
  if (!lastGCTime || Date.now() - lastGCTime > oneDay) {
    let currentWeekNumber = getCurrentWeekNumber();
    let keys = await IDBKeyVal.getDefault().keys();
    for (let key of keys) {
      let match = key.match(/^thread-(\d+)-\d+$/);
      if (!match)
        continue;

      let weekNumber = Number(match[1]);
      if (weekNumber + WEEKS_TO_STORE_ < currentWeekNumber)
        await IDBKeyVal.getDefault().del(key);
    }
    await storage.writeUpdates([{key: ServerStorage.KEYS.LAST_GC_TIME, value: Date.now()}]);
  }
}

async function update() {
  if (currentView_.update)
    await currentView_.update();
  await processMail();
  await gcLocalStorage();
}

// Make it easier to debug from devtools by making the update method accessible there.
globalThis.update = update;

// Make sure links open in new tabs.
document.body.addEventListener('click', async (e) => {
  for (let node of e.path) {
    if (node.tagName == 'A') {
      let willHandlePromise = router.run(node);
      if (willHandlePromise) {
        // Need to preventDefault before the await, otherwise the browsers
        // default action kicks in.
        e.preventDefault();
        await willHandlePromise;
        return;
      }
      node.target = '_blank';
      node.rel = 'noopener';
    }
  }
});

// This list is probably not comprehensive.
let NON_TEXT_INPUT_TYPES = [
  'button',
  'checkbox',
  'file',
  'image',
  'radio',
  'submit',
];

function isEditable(target) {
  if (target.tagName == 'INPUT' && !NON_TEXT_INPUT_TYPES.includes(target.type))
    return true;

  if (target.tagName == 'TEXTAREA')
    return true;

  while (target) {
    if (getComputedStyle(target).webkitUserModify.startsWith('read-write'))
      return true;
    target = target.parentElement;
  }

  return false;
}

document.body.addEventListener('keydown', async (e) => {
  if (!currentView_)
    return;

  if (isEditable(e.target))
    return;

  if (e.key == '?') {
    showHelp();
    return;
  }

  if (currentView_.dispatchShortcut && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey)
    await currentView_.dispatchShortcut(e);
});

window.addEventListener('load', () => {
  gapi.load('client:auth2', () => {
    gapi.client.init({
      discoveryDocs: DISCOVERY_DOCS,
      clientId: CLIENT_ID,
      scope: SCOPES
    }).then(function () {
      // Listen for sign-in state changes.
      gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);
      // Handle the initial sign-in state.
      updateSigninStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
      authorizeButton.onclick = () => gapi.auth2.getAuthInstance().signIn();
    });
  });
});

window.addEventListener('error', (e) => {
  var emailBody = 'Something went wrong...';
  if (e.body)
    emailBody += '\n' + e.body;
  if (e.error)
    emailBody += '\n' + e.error;
  if (e.stack)
    emailBody += '\n\n' + e.stack;
  ErrorLogger.log(emailBody);
});

window.addEventListener('unhandledrejection', (e) => {
  // 401 means the credentials are invalid and you probably need to 2 factor.
  if (e.reason && e.reason.status == 401)
    window.location.reload();
  ErrorLogger.log(e.reason);
});

window.addEventListener('offline', (e) => {
  updateTitle('offline', 'No network connection...');
});

window.addEventListener('online', (e) => {
  updateTitle('offline');
  update();
});
