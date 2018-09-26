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
let contacts_ = [];
let titleStack_ = [];
let loaderTitleStack_ = [];
let isProcessingMail_ = false;
let threads_ = new ThreadGroups();

var router = new PathParser();
router.add('/viewone', async (foo) => {
  if (currentView_)
    await currentView_.tearDown();
  await viewThreadAtATime();
});
router.add('/viewall', async (foo) => {
  if (currentView_)
    await currentView_.tearDown();
  await viewAll();
});
router.add('/triaged', async (foo) => {
  if (currentView_)
    await currentView_.tearDown();
  await viewTriaged();
});
router.add('/maketime', async (foo) => {
  if (currentView_)
    await currentView_.tearDown();
  await viewMakeTime();
});
router.add('/besteffort', async (foo) => {
  if (currentView_)
    await currentView_.tearDown();

  threads_.processBestEffort();
  await viewAll();
});

let DRAWER_OPEN = 'drawer-open';

function openMenu() {
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

async function viewThreadAtATime() {
  let autoStartTimer = settings_.get(ServerStorage.KEYS.AUTO_START_TIMER);
  let timeout = settings_.get(ServerStorage.KEYS.TIMER_DURATION);
  let allowedReplyLength =  settings_.get(ServerStorage.KEYS.ALLOWED_REPLY_LENGTH);
  setView(new ViewOne(threads_, autoStartTimer, timeout, allowedReplyLength, contacts_, setSubject, updateTitle));

  // Ensure contacts are fetched.
  await fetchContacts(gapi.auth.getToken());
}

async function viewAll() {
  setView(new ViewAll(threads_, updateLoaderTitle));
}

async function viewTriaged() {
  // Don't show triaged queues view when in vacation mode as that's non-vacation work.
  let vacation = settings_.get(ServerStorage.KEYS.VACATION_SUBJECT);
  setView(new Triaged(threads_, labels_, vacation, updateLoaderTitle));
}

async function viewMakeTime() {
  setView(new MakeTime(threads_, labels_, updateLoaderTitle));
}

function setView(view) {
  threads_.setListener(view);
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

async function fetchThreads(forEachThread, options) {
  let query = '';

  if (options.query)
    query += ' ' + options.query;

  if (options.queue)
    query += ' in:' + options.queue;


  let daysToShow = settings_.get(ServerStorage.KEYS.DAYS_TO_SHOW);
  if (daysToShow)
    query += ` newer_than:${daysToShow}d`;


  // We only have triaged labels once they've actually been created.
  if (!options.includeTriaged && labels_.getTriagedLabelNames().length)
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

  if (threads_.getBestEffort() && await isBestEffortQueue(thread)) {
    if (await isBankrupt(thread)) {
      await thread.markTriaged(Labels.BANKRUPT_LABEL);
    } else {
      threads_.pushBestEffort(thread);
    }
  } else {
    await threads_.pushNeedsTriage(thread);
  }
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

async function markTriaged(thread) {
  await thread.markTriaged(null);
}

// Archive threads that are needstriage, but not in the inbox or unprocessed.
async function cleanupNeedsTriageThreads() {
  let needsTriageLabels = labels_.getNeedsTriageLabelNames();
  // For new users, they won't have any needstriage labels.
  if (!needsTriageLabels.length)
    return;
  await fetchThreads(markTriaged, {
    query: `-in:inbox -in:${Labels.UNPROCESSED_LABEL} (in:${needsTriageLabels.join(' OR in:')})`,
  });
}

async function onLoad() {
  settings_ = new Settings();
  labels_ = new Labels();

  await Promise.all([settings_.fetch(), labels_.fetch()]);
  await fetchQueuedLabelMap(settings_.spreadsheetId);

  let storage = new ServerStorage(settings_.spreadsheetId);
  if (!storage.get(ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN)) {
    await showHelp(settings_);
    storage.writeUpdates([{key: ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN, value: true}]);
  }

  let settingsButton = createMenuItem('Settings', {
    onclick: () => new SettingsView(settings_, getQueuedLabelMap()),
  });

  let helpButton = createMenuItem('Help', {
    onclick: () => showHelp(settings_),
  });

  let menuTitle = document.createElement('div');
  menuTitle.append('MakeTime phases');

  document.getElementById('drawer').append(
    menuTitle,
    createMenuItem('1: View All', {href: '/viewall', nested: true}),
    createMenuItem('2: View One', {href: '/viewone', nested: true}),
    createMenuItem('3: Triaged', {href: '/triaged', nested: true}),
    createMenuItem('4: MakeTime', {href: '/maketime', nested: true}),
    settingsButton,
    helpButton);

  let vacationQuery = '';
  if (settings_.get(ServerStorage.KEYS.VACATION_SUBJECT)) {
    vacationQuery = `subject:${settings_.get(ServerStorage.KEYS.VACATION_SUBJECT)}`;
    updateTitle('vacation', `Vacation ${vacationQuery}`);
  }

  updateLoaderTitle('onLoad', 'Fetching threads to triage...');

  let labels = await labels_.getTheadCountForLabels((labelName) => labelName.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/'));
  let labelsToFetch = labels.filter(data => data.count).map(data => data.name);
  labelsToFetch.sort(Labels.compare);

  if (settings_.get(ServerStorage.KEYS.VUEUE_IS_DEFAULT))
    await router.run('/viewall');
  else
    await router.run('/viewone');

  await cleanupNeedsTriageThreads();

  // Put first threads that are in the inbox with no make-time labels. That way they always show up before
  // daily/weekly/monthly bundles for folks that don't want to filter 100% of their mail with make-time.
  await fetchThreads(addThread, {
    query: `-(in:${labels_.getMakeTimeLabelNames().join(' OR in:')}) ${vacationQuery}`,
    queue: 'inbox',
  });

  for (let label of labelsToFetch) {
    await fetchThreads(addThread, {
      query: vacationQuery,
      queue: label,
    });
  }

  if (currentView_.finishedInitialLoad)
    await currentView_.finishedInitialLoad();

  // Don't want to show the earlier title, but still want to indicate loading is happening.
  // since we're going to processMail still. It's a less jarring experience if the loading
  // spinner doesn't go away and then come back when conteacts are done being fetched.
  updateLoaderTitle('onLoad', '\xa0');

  // Wait until we've fetched all the threads before trying to process updates regularly.
  setInterval(update, 1000 * 60);

  await fetchContacts(gapi.auth.getToken());
  await processMail();

  updateLoaderTitle('onLoad');
}

let CONTACT_STORAGE_KEY_ = 'contacts';

async function fetchContacts(token) {
  if (contacts_.length)
    return;

  // This is 450kb! Either cache this and fetch infrequently, or find a way of getting the API to not send
  // the data we don't need.
  let responseText;
  try {
    let response = await fetch("https://www.google.com/m8/feeds/contacts/default/thin?alt=json&access_token=" + token.access_token + "&max-results=20000&v=3.0");
    responseText = await response.text();
    localStorage.setItem(CONTACT_STORAGE_KEY_, responseText);
  } catch(e) {
    let message = `Failed to fetch contacts. Google Contacts API is hella unsupported. See https://issuetracker.google.com/issues/115701813.`;

    responseText = localStorage.getItem(CONTACT_STORAGE_KEY_);
    if (!responseText) {
      console.error(message);
      return;
    }

    console.error(`Using locally stored version of contacts. ${message}`);
  }

  json = JSON.parse(responseText);
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
  updateLoaderTitle('processMail', 'Processing mail backlog...');

  let mailProcessor = new MailProcessor(settings_, addThread, getQueuedLabelMap(), labels_);
  await mailProcessor.processMail();
  await mailProcessor.processQueues();
  await mailProcessor.collapseStats();

  updateLoaderTitle('processMail');
  isProcessingMail_ = false;
}

async function update() {
  await cleanupNeedsTriageThreads();
  if (currentView_.updateCurrentThread)
    await currentView_.updateCurrentThread();
  processMail();
}

// Make sure links open in new tabs.
document.body.addEventListener('click', async (e) => {
  for (let node of e.path) {
    if (node.tagName == 'A') {
      if (await router.run(node)) {
        e.preventDefault();
        return;
      }
      node.target = '_blank';
      node.rel = 'noopener';
    }
  }
});

document.addEventListener('visibilitychange', (e) => {
  if (!currentView_)
    return;
  if (document.visibilityState == 'hidden') {
    if (currentView_.onHide)
      currentView_.onHide();
  } else {
    if (currentView_.onShow)
      currentView_.onShow();
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
  new ErrorDialog(emailBody);
});

window.addEventListener('unhandledrejection', (e) => {
  // 401 means the credentials are invalid and you probably need to 2 factor.
  if (e.reason && e.reason.status == 401)
    window.location.reload();
  new ErrorDialog(e.reason);
});

window.addEventListener('offline', (e) => {
  updateTitle('offline', 'No network connection...');
});

window.addEventListener('online', (e) => {
  updateTitle('offline');
  update();
});
