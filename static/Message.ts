import {USER_ID} from './Base.js';
import {Base64} from './base64.js';
import {QuoteElidedMessage} from './QuoteElidedMessage.js';

interface AttachmentResult {
  id: string;
  name: string;
  contentType: string;
  contentId: string;
}

interface ImageAttachmentData {
  image: HTMLImageElement;
  attachment: AttachmentResult;
}

export class Message {
  static base64_ = new Base64();
  private plain_: string|undefined;
  private plainedHtml_: string|undefined;
  private html_: string|undefined;
  private quoteElidedMessage_: QuoteElidedMessage|undefined;

  id: string;
  attachments_: any[];
  subject: string|undefined;
  date!: Date;
  from: string|undefined;
  fromEmails: string[]|undefined;
  fromName: string|undefined;
  to: string|undefined;
  toEmails: string[]|undefined;
  toName: string|undefined;
  cc: string|undefined;
  ccEmails: string[]|undefined;
  ccName: string|undefined;
  bcc: string|undefined;
  bccEmails: string[]|undefined;
  bccName: string|undefined;
  messageId: string|undefined;
  listId: string|undefined;
  isUnread: boolean;
  isDraft: boolean;

  constructor(public rawMessage: any, private previousMessage_?: Message) {
    this.id = rawMessage.id;

    this.attachments_ = [];

    let hasDate = false;

    for (var header of rawMessage.payload.headers) {
      // Some mail users lower case header names (probably just spam).
      switch (header.name.toLowerCase()) {
        case 'subject':
          this.subject = header.value;
          break;
        case 'date':
          hasDate = true;
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
    if (!hasDate)
      this.date = new Date(Number(rawMessage.internalDate));

    this.isUnread = rawMessage.labelIds.includes('UNREAD');
    this.isDraft = rawMessage.labelIds.includes('DRAFT');
  }

  updateLabels(labelIds: string[]) {
    this.rawMessage.labelIds = labelIds;
  }

  getHeaderValue(name: string) {
    name = name.toLowerCase();
    for (var header of this.rawMessage.payload.headers) {
      if (header.name.toLowerCase().includes(name))
        return header.value;
    }
    return null;
  }

  cleanseAddresses_(str: string) {
    return str.replace(/"/g, '');
  }

  getLabelIds() {
    return this.rawMessage.labelIds;
  }

  getPlain() {
    this.parseMessageBody_();
    if (this.plain_)
      return this.plain_;

    if (!this.plainedHtml_) {
      // If there's no email body at all, return empty string.
      if (!this.html_)
        return '';

      // Extract the text out of the HTML content.
      let div: HTMLElement = document.createElement('div');
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
    return this.html_ || this.plain_ || '';
  }

  getHtmlOrHtmlWrappedPlain() {
    this.parseMessageBody_();
    if (this.html_)
      return this.html_;

    // Convert plain text to be wrapped in divs instead of using newlines.
    // That way the eliding logic that operates on elements doesn't need any
    // special handling for plain text emails.
    //
    // Also, wrap the plain text in white-space:pre-wrap to make it render
    // nicely.
    if (this.plain_ === undefined)
      throw 'Something went wrong. This should never happen.';
    let escaped = this.htmlEscape_(this.plain_);

    // Normalize newlines to simplify the logic.
    let paragraphs =
        escaped.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let html = `<div style="white-space:pre-wrap"><div>${
        paragraphs.join('</div><div>')}</div></div>`;

    // For multiple newlines in a row, put <br>s since empty divs don't render.
    return html.replace(/<div><\/div>/g, '<br>');
  }

  parseMessageBody_() {
    if (this.plain_ || this.html_)
      return;

    // If a message has no body at all, fallback to empty string.
    this.plain_ = '';

    if (this.rawMessage.payload.parts) {
      this.getMessageBody_(this.rawMessage.payload.parts);
    } else {
      let messageText =
          Message.base64_.decode(this.rawMessage.payload.body.data);
      if (this.rawMessage.payload.mimeType == 'text/html')
        this.html_ = messageText;
      else
        this.plain_ = messageText;
    }
  }

  getQuoteElidedMessage() {
    if (!this.quoteElidedMessage_) {
      let html = this.getHtmlOrHtmlWrappedPlain();
      this.quoteElidedMessage_ =
          new QuoteElidedMessage(html, this.previousMessage_);
      let dom = this.quoteElidedMessage_.getDom();
      this.disableStyleSheets_(dom);
      let attachments = this.rewriteInlineImages_(dom);
      // Intentionally don't await this so we show the thread without waiting
      // for attachement image fetches.
      this.fetchInlineImages_(attachments);
      this.appendAttachments_(dom);
    }
    return <QuoteElidedMessage>this.quoteElidedMessage_;
  }

  findAttachment_(contentId: string) {
    for (let attachment of this.attachments_) {
      if (attachment.contentId == contentId)
        return attachment;
    }
  }

  appendAttachments_(dom: HTMLElement) {
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

  rewriteInlineImages_(dom: HTMLElement) {
    let imageData: ImageAttachmentData[] = [];
    let inlineImages =
        <NodeListOf<HTMLImageElement>>dom.querySelectorAll('img[src^=cid]');
    for (let image of inlineImages) {
      let match = <any>image.src.match(/^cid:([^>]*)$/);
      let contentId = `<${match[1]}>`;
      let attachment = this.findAttachment_(contentId);

      // Clear out the image src until we have the actual attachment data to put
      // in a data URL. This way we avoid console and mixed content warnings
      // with trying to fetch cid: URLs.
      image.src = 'about:blank';

      // There can be images from quoted sections that no longer have the
      // attachments. So handle them gracefully.
      if (!attachment) {
        continue;
      }

      imageData.push({
        image: image,
        attachment: attachment,
      });
    }
    return imageData;
  }

  async fetchInlineImages_(attachments: ImageAttachmentData[]) {
    for (let attachmentData of attachments) {
      let fetched = await gapi.client.gmail.users.messages.attachments.get({
        'id': attachmentData.attachment.id,
        'messageId': this.id,
        'userId': USER_ID,
      });
      let data = Message.base64_.base64decode(fetched.result.data || '');
      attachmentData.image.src =
          `data:${attachmentData.attachment.contentType},${data}`;
    }
  }

  // TODO: Restructure so people can search over the plain text of the emails as
  // well.
  extractEmails_(str: string) {
    var regex = new RegExp('<(.*?)>|(\\S*?@\\S*)', 'g');
    str = str.toLowerCase();
    var emails: string[] = [];
    var match;
    while ((match = regex.exec(str.toLowerCase())) !== null) {
      for (var i = 1; i < match.length; ++i) {
        if (match[i]) {
          emails.push(match[i]);
        }
      }
    }
    return emails;
  }

  extractName_(str: string) {
    let parts = str.split('<');
    if (parts.length > 1)
      return parts[0].trim();
    return str;
  }

  parseAttachment_(attachment: any) {
    let result = <AttachmentResult>{
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

  getMessageBody_(mimeParts: any) {
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
          this.plain_ = Message.base64_.decode(part.body.data);
          break;
        case 'text/html':
          this.html_ = Message.base64_.decode(part.body.data);
          break;
      }
    }
  }

  htmlEscape_(html: string) {
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
        default:
          throw `Matched a character that isn't being escaped.`;
          return m;
      }
    });
  };

  // Don't want stylesheets in emails to style the whole page.
  disableStyleSheets_(messageDom: HTMLElement) {
    let styles = messageDom.querySelectorAll('style');
    for (let style of styles) {
      style.setAttribute('type', 'not-css');
    }
  }
}
