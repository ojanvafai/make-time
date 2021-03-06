import { Address } from '../third_party/emailjs-addressparser/addressparser.js';

import { AsyncOnce } from './AsyncOnce.js';
import { defined, parseAddressList, sandboxedDom, USER_ID } from './Base.js';
import { Base64 } from './base64.js';
import { QuoteElidedMessage } from './QuoteElidedMessage.js';

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
  private parsedFrom_?: Address[];
  private parsedTo_?: Address[];
  private parsedCc_?: Address[];
  private parsedBcc_?: Address[];

  private plain_: string | undefined;
  private plainedHtml_: string | undefined;
  private html_: string | undefined;
  private quoteElidedMessage_: QuoteElidedMessage | undefined;
  private quoteElidedMessageCreator_?: AsyncOnce<QuoteElidedMessage>;
  private rawMessage_!: gapi.client.gmail.Message;

  id: string;
  attachments_: AttachmentResult[];
  subject: string | undefined;
  date!: Date;
  from: string | undefined;
  replyTo: string | undefined;
  deliveredTo: string | undefined;
  to: string | undefined;
  cc: string | undefined;
  bcc: string | undefined;
  messageId: string | undefined;
  listId: string | undefined;
  isNoteToSelf: boolean | undefined;
  isUnread!: boolean;
  isDraft!: boolean;

  constructor(message: gapi.client.gmail.Message, private previousMessage_?: Message) {
    this.id = defined(message.id);

    this.rawMessage_ = message;
    this.updateLabelDerivedState_();

    this.attachments_ = [];

    let hasDate = false;

    let headers = defined(defined(message.payload).headers);
    for (var header of headers) {
      let name = defined(header.name);
      let value = defined(header.value);

      // Some mail users lower case header names (probably just spam).
      switch (name.toLowerCase()) {
        case 'subject':
          this.subject = value;
          break;
        case 'date':
          hasDate = true;
          this.date = new Date(value);
          break;
        case 'from':
          this.from = value;
          break;
        case 'reply-to':
          this.replyTo = value;
          break;
        case 'delivered-to':
          // This header seems to be included multiple times in some emails. At
          // least with gmail forwarding though the last instanced of the header
          // is the original address it was delivered to. In theory, it's
          // possible that one isn't in the sendAs list though and an earlier
          // one is, so should probably make Delivered-To a list and use the
          // last one that is a match when choosing which address to default to
          // for quick reply.
          this.deliveredTo = value;
          break;
        case 'to':
          this.to = value;
          break;
        case 'cc':
          this.cc = value;
          break;
        case 'bcc':
          this.bcc = value;
          break;
        case 'message-id':
          this.messageId = value;
          break;
        case 'list-id':
          this.listId = value;
          break;
        case 'x-mktime-metadata':
          this.isNoteToSelf = true;
      }
    }

    // Things like chats don't have a date header. Use internalDate as per
    // https://developers.google.com/gmail/api/release-notes#2015-06-18.
    if (!hasDate) this.date = new Date(Number(message.internalDate));
  }

  static minifyAddressNames(addresses: string[], shouldMinify: boolean) {
    if (shouldMinify) {
      addresses = addresses.map((x) => {
        let parts = x.split(' ');
        // Exclude things like Dr., Mr., etc.
        return parts[0].endsWith('.') && parts.length > 1 ? parts[1] : parts[0];
      });
    }
    return addresses.join(', ');
  }

  static minifyAddressList(addresses: Address[]) {
    let set: Set<string> = new Set();
    addresses.map((x) => {
      set.add(x.name || x.address.split('@')[0]);
    });
    return this.minifyAddressNames(Array.from(set), true);
  }

  get rawMessage() {
    return this.rawMessage_;
  }

  private updateLabelDerivedState_() {
    if (this.rawMessage_.labelIds) {
      let labels = this.rawMessage_.labelIds;
      this.isUnread = labels.includes('UNREAD');
      this.isDraft = labels.includes('DRAFT');
    } else {
      this.isUnread = false;
      this.isDraft = false;
    }
  }

  updateLabels(labelIds: string[]) {
    this.rawMessage_.labelIds = labelIds;
    this.updateLabelDerivedState_();
  }

  getHeaders() {
    return defined(defined(this.rawMessage_.payload).headers);
  }

  getHeaderValue(name: string) {
    name = name.toLowerCase();
    const headers = this.getHeaders();
    for (const header of headers) {
      if (defined(header.name).toLowerCase().includes(name)) return header.value;
    }
    return null;
  }

  getLabelIds() {
    return defined(this.rawMessage_.labelIds);
  }

  get parsedFrom() {
    if (!this.parsedFrom_) this.parsedFrom_ = this.from ? parseAddressList(this.from) : [];
    return this.parsedFrom_;
  }

  get parsedTo() {
    if (!this.parsedTo_) this.parsedTo_ = this.to ? parseAddressList(this.to) : [];
    return this.parsedTo_;
  }

  get parsedCc() {
    if (!this.parsedCc_) this.parsedCc_ = this.cc ? parseAddressList(this.cc) : [];
    return this.parsedCc_;
  }

  get parsedBcc() {
    if (!this.parsedBcc_) this.parsedBcc_ = this.bcc ? parseAddressList(this.bcc) : [];
    return this.parsedBcc_;
  }

  async getPlain() {
    await this.parseMessageBody_();
    if (this.plain_) return this.plain_;

    if (!this.plainedHtml_) {
      // If there's no email body at all, return empty string.
      if (!this.html_) return '';

      // Extract the text out of the HTML content.
      this.plainedHtml_ = sandboxedDom(this.html_).textContent;
    }

    return this.plainedHtml_;
  }

  async getHtmlOrPlain() {
    await this.parseMessageBody_();
    return this.html_ || this.plain_ || '';
  }

  async getHtmlOrHtmlWrappedPlain() {
    await this.parseMessageBody_();
    if (this.html_) return this.html_;

    // Convert plain text to be wrapped in divs instead of using newlines.
    // That way the eliding logic that operates on elements doesn't need any
    // special handling for plain text emails.
    //
    // Also, wrap the plain text in white-space:pre-wrap to make it render
    // nicely.
    let escaped = this.htmlEscape_(defined(this.plain_));

    // Normalize newlines to simplify the logic.
    let paragraphs = escaped.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let html = `<div style="white-space:pre-wrap"><div>${paragraphs.join(
      '</div><div>',
    )}</div></div>`;

    // For multiple newlines in a row, put <br>s since empty divs don't render.
    return html.replace(/<div><\/div>/g, '<br>');
  }

  async parseMessageBody_() {
    if (this.plain_ || this.html_) return;

    // If a message has no body at all, fallback to empty string.
    this.plain_ = '';
    let payload = defined(this.rawMessage_.payload);
    await this.getMessageBody_(payload.parts || [payload]);
  }

  async getQuoteElidedMessage() {
    if (!this.quoteElidedMessageCreator_) {
      // Only create the QuoteElidedMessage once per Message since
      // getQuoteElidedMessage can get called while there's an existing
      // getQuoteElidedMessage call in progress.
      this.quoteElidedMessageCreator_ = new AsyncOnce(async () => {
        let html = await this.getHtmlOrHtmlWrappedPlain();
        this.quoteElidedMessage_ = new QuoteElidedMessage(html, this.previousMessage_);
        let attachments = this.rewriteInlineImages_(this.quoteElidedMessage_);
        // Intentionally don't await this so we show the thread without waiting
        // for attachement image fetches.
        this.fetchInlineImages_(attachments);
        this.appendAttachments_(this.quoteElidedMessage_);
        return this.quoteElidedMessage_;
      });
    }
    return await this.quoteElidedMessageCreator_.do();
  }

  findAttachment_(contentId: string) {
    for (let attachment of this.attachments_) {
      if (attachment.contentId == contentId) return attachment;
    }
    return null;
  }

  appendAttachments_(dom: HTMLElement) {
    if (!this.attachments_.length) return;

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
    let inlineImages = <NodeListOf<HTMLImageElement>>dom.querySelectorAll('img[src^=cid]');
    for (let image of inlineImages) {
      let match = <any>image.src.match(/^cid:([^>]*)$/);
      let contentId = `<${match[1]}>`;
      let attachment = this.findAttachment_(contentId);

      // Clear out the image src until we have the actual attachment data to put
      // in a data URL. This way we avoid console and mixed content warnings
      // with trying to fetch cid: URLs.
      image.src = '';

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
        id: attachmentData.attachment.id,
        messageId: this.id,
        userId: USER_ID,
      });
      let data = await Message.base64_.decode(fetched.result.data || '');
      attachmentData.image.src = `data:${attachmentData.attachment.contentType},${data}`;
    }
  }

  parseAttachment_(attachment: gapi.client.gmail.MessagePart) {
    let result = <AttachmentResult>{
      id: defined(attachment.body).attachmentId,
      name: attachment.filename,
    };

    let headers = defined(attachment.headers);
    for (let header of headers) {
      switch (defined(header.name).toLowerCase()) {
        case 'content-type':
          result.contentType = defined(header.value).split(';')[0];
          break;

        case 'content-id':
          result.contentId = defined(header.value);
          break;
      }
    }
    return result;
  }

  async getMessageBody_(mimeParts: gapi.client.gmail.MessagePart[]) {
    for (var part of mimeParts) {
      // For the various 'multipart/*" mime types.
      if (part.parts) await this.getMessageBody_(part.parts);

      let body = defined(part.body);
      let attachmentId = body.attachmentId;
      if (attachmentId) {
        this.attachments_.push(this.parseAttachment_(part));
        continue;
      }

      switch (part.mimeType) {
        case 'text/plain':
          // Sometimes there are multiple text/plain blocks. Gmail seems to use
          // the first one and some messages clearly require that.
          if (!this.plain_) this.plain_ = await Message.base64_.urlDecode(defined(body.data));
          break;
        case 'text/html':
          // Sometimes there are multiple text/html blocks. Gmail seems to use
          // the first one and some messages clearly require that.
          if (!this.html_) this.html_ = await Message.base64_.urlDecode(defined(body.data));
          break;
      }
    }
  }

  htmlEscape_(html: string) {
    return html.replace(/[&<>"']/g, function (m) {
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
  }
}
