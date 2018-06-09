var TRIAGER_LABEL = 'triaged';
var TO_TRIAGE_LABEL = 'needstriage';

function triagerLabel(labelName) {
  return `${TRIAGER_LABEL}/${labelName}`;
}

function needsTriageLabel(labelName) {
  return `${TO_TRIAGE_LABEL}/${labelName}`;
}

var READ_LATER_LABEL = triagerLabel('longread');
var NEEDS_REPLY_LABEL = triagerLabel('needsreply');
var BLOCKED_LABEL = triagerLabel('blocked');
var MUTED_LABEL = triagerLabel('supermuted');
var TASK_LABEL = triagerLabel('tasks');

// Client ID and API key from the Developer Console
var CLIENT_ID = '520704056454-99upe5p4nb6ce7jsf0fmlmqhcs6c0gbe.apps.googleusercontent.com';

// Array of API discovery doc URLs for APIs used by the quickstart
var DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
var SCOPES = 'https://www.googleapis.com/auth/gmail.modify';

var USER_ID = 'me';

var authorizeButton = document.getElementById('authorize-button');
var signoutButton = document.getElementById('signout-button');

var base64 = new Base64();

var g_state = {
  threads: [],
  threadDetails: [],
  labelForIndex: [],
  currentThreadIndex: 0,
};

function handleClientLoad() {
  gapi.load('client:auth2', initClient);
}

window.onload = handleClientLoad();

function initClient() {
  gapi.client.init({
    discoveryDocs: DISCOVERY_DOCS,
    clientId: CLIENT_ID,
    scope: SCOPES
  }).then(function () {
    // Listen for sign-in state changes.
    gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);

    // Handle the initial sign-in state.
    updateSigninStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
    authorizeButton.onclick = handleAuthClick;
    signoutButton.onclick = handleSignoutClick;
  });
}

async function updateSigninStatus(isSignedIn) {
  if (isSignedIn) {
    authorizeButton.style.display = 'none';
    signoutButton.style.display = 'block';
    await updateThreadList();
    renderCurrentThread();
  } else {
    authorizeButton.style.display = 'block';
    signoutButton.style.display = 'none';
  }
}

function updateCounter() {
  var index = g_state.currentThreadIndex;
  var threadsLeft = g_state.threads.length - index;
  var counter = document.getElementById('counter');
  var text = `${threadsLeft} threads left.`
  if (threadsLeft)
    text += ` Current queue: ${g_state.labelForIndex[index]}`
  counter.textContent = text;
}

function getMessageBody(mimeParts, body) {
  for (var part of mimeParts) {
    switch (part.mimeType) {
      case 'text/plain':
        body.plain = base64.decode(part.body.data);
        break;
      case 'text/html':
        body.html = base64.decode(part.body.data);
        break;
      case 'multipart/alternative':
        getMessageBody(part.parts, body);
        break;
    }
  }
}

function elideReply(messageText) {
  // TODO: actually do the eliding. :)
  return messageText;
}

function renderMessage(message) {
  var from;
  var subject;
  for (var header of message.payload.headers) {
    switch (header.name) {
      case 'Subject':
        subject = header.value;
        break;
      case 'From':
        from = header.value;
        break;
    }
  }

  // TODO: We could probably be more efficient by only grabbing one of these.
  var body = {
    plain: '',
    html: '',
  }
  var plainTextBody;
  var htmlBody;
  if (message.payload.parts) {
    getMessageBody(message.payload.parts, body);
  } else {
    body.plain = body.html = base64.decode(message.payload.body.data)
  }

  var messageDiv = document.createElement('div');
  messageDiv.className = 'message';

  var readState = message.labelIds.includes('UNREAD') ? 'unread' : 'read';
  messageDiv.classList.add(readState);

  messageDiv.textContent = `From: ${from}
Subject: ${subject}`;

  // TODO: Do we need iframes or does gmail strip dangerous things for us.
  // Seems like we might need it for styling isolation at least, but gmail doesn't
  // seem to use iframes, so we probably don't if they strip things for us.
  // iframes making everythign complicated (e.g for capturing keypresses, etc.).
  var bodyContainer = document.createElement('div');
  var messageText = body.html || body.plain;
  bodyContainer.innerHTML = elideReply(messageText);
  messageDiv.appendChild(bodyContainer);
  return {
    element: messageDiv,
    text: messageText,
  }
}

function renderNextThread() {
  g_state.currentThreadIndex = nextThreadIndex();
  renderCurrentThread();
}

function nextThreadIndex() {
  return Math.min(g_state.currentThreadIndex + 1, g_state.threads.length);
}

document.body.addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey)
    dispatchShortcut(e.key);
});

var keyToDestination = {
  'd': null, // No destination label for DONE
  'l': READ_LATER_LABEL,
  'r': NEEDS_REPLY_LABEL,
  'b': BLOCKED_LABEL,
  'm': MUTED_LABEL,
  't': TASK_LABEL,
}

function dispatchShortcut(key) {
  var destination = keyToDestination[key];
  if (destination !== undefined)
    markTriaged(g_state.currentThreadIndex, destination);
};

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

async function getLabelId(labelName, callback) {
  if (g_state.labelToId[labelName])
    return g_state.labelToId[labelName];

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
    if (g_state.labelToId[labelSoFar])
      continue;

    var result = await createLabel(labelSoFar);
    var id = result.id;
    g_state.labelToId[labelSoFar] = id;
    g_state.idToLabel[id] = labelSoFar;
  }

  return g_state.labelToId[labelName];
}

async function modifyThread(threadIndex, addLabelIds, removeLabelIds) {
  gapi.client.gmail.users.threads.modify({
    'userId': USER_ID,
    'id': g_state.threads[threadIndex].id,
    'addLabelIds': addLabelIds,
    'removeLabelIds': removeLabelIds,
  }).then((resp) => {
    if (resp.status == '200') {
      // hide spinner
    } else {
      // retry? Show some error UI?
    }
  });
  renderNextThread();
}

async function markTriaged(threadIndex, destination) {
  var addLabelIds = [];
  if(destination)
    addLabelIds.push(await getLabelId(destination));

  var triageQueue = needsTriageLabel(g_state.labelForIndex[threadIndex]);
  var removeLabelIds = ['UNREAD', 'INBOX', await getLabelId(triageQueue)];
  modifyThread(threadIndex, addLabelIds, removeLabelIds);
}

function fetchThreadDetails(index, callback) {
  // This happens when we triage the last message.
  if (index == g_state.threads.length)
    return;

  var thread = g_state.threads[index];
  var requestParams = {
    'userId': USER_ID,
    'id': thread.id,
  }
  var request = gapi.client.gmail.users.threads.get(requestParams);
  request.execute((resp) => {
    g_state.threadDetails[index] = resp;
    callback(index);
  });
}

function renderCurrentThread() {
  updateCounter();
  var content = document.getElementById('content');
  if (g_state.currentThreadIndex == g_state.threads.length) {
    content.textContent = 'All done triaging! \\o/ Reload to check for new threads.';
    return;
  }
  content.textContent = '';

  var callback = (index) => {
    // If you cycle through threads quickly, then the callback for the previous
    // thread finishes before the current on has it's data.
    if (index != g_state.currentThreadIndex)
      return;
    var threadDetails = g_state.threadDetails[g_state.currentThreadIndex];
    var lastMessage;
    for (var message of threadDetails.messages) {
      lastMessage = renderMessage(message, lastMessage ? lastMessage.text : null);
      content.appendChild(lastMessage.element);
    }
    // Always show the last message.
    // TODO: Do something less hacky than pretending the last message is unread
    // so it shows and gets scrolled to.
    lastMessage.element.classList.remove('read');
    lastMessage.element.classList.add('unread');
    document.querySelector('.unread').scrollIntoView();
    content.scrollTop = content.scrollTop - 25;

    // Prefetch the next thread for instant access.
    fetchThreadDetails(nextThreadIndex(), (index) => {
      console.log(`Prefetched thread index: ${index})`);
    });
  }

  if (g_state.currentThreadIndex in g_state.threadDetails)
    callback(g_state.currentThreadIndex);
  else
    fetchThreadDetails(g_state.currentThreadIndex, callback);
}

function handleAuthClick(event) {
  gapi.auth2.getAuthInstance().signIn();
}

function handleSignoutClick(event) {
  gapi.auth2.getAuthInstance().signOut();
}

async function fetchThreadList(label, currentIndex) {
  var query = 'in:inbox';
  // We only have triager labels once they've actually been created.
  if (g_state.triagerLabels.length)
    query += ' -(in:' + g_state.triagerLabels.join(' OR in:') + ')';

  var getPageOfThreads = async function(label) {
    var resp = await gapi.client.gmail.users.threads.list({
      'userId': USER_ID,
      'q': query + ' in: ' + label,
    });
    var nextPageToken = resp.result.nextPageToken;
    var result = resp.result.threads || [];
    if (nextPageToken) {
      requestParams.pageToken = nextPageToken;
      result = result.concat(await getPageOfThreads(label));
    }
    return result;
  };

  var threads = await getPageOfThreads(label);
  g_state.threads = g_state.threads.concat(threads);
  var unprefixedLabel = label.replace(new RegExp('^' + TO_TRIAGE_LABEL + '/'), '');
  for (var i = 0; i < threads.length; i++) {
    g_state.labelForIndex[currentIndex++] = unprefixedLabel;
  }
  updateCounter();
}

async function updateThreadList(callback) {
  document.getElementById('loader').style.display = 'inline-block';
  await updateLabelList();

  var foundNonEmptyQueue = false;
  for (var label of g_state.toTriageLabels) {
    var currentIndex = g_state.threads.length;
    // Only block on returning from updateThreadList until we've found at least
    // one thread to render so we can show the first thread as quickly as possible.
    if (foundNonEmptyQueue)
      fetchThreadList(label, currentIndex);
    else
      await fetchThreadList(label, currentIndex);
    foundNonEmptyQueue |= g_state.threads.length;
  }

  document.getElementById('loader').style.display = 'none';
}

async function updateLabelList() {
  var response = await gapi.client.gmail.users.labels.list({
    'userId': USER_ID
  })

  g_state.labelToId = {};
  g_state.idToLabel = {};
  g_state.triagerLabels = [];
  g_state.toTriageLabels = [];
  for (var label of response.result.labels) {
    g_state.labelToId[label.name] = label.id;
    g_state.idToLabel[label.id] = label.name;

    if (label.name.startsWith(TRIAGER_LABEL + '/'))
      g_state.triagerLabels.push(label.name);

    if (label.name.startsWith(TO_TRIAGE_LABEL + '/'))
      g_state.toTriageLabels.push(label.name);

    g_state.toTriageLabels.sort();
  }
}
