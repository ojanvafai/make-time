class Message {
  constructor(message, previousMessageText) {
    this.base64_ = new Base64();

    this.rawMessage_ = message;
    this.previousMessageText_ = previousMessageText;

    this.id = message.id;

    for (var header of message.payload.headers) {
      switch (header.name) {
        case 'Subject':
          this.subject = header.value;
          break;
        case 'Date':
          this.date = new Date(header.value);
          break;
        case 'From':
          this.from = this.extractEmails_(header.value);
          this.fromName = this.extractName_(header.value);
          this.rawFrom = header.value;
          break;
        case 'Sender':
          this.sender = this.extractEmails_(header.value);
          break;
        case 'To':
          this.to = this.extractEmails_(header.value);
          this.rawTo = header.value;
          break;
        case 'Cc':
          this.cc = this.extractEmails_(header.value);
          this.rawCc = header.value;
          break;
        case 'Bcc':
          this.bcc = this.extractEmails_(header.value);
          break;
        case 'Message-ID':
          this.messageId = header.value;
          break;
        case 'X-Autoreply':
          this.xAutoreply = header.value;
          break;
      }
    }
    this.isUnread = message.labelIds.includes('UNREAD');
  }

  getPlain() {
    this.parseMessageBody_();
    return this.plain_;
  }

  getHtml() {
    this.parseMessageBody_();
    return this.html_;
  }

  getHtmlOrPlain() {
    this.parseMessageBody_();
    return this.html_ || this.plain_;
  }

  parseMessageBody_() {
    if (this.plain_ || this.html_)
      return;

    var plainTextBody;
    var htmlBody;
    if (this.rawMessage_.payload.parts) {
      this.getMessageBody_(this.rawMessage_.payload.parts, this);
    } else {
      let messageText = this.base64_.decode(this.rawMessage_.payload.body.data);;
      if (this.rawMessage_.payload.mimeType == "text/html")
        this.html_ = messageText;
      else
        this.plain_ = messageText;
    }
  }

  getProcessedHtml() {
    if (!this.processedHtml_) {
      let html;
      if (this.getHtml())
        html = this.disableStyleSheets_(this.getHtml());
      else
        html = `<div style="white-space:pre-wrap">${this.htmlEscape_(this.getPlain())}</div>`;

      // TODO: Test eliding works if current message is html but previous is plain or vice versa.
      if (this.previousMessageText_)
        html = this.elideReply_(html, this.previousMessageText_);

      this.processedHtml_ = html;
    }

    return this.processedHtml_;
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

  extractName_(str) {
    let parts = str.split('<');
    if (parts.length > 1)
      return parts[0].trim();
    return str;
  }

  getMessageBody_(mimeParts) {
    for (var part of mimeParts) {
      // For the various 'multipart/*" mime types.
      if (part.parts)
        this.getMessageBody_(part.parts);

      // TODO: Show attachments.
      if (part.body.attachmentId)
        continue;

      switch (part.mimeType) {
        case 'text/plain':
          this.plain_ = this.base64_.decode(part.body.data);
          break;
        case 'text/html':
          this.html_ = this.base64_.decode(part.body.data);
          break;
      }
    }
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
        <div class="toggler" onclick="Message.toggleElided(event, this)">...</div>
      </div>
    </div><div class="elide">`;
    let postfix = `</div>`;

    let differ = new Differ(prefix, postfix, windowSize, minimumLength);
    return differ.diff(messageText, previousMessageText);
  }
}

Message.toggleElided = (e, element) => {
  // TODO: Remove this once we properly avoid eliding halfway through a link.
  e.preventDefault();

  while (!element.nextElementSibling || element.nextElementSibling.className != 'elide') {
    element = element.parentNode;
  }
  let elided = element.nextElementSibling;
  var current = getComputedStyle(elided).display;
  elided.style.display = current == 'none' ? 'inline' : 'none';
}
