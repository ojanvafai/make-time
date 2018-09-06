// Client ID and API key from the Developer Console
let CLIENT_ID = location.host == 'make-time.appspot.com' ? '410602498749-pe1lolovqrgun0ia1jipke33ojpcmbpq.apps.googleusercontent.com' : '749725088976-5n899es2a9o5p85epnamiqekvkesluo5.apps.googleusercontent.com';

// Array of API discovery doc URLs for APIs used by the quickstart
let DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest",
    "https://sheets.googleapis.com/$discovery/rest?version=v4",
    "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
let SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/spreadsheets https://www.google.com/m8/feeds https://www.googleapis.com/auth/drive.metadata.readonly';

let USER_ID = 'me';
let authorizeButton = document.getElementById('authorize-button');

let currentView_;
let settings_;
let labels_;
let queuedLabelMap_;
let triagedQueuesView_;
let bestEffortThreads_ = [];
let contacts_ = [];
let titleStack_ = [];
let isProcessingMail_ = false;

function showDialog(contents) {
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

async function viewThreadAtATime(threads) {
  let threadList = new ThreadList();
  for (let thread of threads) {
    await threadList.push(thread);
  }

  let autoStartTimer = settings_.get(ServerStorage.KEYS.AUTO_START_TIMER);
  let timeout = settings_.get(ServerStorage.KEYS.TIMER_DURATION);
  let allowedReplyLength =  settings_.get(ServerStorage.KEYS.ALLOWED_REPLY_LENGTH);
  setView(new ThreadView(threadList, viewAll, updateCounter, autoStartTimer, timeout, allowedReplyLength, contacts_, triagedQueuesView()));

  // Ensure contacts are fetched.
  await fetchContacts(gapi.auth.getToken());
}

async function viewAll(threads) {
  setView(new Vueue(threads, viewThreadAtATime, updateTitle, triagedQueuesView()));
  updateCounter(['']);
}

function triagedQueuesView() {
  // Don't show triaged queues view when in vacation mode as that's non-vacation work.
  if (settings_.get(ServerStorage.KEYS.VACATION_SUBJECT))
    return null;

  if (!triagedQueuesView_)
    triagedQueuesView_ = new TriagedQueues(labels_, bestEffortThreads_, triageBestEffortThreads);
  return triagedQueuesView_;
}

async function triageBestEffortThreads() {
  let temp = bestEffortThreads_;

  // Null this out before any awaits to avoid adding more threads to bestEffortThreads_
  // via addThreads once we've started triaging best effort threads.
  bestEffortThreads_ = null;

  for (let thread of temp) {
    await currentView_.push(thread);
  }
}

function setView(view) {
  currentView_ = view;
  var content = document.getElementById('content');
  content.textContent = '';
  content.append(view);
}

async function updateSigninStatus(isSignedIn) {
  if (!isSignedIn) {
    authorizeButton.parentNode.style.display = '';
    return;
  }
  authorizeButton.parentNode.style.display = 'none';
  await onLoad();
}

async function updateCounter(contents) {
  let counter = document.getElementById('counter');
  counter.textContent = '';
  counter.append(...contents);
}

async function updateTitle(key, opt_title, opt_needsLoader) {
  let index = titleStack_.findIndex((item) => item.key == key);
  if (!opt_title) {
    if (index != -1)
      titleStack_.splice(index, 1);
  } else if (index == -1) {
    titleStack_.push({
      key: key,
      title: opt_title,
      needsLoader: !!opt_needsLoader,
    });
  } else {
    let entry = titleStack_[index];
    entry.title = opt_title;
    entry.needsLoader = !!opt_needsLoader;
  }

  let title = titleStack_.length ? titleStack_[titleStack_.length - 1].title : '';
  document.getElementById('title').textContent = title;

  let needsLoader = titleStack_.findIndex((item) => item.needsLoader) != -1;
  showLoader(needsLoader);
}

function showLoader(show) {
  document.getElementById('loader').style.display = show ? 'inline-block' : 'none';
}

async function fetchThreads(forEachThread, options) {
  let query = '';

  if (options.query)
    query += ' ' + options.query;

  if (options.queue)
    query += ' in:' + options.queue;

  // We only have triaged labels once they've actually been created.
  if (labels_.getTriagedLabelNames().length)
    query += ' -(in:' + labels_.getTriagedLabelNames().join(' OR in:') + ')';

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
      let thread = new Thread(rawThread, labels_);
      if (options.queue)
        thread.setQueue(options.queue);
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
  let data = getQueuedLabelMap()[lastPart];
  return data && data.goal == 'Best Effort';
}

// This function is all gross and hardcoded. Also, the constants themselves
// aren't great. Would be best to know how long the email was actually in the
// inbox rather than when the last email was sent, e.g. if someone was on vacation.
// Could track when the last dequeue date was for each queue maybe?
async function isBankrupt(thread) {
  let messages = await thread.getMessages();
  let date = messages[messages.length - 1].date;
  let queue = await thread.getQueue();

  let numDays = 7;
  if (queue.includes('/' + Labels.WEEKLY_QUEUE_PREFIX + '/'))
    numDays = 14;
  else if (queue.includes('/' + Labels.MONTHLY_QUEUE_PREFIX + '/'))
    numDays = 42;

  let oneDay = 24 * 60 * 60 * 1000;
  let diffDays = (Date.now() - date.getTime()) / (oneDay);
  return diffDays > numDays;
}

async function addThread(thread) {
  let vacationSubject = settings_.get(ServerStorage.KEYS.VACATION_SUBJECT);
  if (vacationSubject) {
    let subject = await thread.getSubject();
    if (!subject.toLowerCase().includes(vacationSubject.toLowerCase()))
      return;
  }

  if (bestEffortThreads_ && await isBestEffortQueue(thread)) {
    if (await isBankrupt(thread)) {
      await thread.markTriaged(Labels.BANKRUPT_LABEL);
    } else {
      bestEffortThreads_.push(thread);
      triagedQueuesView().update();
    }
  } else {
    await currentView_.push(thread);
  }
}

async function onLoad() {
  showLoader(true);

  settings_ = new Settings();
  labels_ = new Labels();

  await Promise.all([settings_.fetch(), labels_.fetch()]);
  await fetchQueuedLabelMap(settings_.spreadsheetId);

  let storage = new ServerStorage(settings_.spreadsheetId);
  if (!storage.get(ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN)) {
    await showHelp(settings_);
    storage.writeUpdates([{key: ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN, value: true}]);
  }

  let settingsLink = document.getElementById('settings');
  settingsLink.textContent = 'Settings';
  settingsLink.onclick = async () => new SettingsView(settings_, getQueuedLabelMap());

  let helpLink = document.getElementById('help');
  helpLink.textContent = 'Help';
  helpLink.onclick = () => showHelp(settings_);

  let vacationQuery = '';
  if (settings_.get(ServerStorage.KEYS.VACATION_SUBJECT)) {
    vacationQuery = `subject:${settings_.get(ServerStorage.KEYS.VACATION_SUBJECT)}`;
    updateTitle('vacation', `Only showing threads with ${vacationQuery}`);
  }

  updateTitle('onLoad', 'Fetching threads to triage...', true);

  let labels = await labels_.getTheadCountForLabels((labelName) => labelName.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/'));
  let labelsToFetch = labels.filter(data => data.count).map(data => data.name);
  labelsToFetch.sort(Labels.compare);

  await viewAll([]);

  for (let label of labelsToFetch) {
    await fetchThreads(addThread, {
      query: vacationQuery,
      queue: label,
    });
  }

  await fetchThreads(addThread, {
    query: `-has:userlabels ${vacationQuery}`,
    queue: 'inbox',
  });

  currentView_.finishedInitialLoad();

  updateTitle('onLoad');
  // Don't want to show the earlier title, but still want to indicate loading is happening.
  // since we're going to processMail still. It's a less jarring experience if the loading
  // spinner doesn't go away and then come back when conteacts are done being fetched.
  showLoader(true);

  // Wait until we've fetched all the threads before trying to process updates regularly.
  setInterval(update, 1000 * 60);

  await fetchContacts(gapi.auth.getToken());
  await processMail();
}

async function fetchContacts(token) {
  if (contacts_.length)
    return;

  // This is 450kb! Either cache this and fetch infrequently, or find a way of getting the API to not send me all
  // the data I don't want.
  let resp = await fetch("https://www.google.com/m8/feeds/contacts/default/thin?alt=json&access_token=" + token.access_token + "&max-results=20000&v=3.0");

  let json = await resp.json();
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
}

function getQueuedLabelMap() {
  if (!queuedLabelMap_)
    throw 'Attempted to use queuedLabelMap_ before it was fetched';
  return queuedLabelMap_;
}

async function fetchQueuedLabelMap(spreadsheetId) {
  if (queuedLabelMap_)
    throw 'Attempted to fetch queuedLabelMap_ multiple times';

  let values = await SpreadsheetUtils.fetchSheet(spreadsheetId, `${Settings.QUEUED_LABELS_SHEET_NAME}!A2:C`);

  queuedLabelMap_ = {};
  for (let value of values) {
    queuedLabelMap_[value[0]] = {
      queue: value[1],
      goal: value[2],
    }
  }
}

// TODO: Move this to a cron
async function processMail() {
  if (isProcessingMail_)
    return;

  isProcessingMail_ = true;
  updateTitle('processMail', 'Processing mail backlog...', true);

  let mailProcessor = new MailProcessor(settings_, addThread, getQueuedLabelMap(), labels_);
  await mailProcessor.processMail();
  await mailProcessor.processQueues();
  await mailProcessor.collapseStats();

  updateTitle('processMail');
  isProcessingMail_ = false;
}

function update() {
  currentView_.updateCurrentThread();
  processMail();
}

// Make sure links open in new tabs.
document.body.addEventListener('click', (e) => {
  for (let node of e.path) {
    if (node.tagName == 'A') {
      node.target = '_blank';
      node.rel = 'noopener';
    }
  }
});

document.addEventListener('visibilitychange', (e) => {
  if (!currentView_)
    return;
  if (document.visibilityState == 'hidden')
    currentView_.onHide();
  else
    currentView_.onShow();
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

  // Don't allow actions to apply in rapid succession for each thread.
  // This prevents accidents of archiving a lot of threads at once
  // when your stupid keyboard gets stuck holding the archive key down. #sigh
  if (e.repeat)
    return;

  if (e.key == '?') {
    showHelp(settings_);
    return;
  }

  if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey)
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
  alert(emailBody);
});

window.addEventListener('unhandledrejection', (e) => {
  // 401 means the credentials are invalid and you probably need to 2 factor.
  if (e.reason && e.reason.status == 401)
    window.location.reload();
  alert(e.reason);
});

window.addEventListener('offline', (e) => {
  updateTitle('offline', 'No network connection...');
});

window.addEventListener('online', (e) => {
  updateTitle('offline');
  update();
});
