// Client ID and API key from the Developer Console
var CLIENT_ID = '520704056454-99upe5p4nb6ce7jsf0fmlmqhcs6c0gbe.apps.googleusercontent.com';

// Array of API discovery doc URLs for APIs used by the quickstart
var DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
var SCOPES = 'https://www.googleapis.com/auth/gmail.modify';

var USER_ID = 'me';

var authorizeButton = document.getElementById('authorize-button');

var base64 = new Base64();

var g_state = {
  threads: [],
  threadDetails: [],
  processedThreadDetails: [],
  labelForIndex: [],
  currentThreadIndex: 0,
};

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

async function updateSigninStatus(isSignedIn) {
  if (isSignedIn) {
    authorizeButton.parentNode.style.display = 'none';
    await updateThreadList();
    renderCurrentThread();
  } else {
    authorizeButton.parentNode.style.display = '';
  }
}

function updateCounter() {
  var index = g_state.currentThreadIndex;
  var threadsLeft = g_state.threads.length - index;
  var counter = document.getElementById('counter');
  var text = `${threadsLeft} threads left`
  if (threadsLeft)
    text += `&nbsp;&nbsp;|&nbsp;&nbsp;Currently triaging: ${g_state.labelForIndex[index]}`
  counter.innerHTML = text;
}

function htmlEscape(html) {
  return html.replace(/[&<>"']/g, function(m) {
    switch (m) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case `'`:
        return '&#039;';
    }
  });
};

function getMessageBody(mimeParts, body) {
  for (var part of mimeParts) {
    switch (part.mimeType) {
      case 'text/plain':
        body.htmlEscapedPlain = htmlEscape(base64.decode(part.body.data));
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

let guidPrefix = 'guidprefix_';
let guidCount = 0;
function nextGuid() {
  return guidPrefix + guidCount++;
}

function toggleDisplayInline(element) {
  var current = getComputedStyle(element).display;
  element.style.display = current == 'none' ? 'inline' : 'none';
}

// Don't want stylesheets in emails to style the whole page.
function disableStyleSheets(messageText) {
  return messageText.replace(/<style/g, '<style type="not-css"');
}

function elideReply(messageText, previousMessageText) {
  var guid = nextGuid();
  let windowSize = 100;
  let minimumLength = 100;
  // Lazy hacks to get the element whose display to toggle
  // and to get this to render centered-ish elipsis without using an image.
  let prefix = `<div style="overflow:hidden"><div style="margin-top:-7px"><div class="toggler" onclick="toggleDisplayInline(this.parentNode.parentNode.nextSibling)">...</div></div></div><span class="elide">`;
  let postfix = `</span>`;
  let differ = new Differ(prefix, postfix, windowSize, minimumLength);
  return differ.diff(messageText, previousMessageText);
}

function processMessage(message, previousMessageText) {
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
    body.html = base64.decode(message.payload.body.data);
  }

  // TODO: Do we need iframes or does gmail strip dangerous things for us.
  // Seems like we might need it for styling isolation at least, but gmail doesn't
  // seem to use iframes, so we probably don't if they strip things for us.
  // iframes making everythign complicated (e.g for capturing keypresses, etc.).
  let raw = html = body.html || body.htmlEscapedPlain;
  // TODO: Test eliding works if current message is html but previous is plain or vice versa.
  if (previousMessageText)
    html = elideReply(html, previousMessageText);
  if (body.html)
    html = disableStyleSheets(html);

  return {
    isUnread: message.labelIds.includes('UNREAD'),
    html: html,
    from: from,
    subject: subject,
    raw: raw,
  }
}

function renderMessage(processedMessage) {
  var messageDiv = document.createElement('div');
  messageDiv.className = 'message';

  messageDiv.classList.add(processedMessage.isUnread ? 'unread' : 'read');

  var headerDiv = document.createElement('div');
  headerDiv.classList.add('headers');
  headerDiv.textContent = `From: ${processedMessage.from}
Subject: ${processedMessage.subject}`;
  messageDiv.appendChild(headerDiv);

  var bodyContainer = document.createElement('div');
  bodyContainer.innerHTML = processedMessage.html;
  messageDiv.appendChild(bodyContainer);

  return messageDiv;
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
  't': READ_LATER_LABEL,
  'r': NEEDS_REPLY_LABEL,
  'b': BLOCKED_LABEL,
  'm': MUTED_LABEL,
  'a': ACTION_ITEM_LABEL,
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
    let messages = [];
    for (var message of resp.messages) {
      let previousMessageText = messages.length && messages[messages.length - 1].raw;
      messages.push(processMessage(message, previousMessageText));
    }
    g_state.processedThreadDetails[index] = {
      messages: messages,
    };
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
    var threadDetails = g_state.processedThreadDetails[g_state.currentThreadIndex];
    var lastMessageElement;
    for (var message of threadDetails.messages) {
      lastMessageElement = renderMessage(message);
      content.appendChild(lastMessageElement);
    }
    var elementToScrollTo = document.querySelector('.unread') || lastMessageElement;
    elementToScrollTo.scrollIntoView();
    document.documentElement.scrollTop -= 50;

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

async function fetchThreadList(label) {
  // Use in:inbox to exclude snoozed items.
  var query = 'in:inbox in:' + label;
  // We only have triaged labels once they've actually been created.
  if (g_state.triagedLabels.length)
    query += ' -(in:' + g_state.triagedLabels.join(' OR in:') + ')';

  var getPageOfThreads = async function(label) {
    var resp = await gapi.client.gmail.users.threads.list({
      'userId': USER_ID,
      'q': query,
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
  // Make sure to grab the length of g_state.threads after the await call above
  // but before we append to it.
  var currentIndex = g_state.threads.length;
  g_state.threads = g_state.threads.concat(threads);
  var unprefixedLabel = removeTriagedPrefix(label);
  for (var i = 0; i < threads.length; i++) {
    g_state.labelForIndex[currentIndex++] = unprefixedLabel;
  }
  updateCounter();
}

async function fetchThreadLists(opt_startIndex) {
  var startIndex = opt_startIndex || 0;
  for (var i = startIndex; i < g_state.toTriageLabels.length; i++) {
    let label = g_state.toTriageLabels[i];
    await fetchThreadList(label);
    if (!opt_startIndex && g_state.threads.length)
      return i + 1;
  }
  document.getElementById('loader').style.display = 'none';
}

async function updateThreadList(callback) {
  document.getElementById('loader').style.display = 'inline-block';
  await updateLabelList();
  // Only block until the first queue that has non-zero threads so we can
  // show the first thread as quickly as possible.
  let lastIndexFetched = await fetchThreadLists();
  // Then fetch the rest of the threads without blocking updateThreadList,
  // but fetch those threads sequentially in fetchThreadLists still so they
  // get put into g_state in order and don't flood the network.
  fetchThreadLists(lastIndexFetched);
}

async function updateLabelList() {
  var response = await gapi.client.gmail.users.labels.list({
    'userId': USER_ID
  })

  g_state.labelToId = {};
  g_state.idToLabel = {};
  g_state.triagedLabels = [];
  g_state.toTriageLabels = [];
  for (var label of response.result.labels) {
    g_state.labelToId[label.name] = label.id;
    g_state.idToLabel[label.id] = label.name;

    if (label.name.startsWith(TRIAGED_LABEL + '/'))
      g_state.triagedLabels.push(label.name);

    if (label.name.startsWith(TO_TRIAGE_LABEL + '/'))
      g_state.toTriageLabels.push(label.name);

    LabelUtils.sort(g_state.toTriageLabels);
  }
}
