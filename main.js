// api key AIzaSyCo4jU2NkmiAkUhkh2IJ6RtnYEqbrjBaDI

// Client ID and API key from the Developer Console
var CLIENT_ID = '888881698595-u0noju06t3jcvdttutq0d353tlbm3fmm.apps.googleusercontent.com';

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
    var query = 'in:inbox';
    listThreads(USER_ID, query, renderInbox);
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

function processMessage(message) {
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

  var plainTextBody;
  var htmlBody;
  if (message.payload.parts) {
    for (var part of message.payload.parts) {
      switch (part.mimeType) {
        case 'text/plain':
          plainTextBody = base64Decode(part.body.data);
          break;
        case 'text/html':
          htmlBody = base64Decode(part.body.data);
          break;
      }
    }
  } else {
    plainTextBody = htmlBody = base64Decode(message.payload.body.data)
  }

  appendPre("From: " + from);
  appendPre("Subject: " + subject);
  appendPre("Labels: " + labelIds.join(' '));
  if (htmlBody)
    appendHtml(htmlBody);
  else
    appendPre(plainTextBody);
}

var g_state = {
  threadDetails: [],
  currentThreadIndex: 0,
};

document.body.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'j':
      g_state.currentThreadIndex = Math.min(g_state.currentThreadIndex + 1, g_state.threads.length - 1);
      renderCurrentThread();
      break;

    case 'k':
      g_state.currentThreadIndex = Math.max(g_state.currentThreadIndex - 1, 0);
      renderCurrentThread();
      break;
  }
});

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
  document.getElementById('content').textContent = '';

  var callback = () => {
    // If you cycle through threads quickly, then the callback for the previous
    // thread finishes before the current on has it's data.
    // TODO: Use promises and reject the fetch promise when the user has
    // gone to the next message so we don't get in this state in the first place.
    if (!(g_state.currentThreadIndex in g_state.threadDetails))
      return;
    var threadDetails = g_state.threadDetails[g_state.currentThreadIndex];
    processMessage(threadDetails.messages[0]);
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

function appendHtml(html) {
  var div = document.createElement('div');
  div.innerHTML = html;
  var container = document.getElementById('content');
  container.appendChild(div);
}

function appendPre(message) {
  var pre = document.getElementById('content');
  var textContent = document.createTextNode(message + '\n');
  pre.appendChild(textContent);
}

/**
 * @param  {String} userId User's email address. The special value 'me'
 * can be used to indicate the authenticated user.
 * @param  {String} query String used to filter the Threads listed.
 * @param  {Function} callback Function to call when the request is complete.
 */
function listThreads(userId, query, callback) {
  var requestParams = {
    'userId': userId,
    'q': query,
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

function listLabels() {
  gapi.client.gmail.users.labels.list({
    'userId': USER_ID
  }).then(function(response) {
    var labels = response.result.labels.sort((a, b) => {
      if (a.name > b.name)
        return 1;
      if (a.name < b.name)
        return -1;
      return 0;
    });
    appendPre('Labels:');

    if (labels && labels.length > 0) {
      for (i = 0; i < labels.length; i++) {
        var label = labels[i];
        appendPre(label.name)
      }
    } else {
      appendPre('No Labels found.');
    }
  });
}