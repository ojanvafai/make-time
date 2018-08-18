class Message {
  constructor(message, previousMessage) {
    this.base64_ = new Base64();

    this.rawMessage_ = message;
    this.previousMessage_ = previousMessage;
    this.id = message.id;

    this.attachments_ = [];

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

  getHtmlOrHtmlWrappedPlain() {
    this.parseMessageBody_();
    if (this.html_)
      return this.html_;

    // Convert plain text to be wrapped in divs instead of using newlines.
    // That way the eliding logic that operates on elements doesn't need any
    // special handling for plain text emails.
    //
    // Also, wrap the plain text in white-space:pre-wrap to make it render nicely.
    let escaped = this.htmlEscape_(this.plain_);
    // Normalize newlines to simplify the logic.
    let paragraphs = escaped.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let html = `<div style="white-space:pre-wrap"><div>${paragraphs.join('</div><div>')}</div></div>`;
    // For multiple newlines in a row, put <br>s since empty divs don't render.
    return html.replace(/<div><\/div>/g, '<br>');
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

  getQuoteElidedMessage() {
    if (!this.quoteElidedMessage_) {
      let html = this.getHtmlOrHtmlWrappedPlain();
      this.quoteElidedMessage_ = new QuoteElidedMessage(html, this.previousMessage_);
      this.disableStyleSheets_(this.quoteElidedMessage_.getDom());
      this.fetchInlineImages_(this.quoteElidedMessage_.getDom());
    }
    return this.quoteElidedMessage_;
  }

  findAttachment_(contentId) {
    for (let attachment of this.attachments_) {
      if (attachment.contentId == contentId)
        return attachment;
    }
  }

  async fetchInlineImages_(dom) {
    let inlineImages = dom.querySelectorAll('img[src^=cid]');
    for (let image of inlineImages) {
      let contentId = `<${image.src.match(/^cid:([^>]*)$/)[1]}>`;
      let attachment = await this.findAttachment_(contentId);
      let fetched = await gapi.client.gmail.users.messages.attachments.get({
        'id': attachment.id,
        'messageId': this.id,
        'userId': USER_ID,
      });
      let data = this.base64_.base64decode(fetched.result.data);
      image.src = `data:${attachment.contentType},${data}`;
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

  extractName_(str) {
    let parts = str.split('<');
    if (parts.length > 1)
      return parts[0].trim();
    return str;
  }

  parseAttachment_(attachment) {
    let result = {
      id: attachment.body.attachmentId,
    };
    for (let header of attachment.headers) {
      switch (header.name) {
      case 'Content-Type':
        let parts = header.value.split('; name=');
        result.contentType = parts[0];
        result.name = parts[1];
        break;

      case 'Content-ID':
        result.contentId = header.value;
        break;
      }
    }
    return result;
  }

  getMessageBody_(mimeParts) {
    for (var part of mimeParts) {
      // For the various 'multipart/*" mime types.
      if (part.parts)
        this.getMessageBody_(part.parts);

      if (part.body.attachmentId) {
        this.attachments_.push(this.parseAttachment_(part));
        continue;
      }

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
  disableStyleSheets_(messageDom) {
    let styles = messageDom.querySelectorAll('style');
    for (let style of styles) {
      style.setAttribute('type', 'not-css');
    }
  }
}
