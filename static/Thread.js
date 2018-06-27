class Thread {
  constructor(thread) {
    this.id = thread.id;
    this.snippet = thread.snippet;
  }

  clearDetails_() {
    this.labelIds_ = null;
    this.labelNames_ = null;
    this.queue_ = null;
    this.processedMessages_ = null;
  }

  processLabels_(messages) {
    if (this.labelIds_)
      return;

    this.labelIds_ = new Set();
    for (var message of messages) {
      for (let labelId of message.labelIds) {
        this.labelIds_.add(labelId);
      }
    }

    this.labelNames_ = [];
    for (let id of this.labelIds_) {
      // TODO: Don't use global state!
      let name = g_labels.idToLabel[id];
      if (!name) {
        console.log(`Label id does not exist. WTF. ${id}`);
        continue;
      }
      if (name.startsWith(TO_TRIAGE_LABEL + '/'))
        this.queue_ = name;
      this.labelNames_.push(name);
    }
  }

  processMessages_(messages) {
    this.processLabels_(messages);

    // Check if we only fetched labels or if we also have message content.
    if (!messages[0].payload)
      return;

    let processedMessages = [];
    for (var message of messages) {
      let previousMessageText = processedMessages.length && processedMessages[processedMessages.length - 1].html;
      processedMessages.push(this.processMessage_(message, previousMessageText));
    }
    this.processedMessages_ = processedMessages;
  }

  async modify(addLabelIds, removeLabelIds) {
    let request = {
      'userId': USER_ID,
      'id': this.id,
      'addLabelIds': addLabelIds,
      'removeLabelIds': removeLabelIds,
    };
    let response = await gapi.client.gmail.users.threads.modify(request);
    // TODO: Handle response.status != 200.

    // Once a modify has happend the stored message details are stale and will need refeteching
    // if this Thread instance continued to be used.
    this.clearDetails_();
  }

  async markTriaged(destination) {
    var addLabelIds = [];
    if (destination)
      addLabelIds.push(await getLabelId(destination));

    var removeLabelIds = ['UNREAD', 'INBOX'];
    var queue = await this.getQueue();
    if (queue)
      removeLabelIds.push(await getLabelId(queue));
    await this.modify(addLabelIds, removeLabelIds);
    return {
      added: addLabelIds,
      removed: removeLabelIds,
      thread: this,
    }
  }

  isInInbox() {
    return this.labelIds_.has('INBOX');
  }

  async getLabelIds() {
    await this.fetchOnlyLabels_();
    return this.labelIds_;
  }

  async getLabelNames() {
    await this.fetchOnlyLabels_();
    return this.labelNames_;
  }

  async getSubject() {
    await this.fetchMessageDetails();
    return this.processedMessages_[0].subject;
  }

  async getMessages() {
    await this.fetchMessageDetails();
    return this.processedMessages_;
  }

  async getDisplayableQueue() {
    await this.fetchOnlyLabels_();
    if (!this.queue_)
      return 'inbox';
    return removeTriagedPrefix(this.queue_);
  }

  async getQueue() {
    await this.fetchOnlyLabels_();
    return this.queue_;
  }

  async fetchOnlyLabels_() {
    if (this.queue_)
      return;

    await this.fetchMessageDetails({
      fields: 'id,messages/labelIds',
    })
  }

  async fetchMessageDetails(opt_extraParams) {
    if (this.processedMessages_)
      return;

    let requestParams = opt_extraParams || {};
    requestParams.userId = USER_ID;
    requestParams.id = this.id;

    let resp = await gapi.client.gmail.users.threads.get(requestParams);
    this.processMessages_(resp.result.messages);
  }

  getMessageBody_(mimeParts, output) {
    for (var part of mimeParts) {
      // For the various 'multipart/*" mime types.
      if (part.parts)
        this.getMessageBody_(part.parts, output);

      switch (part.mimeType) {
        case 'text/plain':
          output.plain = base64.decode(part.body.data);
          break;
        case 'text/html':
          output.html = base64.decode(part.body.data);
          break;
      }
    }
  }

  // TODO: Restructure so people can search over the plain text of the emails as well.
  extractEmails_(str) {
    var regex = new RegExp('<(.*?)>|(\\S*?@\\S*)', 'g');
    str = str.toLowerCase();
    var emails = [];
    var match;
    while ((match = regex.exec(str.toLowerCase())) !== null) {
      for (var i = 1; i < match.length; ++i) {
        if (match[i]) {
          emails.push(String(match[i]));
        }
      }
    }
    return emails;
  }

  processMessage_(message, previousMessageText) {
    let output = {};

    for (var header of message.payload.headers) {
      switch (header.name) {
        case 'Subject':
          output.subject = header.value;
          break;
        case 'From':
          output.from = this.extractEmails_(header.value);
          break;
        case 'To':
          output.to = this.extractEmails_(header.value);
          break;
        case 'Cc':
          output.cc = this.extractEmails_(header.value);
          break;
        case 'Bcc':
          output.bcc = this.extractEmails_(header.value);
          break;
        case 'X-Autoreply':
          output.xAutoreply = header.value;
          break;
      }
    }

    var plainTextBody;
    var htmlBody;
    if (message.payload.parts) {
      this.getMessageBody_(message.payload.parts, output);
    } else {
      output.plain = output.html = base64.decode(message.payload.body.data);
    }

    let html = output.html || this.htmlEscape_(output.plain);

    // TODO: Test eliding works if current message is html but previous is plain or vice versa.
    if (previousMessageText)
      html = this.elideReply_(html, previousMessageText);

    if (output.html)
      html = this.disableStyleSheets_(html);

    output.processedHtml = html;
    output.isUnread = message.labelIds.includes('UNREAD');
    return output;
  }

  htmlEscape_(html) {
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

  // Don't want stylesheets in emails to style the whole page.
  disableStyleSheets_(messageText) {
    return messageText.replace(/<style/g, '<style type="not-css"');
  }

  // TODO: Move this and associated code into Thread.js.
  elideReply_(messageText, previousMessageText) {
    let windowSize = 100;
    let minimumLength = 100;
    // Lazy hacks to get the element whose display to toggle
    // and to get this to render centered-ish elipsis without using an image.
    let prefix = `<div style="overflow:hidden">
      <div style="margin-top:-7px">
        <div class="toggler" onclick="Thread.toggleDisplayInline(this.parentNode.parentNode.nextSibling)">...</div>
      </div>
    </div>
    <div class="elide">`;
    let postfix = `</div>`;

    let differ = new Differ(prefix, postfix, windowSize, minimumLength);
    return differ.diff(messageText, previousMessageText);
  }

}

Thread.toggleDisplayInline = (element) => {
  var current = getComputedStyle(element).display;
  element.style.display = current == 'none' ? 'inline' : 'none';
}
