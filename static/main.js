
// TODO: Get these values out of the go/pedantic-gmail-labeler sheet.
// For now, make sure the values in your spreadsheet match these and vice versa.
var AUTO_LABEL = 'auto';
var LABELER_IMPLEMENTATION_LABEL = 'labeler';
var READ_LATER_LABEL = 'readlater';
var NEEDS_REPLY_LABEL = 'needsreply';

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

function updateSigninStatus(isSignedIn) {
  if (isSignedIn) {
    authorizeButton.style.display = 'none';
    signoutButton.style.display = 'block';
    // TODO: have both of these be promises and use Promise.all
    // before rendering anything.
    fetchThreads(USER_ID, renderInbox);
    updateLabelList();
  } else {
    authorizeButton.style.display = 'block';
    signoutButton.style.display = 'none';
  }
}

function base64Decode(str) {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
}

function updateCounter(index) {
  var counter = document.getElementById('counter');
  counter.textContent = (index + 1) + '/' + g_state.threads.length;
}

function getMessageBody(mimeParts, body) {
  for (var part of mimeParts) {
    switch (part.mimeType) {
      case 'text/plain':
        body.plain = base64Decode(part.body.data);
        break;
      case 'text/html':
        body.html = base64Decode(part.body.data);
        break;
      case 'multipart/alternative':
        getMessageBody(part.parts, body);
        break;
    }
  }
}

function renderMessage(message) {
  var labelIds = message.labelIds;

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

  var body = {
    plain: '',
    html: '',
  }
  var plainTextBody;
  var htmlBody;
  if (message.payload.parts) {
    getMessageBody(message.payload.parts, body);
  } else {
    body.plain = body.html = base64Decode(message.payload.body.data)
  }

  var messageDiv = document.createElement('div');
  messageDiv.className = 'message';

  var readState = labelIds.includes('UNREAD') ? 'unread' : 'read';
  messageDiv.classList.add(readState);

  messageDiv.textContent = `From: ${from}
Subject: ${subject}
Labels: ${labelIds.join(' ')}`;

  // TODO: Do we need iframes or does gmail strip dangerous things for us.
  // Seems like we might need it for styling isolation at least, but gmail doesn't
  // seem to use iframes, so we probably don't if they strip things for us.
  // iframes making everythign complicated (e.g for capturing keypresses, etc.).
  var bodyContainer = document.createElement('div');
  bodyContainer.innerHTML = body.html || body.plain;
  messageDiv.appendChild(bodyContainer);
  return messageDiv;
}

var g_state = {
  threadDetails: [],
  currentThreadIndex: 0,
};

function renderNextThread() {
  g_state.currentThreadIndex = Math.min(g_state.currentThreadIndex + 1, g_state.threads.length - 1);
  renderCurrentThread();
}

document.body.addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey)
    dispatchShortcut(e.key);
});

function dispatchShortcut(key) {
  switch (key) {
    case 'j':
      break;

    case 'd':
      done();
      break;

    case 'l':
      readLater();
      break;

    case 'r':
      reply();
      break;

    case 'b':
      blocked();
      break;

    case 'm':
      mute();
      break;

    case 't':
      task();
      break;
  }
};

function done() {
  var request = gapi.client.gmail.users.threads.modify({
    'userId': USER_ID,
    'id': g_state.threads[g_state.currentThreadIndex].id,
    'removeLabelIds': ['UNREAD', 'INBOX'],
  });
  // TODO: Move immediately to the next thread, but give an indication
  // in the UI when the previous action successfully completes.
  // And handle failure to complete gracefully.
  request.execute(renderNextThread);
}

// TODO: Once we add a proper read later queue, put this in the
// LABELER_IMPLEMENTATION_LABEL parent label so it's implementation detail.
// For now, expose readlater to the user in gmail.
function readLaterLabelName() {
  return AUTO_LABEL + '/' + READ_LATER_LABEL;
}

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
    g_state.labelToId[labelName] = id;
    g_state.idToLabel[id] = labelName;
  }

  return g_state.labelToId[labelName];
}

async function readLater() {
  var id = await getLabelId(readLaterLabelName());
  var request = gapi.client.gmail.users.threads.modify({
    'userId': USER_ID,
    'id': g_state.threads[g_state.currentThreadIndex].id,
    'addLabelIds': [id],
  });
  // TODO: Move immediately to the next thread, but give an indication
  // in the UI when the previous action successfully completes.
  // And handle failure to complete gracefully.
  request.execute(renderNextThread);
}

function reply() {
  alert('reply not implemented');
}

function blocked() {
  alert('blocked not implemented');
}

function mute() {
  alert('mute not implemented');
}

function task() {
  alert('task not implemented');
}

function fetchThreadDetails(index, callback) {
  var thread = g_state.threads[index];
  var requestParams = {
    'userId': USER_ID,
    'id': thread.id,
  }
  var request = gapi.client.gmail.users.threads.get(requestParams);
  request.execute((resp) => {
    g_state.threadDetails[index] = resp;
    callback();
  });
}

function renderCurrentThread() {
  updateCounter(g_state.currentThreadIndex);
  var content = document.getElementById('content');
  content.textContent = '';

  var callback = () => {
    // If you cycle through threads quickly, then the callback for the previous
    // thread finishes before the current on has it's data.
    // TODO: Use promises and reject the fetch promise when the user has
    // gone to the next message so we don't get in this state in the first place.
    if (!(g_state.currentThreadIndex in g_state.threadDetails))
      return;
    var threadDetails = g_state.threadDetails[g_state.currentThreadIndex];
    var lastMessage;
    for (var message of threadDetails.messages) {
      lastMessage = renderMessage(message);
      content.appendChild(lastMessage);
    }
    // Always show the last message.
    // TODO: Do something less hacky than pretending it's unread.
    lastMessage.classList.remove('read');
    lastMessage.classList.add('unread');
    document.querySelector('.unread').scrollIntoView();
    content.scrollTop = content.scrollTop - 25;
  }

  if (g_state.currentThreadIndex in g_state.threadDetails)
    callback();
  else
    fetchThreadDetails(g_state.currentThreadIndex, callback);
}

function renderInbox(threads) {
  g_state.threads = threads;
  renderCurrentThread();
}

function handleAuthClick(event) {
  gapi.auth2.getAuthInstance().signIn();
}

function handleSignoutClick(event) {
  gapi.auth2.getAuthInstance().signOut();
}

function fetchThreads(userId, callback) {
  var requestParams = {
    'userId': userId,
    'q': 'in:inbox -in:' + readLaterLabelName(),
  }
  var getPageOfThreads = function(result) {
    var request = gapi.client.gmail.users.threads.list(requestParams);
    request.execute(function (resp) {
      result = result.concat(resp.threads);
      var nextPageToken = resp.nextPageToken;
      if (nextPageToken) {
        requestParams.pageToken = nextPageToken;
        getPageOfThreads(result);
      } else {
        callback(result);
      }
    });
  };
  getPageOfThreads([]);
}

async function updateLabelList() {
  var response = await gapi.client.gmail.users.labels.list({
    'userId': USER_ID
  })

  g_state.labelToId = {};
  g_state.idToLabel = {};
  for (var label of response.result.labels) {
    g_state.labelToId[label.name] = label.id;
    g_state.idToLabel[label.id] = label.name;
  }
}
