import {Action, registerActions} from '../Actions.js';
import {AddressCompose} from '../AddressCompose.js';
import {getMyEmail} from '../Base.js';
import {login} from '../BaseMain.js';
import {EmailCompose} from '../EmailCompose.js';
import {ComposeModel} from '../models/ComposeModel.js';

import {HelpDialog} from './HelpDialog.js';
import {View} from './View.js';

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

async function getHelpText() {
  const PRE_FILL_URL =
      '/compose?to=email@address.com&subject=This is my subject&body=This is the email itself';
  return `For quick notes to yourself, you can create links and homescreen shortcuts, e.g. click this link: <a href='${
      PRE_FILL_URL}'>${PRE_FILL_URL}</a>.

Even better, you can make a custom search engine on desktop Chrome that will autosend emails with the autosend parameter. In Chrome's Manage Search Engine settings, click the add button and fill in the following:
 - Search engine: Put whatever name you want here
 - Keyword: mk
 - URL with %s in place of query:
     ${window.location.origin}/compose?autosend=1&to=${
      await getMyEmail()}&subject=%s

Now in chrome you can type "mt", tab, then a message it it will send you an email address that you can triage later. This is great for quick jotting down of thoughts.
`;
}

interface QueryParameters {
  to?: string;
  subject?: string;
  body?: string;
  autosend?: string;
}

export class ComposeView extends View {
  private to_: AddressCompose;
  private subject_: HTMLInputElement;
  private body_: EmailCompose;
  private inlineTo_: AddressCompose;

  constructor(
      private model_: ComposeModel, private params_: QueryParameters = {}) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
      height: 100%;
    `;

    this.to_ = new AddressCompose();
    this.to_.addEventListener('input', this.debounceHandleUpdates_.bind(this));
    this.to_.style.flex = '1';
    this.appendLine_('To:\xa0', this.to_);

    this.subject_ = document.createElement('input');
    this.subject_.placeholder = 'Subject';
    this.subject_.addEventListener(
        'input', this.debounceHandleUpdates_.bind(this));
    this.subject_.style.cssText = `
      border: 1px solid;
      flex: 1;
      outline: none;
      padding: 4px;
    `;
    this.appendLine_(this.subject_);

    this.body_ = new EmailCompose();
    this.body_.style.cssText = `
      flex: 1 1 0;
      margin: 4px;
      display: flex;
      background-color: white;
      min-height: 50px;
    `;

    this.body_.addEventListener('email-added', () => this.handleUpdates_());
    this.body_.addEventListener(
        'input', this.debounceHandleUpdates_.bind(this));
    this.append(this.body_);

    this.inlineTo_ = new AddressCompose(true);
    this.inlineTo_.style.flex = '1';

    this.setActions(ACTIONS);
  }

  shouldAutoSend() {
    return this.params_ && this.params_.autosend === '1';
  }

  async init() {
    let localData = await this.model_.loadFromDisk();
    if (!localData)
      localData = this.params_;

    if (localData.to)
      this.to_.value = localData.to;
    if (localData.inlineTo)
      this.getInlineTo_().value = localData.inlineTo;
    if (localData.subject)
      this.subject_.value = localData.subject;
    if (localData.body)
      this.body_.value = localData.body;

    if (!this.shouldAutoSend()) {
      this.handleUpdates_();
      this.focusFirstEmpty_();
    }

    await login();

    if (this.shouldAutoSend()) {
      this.handleUpdates_(true);
      this.send_();
    }
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
      align-items: center;
    `;
    line.append(...children);
    return line;
  }

  inlineToText_() {
    if (!this.inlineTo_)
      return '';
    return this.inlineTo_.value;
  }

  getInlineTo_() {
    if (!this.inlineTo_.parentNode) {
      let line = this.createLine_('In email:\xa0', this.inlineTo_);
      let parent = <HTMLElement>this.to_.parentNode;
      parent.after(line);
    }
    return this.inlineTo_;
  }

  debounceHandleUpdates_() {
    window.requestIdleCallback(() => this.handleUpdates_());
  }

  clearInlineTo_() {
    if (this.inlineTo_)
      this.inlineTo_.value = '';
  }

  async handleUpdates_(skipFlushToDisk?: boolean) {
    let emails = this.body_.getEmails();
    if (emails.length) {
      this.getInlineTo_().value = emails.join(', ');
    } else {
      this.clearInlineTo_();
    }

    this.model_.setTo(this.to_.value);
    this.model_.setInlineTo(this.inlineToText_());
    this.model_.setSubject(this.subject_.value);
    this.model_.setBody(this.body_.rawValue);
    if (!skipFlushToDisk)
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
    let sent = await this.model_.send(this.body_.value);
    if (!sent)
      return;

    if (this.shouldAutoSend()) {
      document.write(`<pre><h1>Sent</h1>
<b>to:</b>${sent.to}

<b>subject:</b>${sent.subject}

<b>body:</b>
${sent.body}
</pre>`);
    }

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
      new HelpDialog(await getHelpText());
      return;
    }

    throw `Invalid action: ${JSON.stringify(action)}`;
  }
}

window.customElements.define('mt-compose-view', ComposeView);
