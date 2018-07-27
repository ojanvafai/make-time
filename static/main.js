// Client ID and API key from the Developer Console
var CLIENT_ID = '749725088976-5n899es2a9o5p85epnamiqekvkesluo5.apps.googleusercontent.com';

// Array of API discovery doc URLs for APIs used by the quickstart
var DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest",
    "https://sheets.googleapis.com/$discovery/rest?version=v4"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
var SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/spreadsheets';

var USER_ID = 'me';

var authorizeButton = document.getElementById('authorize-button');

async function updateCounter(text) {
  document.getElementById('counter').innerHTML = text;
}

// TODO: Make this private to this file.
var g_labels = {};
let currentView_;
let settings_;

// Make sure links open in new tabs.
document.body.addEventListener('click', (e) => {
  if (e.target.tagName == 'A') {
    e.target.target = '_blank';
    e.target.rel = 'noopener';
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


window.onload = () => {
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
      authorizeButton.onclick = () => {
        gapi.auth2.getAuthInstance().signIn();
      };
    });
  });
};

window.addEventListener('error', (e) => {
  var emailBody = 'Captured an error: ' + e.message;
  if (e.body)
    emailBody += '\n' + e.body;
  if (e.stack)
    emailBody += '\n\n' + e.stack;

  // TODO: figure out how to send emails once this is back on a cron.
  alert(emailBody);
});

window.addEventListener('unhandledrejection', (e) => {
  alert(e.reason.stack || e.reason);
});

function getSettingsSpreadsheetId() {
  if (localStorage.spreadsheetId)
    return localStorage.spreadsheetId;
  let url = prompt("Insert the URL of your settings spreadsheet. If you don't have one, go to go/make-time-settings, create a copy of it, and then use the URL of the new spreadsheet.");
  if (!url)
    throw "Prompt got dismissed. Please reload to be reprompted.";

  // Spreadsheets URLS are of the form
  // https://docs.google.com/spreadsheets[POSSIBLE_STUFF_HERE]/d/[ID_HERE]/[POSSIBLE_STUFF_HERE]
  let id = url.split('/d/')[1].split('/')[0];
  localStorage.spreadsheetId = id;
  return id;
}

async function fetchSheet(spreadsheetId, sheetName) {
  let response =  await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: sheetName,
  });
  return response.result.values;
};

async function fetch2ColumnSheet(spreadsheetId, sheetName, opt_startRowIndex) {
  let result = {};
  let values = await fetchSheet(spreadsheetId, sheetName);
  if (!values)
    return result;

  let startRowIndex = opt_startRowIndex || 0;
  for (var i = startRowIndex; i < values.length; i++) {
    let value = values[i];
    result[value[0]] = value[1];
  }
  return result;
}

async function getSettings() {
  if (!settings_) {
    let spreadsheetId = getSettingsSpreadsheetId();
    document.getElementById('settings').href = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    // TODO: Fetch these two in parallel.
    settings_ = await fetch2ColumnSheet(spreadsheetId, CONFIG_SHEET_NAME, 1);
    settings_.spreadsheetId = spreadsheetId;
    settings_.queuedLabelMap = await fetch2ColumnSheet(spreadsheetId, QUEUED_LABELS_SHEET_NAME, 1);
  }
  return settings_;
}

async function transitionBackToThreadAtATime(threadsToTriage, threadsToDone) {
  if (threadsToDone.length) {
    showLoader(true);
    updateTitle(`Archiving ${threadsToDone.length} threads...`);
  }

  await viewThreadAtATime(threadsToTriage);

  for (let thread of threadsToDone) {
    await thread.markTriaged();
  }
  showLoader(false);
}

async function viewThreadAtATime(threads) {
  let settings = await getSettings();
  let blockedLabel = addQueuedPrefix(settings, BLOCKED_LABEL_SUFFIX);

  let threadList = new ThreadList();
  for (let thread of threads) {
    await threadList.push(thread);
  }

  let timeout = 20;
  if (settings.timeout > 0)
    timeout = settings.timeout;

  let allowedReplyLength = settings.allowed_reply_length || 150;
  setView(new ThreadView(threadList, updateCounter, blockedLabel, timeout, allowedReplyLength));
}

async function viewAll(e) {
  e.preventDefault();

  if (!currentView_)
    return;

  if (currentView_ instanceof Vueue)
    return;

  let threads = await currentView_.popAllThreads();
  if (!threads.length)
    return;

  setView(new Vueue(threads, transitionBackToThreadAtATime));

  updateCounter('');
}

function setView(view) {
  currentView_ = view;
  var content = document.getElementById('content');
  content.textContent = '';
  content.append(view);
}

async function updateSigninStatus(isSignedIn) {
  if (isSignedIn) {
    authorizeButton.parentNode.style.display = 'none';
    document.getElementById('view-all').onclick = viewAll;
    await updateThreadList();
  } else {
    authorizeButton.parentNode.style.display = '';
  }
}

async function updateTitle(title) {
  let settings = await getSettings();
  if (settings.vacation_subject)
    title = `Only showing threads with subject:${settings.vacation_subject} ${title}`;
  document.getElementById('title').textContent = title;
}

document.body.addEventListener('keydown', async (e) => {
  if (!currentView_)
    return;
  // Don't allow actions to apply in rapid succession for each thread.
  // This prevents accidents of archiving a lot of threads at once
  // when your stupid keyboard gets stuck holding the archive key down. #sigh
  if (e.repeat)
    return false;
  if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey)
    await currentView_.dispatchShortcut(e.key);
});

// TODO: make it so that labels created can have visibility of "hide" once we have a need for that.
function createLabel(labelName) {
  return new Promise(resolve => {
    var request = gapi.client.gmail.users.labels.create({
      userId: USER_ID,
      name: labelName,
      messageListVisibility: 'show',
      labelListVisibility: 'labelShow',
    });
    request.execute(resolve);
  });
}

async function getLabelId(labelName) {
  if (g_labels.labelToId[labelName])
    return g_labels.labelToId[labelName];

  await updateLabelList();
  var parts = labelName.split('/');

  // Create all the parent labels as well as the final label.
  var labelSoFar = '';
  for (var part of parts) {
    var prefix = labelSoFar ? '/' : '';
    labelSoFar += prefix + part;
    // creating a label 409's if the label already exists.
    // Technically we should handle the race if the label
    // gets created in between the start of the create call and this line. Meh.
    if (g_labels.labelToId[labelSoFar])
      continue;

    var result = await createLabel(labelSoFar);
    var id = result.id;
    g_labels.labelToId[labelSoFar] = id;
    g_labels.idToLabel[id] = labelSoFar;
  }

  return g_labels.labelToId[labelName];
}

async function fetchThreads(label, opt_extraQuery) {
  var query = 'in:' + label;

  if (opt_extraQuery)
    query += ' ' + opt_extraQuery;

  // We only have triaged labels once they've actually been created.
  if (g_labels.triagedLabels.length)
    query += ' -(in:' + g_labels.triagedLabels.join(' OR in:') + ')';

  var getPageOfThreads = async function(opt_pageToken) {
    let requestParams = {
      'userId': USER_ID,
      'q': query,
    };

    if (opt_pageToken)
      requestParams.pageToken = opt_pageToken;

    let resp = await gapi.client.gmail.users.threads.list(requestParams);
    let result = resp.result.threads || [];

    let nextPageToken = resp.result.nextPageToken;
    if (nextPageToken)
      result = result.concat(await getPageOfThreads(nextPageToken));
    return result;
  };

  let rawThreads = await getPageOfThreads();
  let threads = [];
  for (let thread of rawThreads) {
    threads.push(new Thread(thread));
  }
  return threads;
}

function showLoader(show) {
  document.getElementById('loader').style.display = show ? 'inline-block' : 'none';
  if (!show);
    updateTitle('');
}

async function addThread(thread) {
  let settings = await getSettings();
  if (settings.vacation_subject) {
    let subject = await thread.getSubject();
    if (!subject.toLowerCase().includes(settings.vacation_subject.toLowerCase()))
      return;
  }
  await currentView_.push(thread);
}

async function updateThreadList() {
  showLoader(true);

  updateTitle('Fetching threads to triage...');
  await updateLabelList();

  await viewThreadAtATime([]);

  let settings = await getSettings();
  let vacationQuery;
  if (settings.vacation_subject)
    vacationQuery = `subject:${settings.vacation_subject}`;

  let threads = await fetchThreads('inbox', vacationQuery);
  let firstThread = threads.pop();
  if (firstThread)
    await addThread(firstThread);

  for (let thread of threads) {
    await addThread(thread);
  }

  await processMail();
  showLoader(false);
}

// TODO: Move this to a cron
async function processMail() {
  showLoader(true);
  updateTitle('Processing mail backlog...');
  let mailProcessor = new MailProcessor(await getSettings(), addThread);
  await mailProcessor.processMail();
  await mailProcessor.processQueues();
  await mailProcessor.collapseStats();
  showLoader(false);
}

let TEN_MINUTES_IN_MS = 1000 * 60 * 10;
setInterval(processMail, TEN_MINUTES_IN_MS);

async function updateLabelList() {
  var response = await gapi.client.gmail.users.labels.list({
    'userId': USER_ID
  })

  g_labels.labelToId = {};
  g_labels.idToLabel = {};
  g_labels.triagedLabels = [];
  for (var label of response.result.labels) {
    g_labels.labelToId[label.name] = label.id;
    g_labels.idToLabel[label.id] = label.name;

    if (label.name.startsWith(TRIAGED_LABEL + '/'))
      g_labels.triagedLabels.push(label.name);
  }
}
