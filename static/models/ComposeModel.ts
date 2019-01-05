import {IDBKeyVal} from '../idb-keyval.js';
import {send} from '../Mail.js';

import {Model} from './Model.js';

const AUTO_SAVE_KEY = 'ComposeView-auto-save-key';

export class ComposeModel extends Model {
  private sending_: boolean;
  private to_: string;
  private inlineTo_: string;
  private subject_: string;
  private body_: string;

  constructor() {
    super();

    this.sending_ = false;
    this.to_ = '';
    this.inlineTo_ = '';
    this.subject_ = '';
    this.body_ = '';
  }

  async update() {}

  setTo(value: string) {
    this.to_ = value;
  }

  setInlineTo(value: string) {
    this.inlineTo_ = value;
  }

  setSubject(value: string) {
    this.subject_ = value;
  }

  setBody(value: string) {
    this.body_ = value;
  }

  async loadFromDisk() {
    return await IDBKeyVal.getDefault().get(AUTO_SAVE_KEY);
  }

  async flush() {
    if (!this.to_ && !this.inlineTo_ && !this.subject_ && !this.body_) {
      await IDBKeyVal.getDefault().del(AUTO_SAVE_KEY);
      return;
    }

    await IDBKeyVal.getDefault().set(AUTO_SAVE_KEY, {
      to: this.to_,
      inlineTo: this.inlineTo_,
      subject: this.subject_,
      body: this.body_,
    });
  }

  async send() {
    let to = '';
    if (this.to_)
      to += this.to_ + ',';
    if (this.inlineTo_)
      to += this.inlineTo_ + ',';

    if (!to || !to.includes('@') || !to.includes('.')) {
      alert(`To field does not include a valid email address: ${to}`);
      return;
    }

    if (!this.subject_) {
      alert(`Subject is empty.`);
      return;
    }

    if (this.sending_)
      return;
    this.sending_ = true;

    this.updateTitle('sending', 'Sending...');
    await send(this.body_, to, this.subject_);
    await IDBKeyVal.getDefault().del(AUTO_SAVE_KEY);
    this.updateTitle('sending');

    this.sending_ = false;
  }
}
