import {Action, registerActions} from '../Actions.js';
import {AddressCompose, autocompleteItemSelectedEventName} from '../AddressCompose.js';
import {login} from '../BaseMain.js';
import {EmailCompose} from '../EmailCompose.js';
import {ComposeModel} from '../models/ComposeModel.js';

import {HelpDialog} from './HelpDialog.js';
import {View} from './View.js';
import { Contacts } from '../Contacts.js';

let SEND: Action = {
  name: 'Send',
  description: 'Send the mail.',
};

let HELP: Action = {
  name: 'Help',
  description: 'Help tips.',
};

const ACTIONS = [SEND, HELP];
registerActions('Compose', ACTIONS);

const PRE_FILL_URL =
    '/compose?to=email@address.com&subject=This is my subject&body=This is the email itself';
const HELP_TEXT =
    `Put ## followed by a priority level in your email to automatically route your message to a that make-time priority. Valid priorities are ##must-do, ##urgent, ##backlog, ##delegate.

URL to prefill fields: <a href='${PRE_FILL_URL}'>${PRE_FILL_URL}</a>.
`;

interface QueryParameters {
   to?: string;
   subject?: string;
   body?: string;
}

export class ComposeView extends View {
  private to_: AddressCompose;
  private subject_: HTMLInputElement;
  private body_: EmailCompose;
  private inlineTo_: HTMLElement|undefined;

  constructor(
      private model_: ComposeModel, contacts: Contacts, private params_: QueryParameters = {}) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
      height: 100%;
    `;

    this.to_ = new AddressCompose(contacts);
    this.to_.addEventListener('input', this.debounceHandleUpdates_.bind(this));
    this.to_.addEventListener(
        autocompleteItemSelectedEventName,
        this.debounceHandleUpdates_.bind(this));
    this.to_.style.cssText = `
      flex: 1;
      line-height: 1em;
    `;
    this.appendLine_('To:\xa0', this.to_);

    this.subject_ = document.createElement('input');
    ;
    this.subject_.addEventListener(
        'input', this.debounceHandleUpdates_.bind(this));
    this.subject_.style.cssText = `
      border: 1px solid;
      flex: 1;
      outline: none;
      padding: 4px;
    `;
    this.appendLine_('Subject:\xa0', this.subject_);

    this.body_ = new EmailCompose(contacts);
    this.body_.style.cssText = `
      flex: 1 1 0;
      margin: 4px;
      display: flex;
      background-color: white;
      min-height: 50px;
    `;

    this.body_.addEventListener('email-added', this.handleUpdates_.bind(this));
    this.body_.addEventListener(
        'input', this.debounceHandleUpdates_.bind(this));
    this.append(this.body_);

    this.setActions(ACTIONS);
  }

  async init() {
    let localData = await this.model_.loadFromDisk();
    if (!localData)
      localData = this.params_;

    if (localData.to)
      this.to_.value = localData.to;
    if (localData.inlineTo)
      this.getInlineTo_().textContent = localData.inlineTo;
    if (localData.subject)
      this.subject_.value = localData.subject;
    if (localData.body)
      this.body_.value = localData.body;

    this.handleUpdates_();
    this.focusFirstEmpty_();

    await login();
  }

  appendLine_(...children: (string|Node)[]) {
    let line = this.createLine_(...children);
    this.append(line);
  }

  createLine_(...children: (string|Node)[]) {
    let line = document.createElement('div');
    line.style.cssText = `
      display: flex;
      margin: 4px;
      align-items: baseline;
    `;
    line.append(...children);
    return line;
  }

  inlineToText_() {
    if (!this.inlineTo_)
      return '';
    return this.inlineTo_.textContent;
  }

  getInlineTo_() {
    if (!this.inlineTo_) {
      this.inlineTo_ = document.createElement('div');
      let line = this.createLine_('Inline to:\xa0', this.inlineTo_);
      let parent = <HTMLElement>this.to_.parentNode;
      parent.after(line);
    }
    return this.inlineTo_;
  }

  debounceHandleUpdates_() {
    window.requestIdleCallback(this.handleUpdates_.bind(this));
  }

  clearInlineTo_() {
    if (this.inlineTo_)
      this.inlineTo_.textContent = '';
  }

  async handleUpdates_() {
    let emails = this.body_.getEmails();
    if (emails.length) {
      this.getInlineTo_().textContent = emails.join(', ');
    } else {
      this.clearInlineTo_();
    }

    this.model_.setTo(this.to_.value);
    this.model_.setInlineTo(this.inlineToText_());
    this.model_.setSubject(this.subject_.value);
    this.model_.setBody(this.body_.value);
    await this.model_.flush();
  }

  focusFirstEmpty_() {
    if (!this.to_.value) {
      this.to_.focus();
      return;
    }

    if (!this.subject_.value) {
      this.subject_.focus();
      return;
    }

    this.body_.focus();
  }

  async send_() {
    await this.model_.send();

    this.to_.value = this.params_.to || '';
    this.clearInlineTo_();
    this.subject_.value = this.params_.subject || '';
    this.body_.value = this.params_.body || '';
  }

  async takeAction(action: Action) {
    if (action == SEND) {
      await this.send_();
      return;
    }

    if (action == HELP) {
      new HelpDialog(HELP_TEXT);
      return;
    }

    throw `Invalid action: ${JSON.stringify(action)}`;
  }
}

window.customElements.define('mt-compose-view', ComposeView);
