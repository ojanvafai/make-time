import {defined, parseAddressList} from '../Base.js';
import {IDBKeyVal} from '../idb-keyval.js';
import {AddressHeaders, send} from '../Mail.js';

import {Model} from './Model.js';

const AUTO_SAVE_KEY = 'ComposeView-auto-save-key';

export class ComposeModel extends Model {
  private sending_: boolean;
  private sender_?: gapi.client.gmail.SendAs;
  private to_: string;
  private inlineTo_: string;
  private subject_: string;
  private body_: string;
  private bodyPlainText_: string;

  constructor() {
    super();

    this.sending_ = false;
    this.to_ = '';
    this.inlineTo_ = '';
    this.subject_ = '';
    this.body_ = '';
    this.bodyPlainText_ = '';
  }

  async update() {}

  setSender(value?: gapi.client.gmail.SendAs) {
    this.sender_ = value;
  }

  setTo(value: string) {
    this.to_ = value;
  }

  setInlineTo(value: string) {
    this.inlineTo_ = value;
  }

  setSubject(value: string) {
    this.subject_ = value;
  }

  setBody(value: string, plainText: string) {
    this.body_ = value;
    this.bodyPlainText_ = plainText;
  }

  // TODO: Move this to firestore so it syncs across clients.
  async loadFromDisk() {
    return await IDBKeyVal.getDefault().get(AUTO_SAVE_KEY);
  }

  async flush() {
    // Intentionally only flush if the body has non-whitespace to balance not
    // accidentally sending emails to people because you didn't notice that the
    // to field had old values but also not losing a long email if maketime
    // crashes or something. Look for any whitespace so that you don't end up
    // with stray whitespace prefilling the body when trying to autosend.
    if (this.bodyPlainText_.match(/^\s*$/)) {
      await IDBKeyVal.getDefault().del(AUTO_SAVE_KEY);
      return;
    }

    await IDBKeyVal.getDefault().set(AUTO_SAVE_KEY, {
      sender: this.sender_,
      to: this.to_,
      inlineTo: this.inlineTo_,
      subject: this.subject_,
      body: this.body_,
    });
  }

  hasInvalidAddresses_(value: string) {
    let addresses = parseAddressList(value);
    for (let address of addresses) {
      if (!address.address)
        return true;
      let parts = address.address.split('@');
      if (parts.length !== 2)
        return true;
      if (!parts[1].includes('.'))
        return true;
    }
    return false;
  }

  async send(sanitizedBodyText: string) {
    if (this.hasInvalidAddresses_(this.to_)) {
      alert(`To field has an invalid email address: ${this.to_}`);
      return;
    }

    if (!this.subject_) {
      alert(`Subject is empty.`);
      return;
    }

    let to = this.to_ || '';

    if (this.inlineTo_) {
      if (to)
        to += ', ';
      to += this.inlineTo_;
    }

    if (this.sending_)
      return;
    this.sending_ = true;

    let addressHeaders = new Map();
    addressHeaders.set(AddressHeaders.To, parseAddressList(to));

    let sent;
    try {
      sent = await send(
          this.body_, addressHeaders, this.subject_, defined(this.sender_));
      await IDBKeyVal.getDefault().del(AUTO_SAVE_KEY);
    } finally {
      this.sending_ = false;
    }

    return {
      to: to, subject: this.subject_, body: sanitizedBodyText, response: sent
    }
  }
}
