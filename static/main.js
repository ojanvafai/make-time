// Client ID and API key from the Developer Console
var CLIENT_ID = '749725088976-5n899es2a9o5p85epnamiqekvkesluo5.apps.googleusercontent.com';

// Array of API discovery doc URLs for APIs used by the quickstart
var DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
var SCOPES = 'https://www.googleapis.com/auth/gmail.modify';

var USER_ID = 'me';

var authorizeButton = document.getElementById('authorize-button');

var base64 = new Base64();

var g_state = {
  // Ordered list of threads.
  threads: [],
  // threadId --> thread map.
  threadMap: {},
  currentThreadIndex: 0,
};

// Make sure links open in new tabs.
document.body.addEventListener('click', (e) => {
  if (e.target.tagName == 'A') {
    e.target.target = '_blank';
    e.target.rel = 'noopener';
  }
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

async function updateSigninStatus(isSignedIn) {
  if (isSignedIn) {
    authorizeButton.parentNode.style.display = 'none';
    setupResizeObservers();
    await updateThreadList();
    renderCurrentThread();
  } else {
    authorizeButton.parentNode.style.display = '';
  }
}

function setupResizeObservers() {
  let ro = new ResizeObserver(entries => {
    for (let entry of entries) {
      let dummyElement = document.getElementById('dummy-' + entry.target.id);
      dummyElement.style.height = entry.contentRect.height + 'px';
    }
  });
  ro.observe(document.getElementById('header'));
  ro.observe(document.getElementById('footer'));
}

function updateCounter() {
  var index = g_state.currentThreadIndex;
  var threadsLeft = g_state.threads.length - index;
  var counter = document.getElementById('counter');
  var text = `${threadsLeft} threads left`
  if (threadsLeft)
    text += `&nbsp;&nbsp;|&nbsp;&nbsp;Currently triaging: ${removeTriagedPrefix(g_state.threads[index].queue)}`;
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

function toggleDisplayInline(element) {
  var current = getComputedStyle(element).display;
  element.style.display = current == 'none' ? 'inline' : 'none';
}

// Don't want stylesheets in emails to style the whole page.
function disableStyleSheets(messageText) {
  return messageText.replace(/<style/g, '<style type="not-css"');
}

function elideReply(messageText, previousMessageText) {
  let windowSize = 100;
  let minimumLength = 100;
  // Lazy hacks to get the element whose display to toggle
  // and to get this to render centered-ish elipsis without using an image.
  let prefix = `<div style="overflow:hidden"><div style="margin-top:-7px"><div class="toggler" onclick="toggleDisplayInline(this.parentNode.parentNode.nextSibling)">...</div></div></div><div class="elide">`;
  let postfix = `</div>`;

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
  headerDiv.textContent = `From: ${processedMessage.from}`;
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

  var removeLabelIds = ['UNREAD', 'INBOX'];
  var triageQueue = g_state.threads[threadIndex].queue;
  if (triageQueue)
    removeLabelIds.push(await getLabelId(triageQueue));
  modifyThread(threadIndex, addLabelIds, removeLabelIds);
}

function fetchMessages(index, callback) {
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
    let messages = [];
    for (var message of resp.messages) {
      let previousMessageText = messages.length && messages[messages.length - 1].raw;
      messages.push(processMessage(message, previousMessageText));
    }
    thread.addMessages(messages);
    callback(index);
  });
}

function compareThreads(a, b) {
  return LabelUtils.compareLabels(a.queue, b.queue);
}

function renderCurrentThread() {
  updateCounter();
  var content = document.getElementById('content');
  var subject = document.getElementById('subject');
  if (g_state.currentThreadIndex == g_state.threads.length) {
    content.textContent = 'All done triaging! \\o/ Reload to check for new threads.';
    subject.textContent = '';
    return;
  }
  content.textContent = '';

  var callback = (index) => {
    // If you cycle through threads quickly, then the callback for the previous
    // thread finishes before the current on has it's data.
    if (index != g_state.currentThreadIndex)
      return;

    let thread = g_state.threads[g_state.currentThreadIndex];

    subject.textContent = thread.messages[0].subject;

    var lastMessageElement;
    for (var message of thread.messages) {
      lastMessageElement = renderMessage(message);
      content.append(lastMessageElement);
    }
    var elementToScrollTo = document.querySelector('.unread') || lastMessageElement;
    elementToScrollTo.scrollIntoView();
    // Make sure that there's at least 50px of space above for showing that there's a
    // previous message.
    let y = elementToScrollTo.getBoundingClientRect().y;
    if (y < 50)
      document.documentElement.scrollTop -= 50 - y;

    // Prefetch the next thread for instant access.
    fetchMessages(nextThreadIndex(), (index) => {
      console.log(`Prefetched thread index: ${index})`);
    });
  }

  if (g_state.threads[g_state.currentThreadIndex].messages)
    callback(g_state.currentThreadIndex);
  else
    fetchMessages(g_state.currentThreadIndex, callback);
}

async function fetchThreads(label) {
  var query = 'in:inbox';
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

  return await getPageOfThreads(label);
}

async function updateThreadList(callback) {
  document.getElementById('loader').style.display = 'inline-block';
  await updateLabelList();

  let threads = await fetchThreads();

  if (threads.length) {
    var batch = gapi.client.newBatch();

    for (let i = 0; i < threads.length; i++) {
      let thread = threads[i];
      let threadWrapper = new Thread(thread);
      g_state.threads.push(threadWrapper);
      g_state.threadMap[thread.id] = threadWrapper;

      // Fetch the labels for each thread.
      batch.add(gapi.client.gmail.users.threads.get({
        'userId': USER_ID,
        'id': thread.id,
        'fields': 'id,messages/labelIds',
      }));
    }

    let resp = await batch;
    // For now just pretend that the labels on a thread are the union of the labels
    // on all it's messages.
    for (let index in resp.result) {
      let result = resp.result[index].result;
      let labelIds = new Set();
      for (let message of result.messages) {
        for (let labelId of message.labelIds) {
          labelIds.add(labelId);
        }
      }
      g_state.threadMap[result.id].addLabelIds(labelIds, g_state.idToLabel);
    }

    g_state.threads.sort(compareThreads);
  }

  updateCounter();
  document.getElementById('loader').style.display = 'none';
}

async function updateLabelList() {
  var response = await gapi.client.gmail.users.labels.list({
    'userId': USER_ID
  })

  g_state.labelToId = {};
  g_state.idToLabel = {};
  g_state.triagedLabels = [];
  for (var label of response.result.labels) {
    g_state.labelToId[label.name] = label.id;
    g_state.idToLabel[label.id] = label.name;

    if (label.name.startsWith(TRIAGED_LABEL + '/'))
      g_state.triagedLabels.push(label.name);
  }
}
