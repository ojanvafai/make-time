import { Base64 } from './base64.js';
import { QuoteElidedMessage } from './QuoteElidedMessage.js';
import { USER_ID } from './main.js';

export class Message {
  constructor(message, previousMessage) {
    this.base64_ = new Base64();

    this.rawMessage_ = message;
    this.previousMessage_ = previousMessage;
    this.id = message.id;

    this.attachments_ = [];

    for (var header of message.payload.headers) {
    // Some mail users lower case header names (probably just spam).
    switch (header.name.toLowerCase()) {
      case 'subject':
        this.subject = header.value;
        break;
      case 'date':
        this.date = new Date(header.value);
        break;
      case 'from':
        this.from = this.cleanseAddresses_(header.value);
        this.fromEmails = this.extractEmails_(this.from);
        this.fromName = this.extractName_(this.from);
        break;
      case 'to':
        this.to = this.cleanseAddresses_(header.value);
        this.toEmails = this.extractEmails_(this.to);
        break;
      case 'cc':
        this.cc = this.cleanseAddresses_(header.value);
        this.ccEmails = this.extractEmails_(this.cc);
        break;
      case 'bcc':
        this.bcc = this.cleanseAddresses_(header.value);
        this.bccEmails = this.extractEmails_(this.bcc);
        break;
      case 'message-id':
        this.messageId = header.value;
        break;
      case 'list-id':
        this.listId = header.value;
        break;
    }
    }

    // Things like chats don't have a date header. Use internalDate as per
    // https://developers.google.com/gmail/api/release-notes#2015-06-18.
    if (!this.date)
      this.date = new Date(Number(message.internalDate));

    this.isUnread = message.labelIds.includes('UNREAD');
  }

  getHeaderValue(name) {
    name = name.toLowerCase();
    for (var header of this.rawMessage_.payload.headers) {
      if (header.name.toLowerCase().includes(name))
        return header.value;
    }
    return null;
  }

  cleanseAddresses_(str) {
    return str.replace(/"/g, '');
  }

  getPlain() {
    this.parseMessageBody_();
    if (this.plain_)
      return this.plain_;

    if (!this.plainedHtml_) {
      if (!this.html_)
        throw `Message is missing both plain text and html email bodies. Message id: ${this.id}`;

      // Extract the text out of the HTML content.
      let div = document.createElement('div');
      div.innerHTML = this.html_;
      this.plainedHtml_ = div.textContent;
    }

    return this.plainedHtml_;
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

    // If a message has no body at all, fallback to empty string.
    this.plain_ = '';

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
      let dom = this.quoteElidedMessage_.getDom();
      this.disableStyleSheets_(dom);
      this.fetchInlineImages_(dom);
      this.appendAttachments_(dom);
    }
    return this.quoteElidedMessage_;
  }

  findAttachment_(contentId) {
    for (let attachment of this.attachments_) {
      if (attachment.contentId == contentId)
        return attachment;
    }
  }

  appendAttachments_(dom) {
    if (!this.attachments_.length)
      return;

    let title = document.createElement('b');
    title.textContent = 'Attachments (view in gmail to download)';
    dom.append(document.createElement('hr'), title);
    for (let attachment of this.attachments_) {
      let container = document.createElement('li');
      let link = document.createElement('a');
      link.textContent = attachment.name;
      container.append(link);
      dom.append(container);
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
      name: attachment.filename,
    };
    for (let header of attachment.headers) {
      switch (header.name.toLowerCase()) {
      case 'content-type':
        result.contentType = header.value.split(';')[0];
        break;

      case 'content-id':
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

      let attachmentId = part.body.attachmentId;
      if (attachmentId) {
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
