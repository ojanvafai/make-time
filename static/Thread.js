class Thread {
  constructor(thread) {
    this.id = thread.id;
    this.snippet = thread.snippet;
    if (thread.messages)
      this.processMessages_(thread.messages);
  }

  processMessages_(messages) {
    this.labelIds = new Set();
    let processedMessages = [];
    for (var message of messages) {
      for (let labelId of message.labelIds) {
        this.labelIds.add(labelId);
      }

      let previousMessageText = messages.length && messages[messages.length - 1].html;
      processedMessages.push(this.processMessage_(message, previousMessageText));
    }
    this.subject = processedMessages[0].subject;
    this.processedMessages = processedMessages;

    this.labelNames = [];
    for (let id of this.labelIds) {
      // TODO: Don't use global state!
      let name = g_state.idToLabel[id];
      if (!name) {
        console.log(`Label id does not exist. WTF. ${id}`);
        continue;
      }
      if (name.startsWith(TO_TRIAGE_LABEL + '/'))
        this.queue = name;
      this.labelNames.push(name);
    }
  }

  async modify(addLabelIds, removeLabelIds) {
    let request = {
      'userId': USER_ID,
      'id': this.id,
      'addLabelIds': addLabelIds,
      'removeLabelIds': removeLabelIds,
    };
    return await gapi.client.gmail.users.threads.modify(request);
  }

  isInInbox() {
    return this.labelIds.has('INBOX');
  }

  async fetchMessageDetails() {
    if (this.processedMessages)
      return;

    var requestParams = {
      'userId': USER_ID,
      'id': this.id,
    }
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

    let html = output.html || htmlEscape(output.plain);

    // TODO: Test eliding works if current message is html but previous is plain or vice versa.
    if (previousMessageText)
      html = elideReply(html, previousMessageText);

    if (output.html)
      html = disableStyleSheets(html);

    output.processedHtml = html;
    output.isUnread = message.labelIds.includes('UNREAD');
    return output;
  }
}
