import {Action, ActionList, Actions, registerActions} from '../Actions.js';
import {AddressCompose} from '../AddressCompose.js';
import {createLink, defined, getMyEmail, isMobileUserAgent, notNull, serializeAddress} from '../Base.js';
import {login} from '../BaseMain.js';
import {EmailCompose, INSERT_LINK} from '../EmailCompose.js';
import {MailProcessor} from '../MailProcessor.js';
import {ComposeModel} from '../models/ComposeModel.js';
import {SendAs} from '../SendAs.js';
import {Thread} from '../Thread.js';
import {BASE_THREAD_ACTIONS, takeAction} from '../ThreadActions.js';

import {HelpDialog} from './HelpDialog.js';
import {View} from './View.js';

let SEND: Action = {
  name: 'Send',
  key: 's',
  description: 'Send the mail.',
};

let HELP: Action = {
  name: 'Help',
  key: 'h',
  description: 'Help tips.',
};

let CLOSE: Action = {
  name: 'X',
  key: 'x',
  description: 'Close this window.',
};

let SENT_ACTIONS: ActionList = [
  ...BASE_THREAD_ACTIONS,
  CLOSE,
];

const ACTIONS = [SEND, INSERT_LINK, HELP];

// TODO: Make insert link a proper action on both ComposeView and
// ThreadListView's quick reply.
registerActions('Compose', [
  ...ACTIONS,
  ...SENT_ACTIONS,
]);

async function getHelpText() {
  const PRE_FILL_URL =
      '/compose?to=email@address.com&subject=This is my subject&body=This is the email itself';
  return [
    `For quick notes to yourself, you can create links and homescreen shortcuts, e.g. click this link: `,
    createLink(PRE_FILL_URL, PRE_FILL_URL),
    `

Even better, you can make a custom search engine on desktop Chrome that will autosend emails with the autosend parameter. In Chrome's Manage Search Engine settings, click the add button and fill in the following:
 - Search engine: Put whatever name you want here
 - Keyword: mk
 - URL with %s in place of query:
     ${window.location.origin}/compose?autosend=1&to=${
        await getMyEmail()}&subject=%s

Now in chrome you can type "mt", tab, then a message it it will send you an email address that you can triage later. This is great for quick jotting down of thoughts.
`
  ];
}

interface QueryParameters {
  to?: string;
  subject?: string;
  body?: string;
  autosend?: string;
}

export class ComposeView extends View {
  private from_: HTMLSelectElement;
  private to_: AddressCompose;
  private subject_: HTMLInputElement;
  private body_: EmailCompose;
  private inlineTo_: AddressCompose;
  private sendAs_?: SendAs;
  private sent_?: HTMLElement;
  private sentThreadId_?: string;
  private sentToolbar_?: Actions;
  private autoSend_: boolean;

  constructor(
      private model_: ComposeModel, private params_: QueryParameters = {},
      private getMailProcessor_: () => Promise<MailProcessor>) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
      height: 100%;
      max-width: var(--max-width);
      margin: auto;
    `;

    this.autoSend_ = this.params_ && this.params_.autosend === '1';

    this.from_ = document.createElement('select');
    this.from_.addEventListener(
        'change', this.debounceHandleUpdates_.bind(this));
    this.appendLine_('From:\xa0', this.from_);

    this.to_ = new AddressCompose();
    this.to_.addEventListener('input', this.debounceHandleUpdates_.bind(this));
    this.to_.style.flex = '1';
    this.to_.style.fontSize = 'small';
    this.appendLine_('To:\xa0', this.to_);

    this.subject_ = document.createElement('input');
    this.subject_.placeholder = 'Subject';
    this.subject_.addEventListener(
        'input', this.debounceHandleUpdates_.bind(this));
    this.subject_.style.cssText = `
      flex: 1;
      outline: none;
      padding: 4px;
      background-color: var(--nested-background-color);
      font-size: small;
    `;
    this.appendLine_(this.subject_);

    this.body_ = new EmailCompose();
    this.body_.style.flex = '1 1 0';
    this.body_.style.minHeight = '50px';

    this.body_.addEventListener('email-added', () => this.handleUpdates_());
    this.body_.addEventListener(
        'input', this.debounceHandleUpdates_.bind(this));
    this.append(this.body_);

    this.inlineTo_ = new AddressCompose(true);
    this.inlineTo_.style.flex = '1';

    this.setActions(ACTIONS, SENT_ACTIONS);
  }

  async setFrom_(selected?: gapi.client.gmail.SendAs) {
    this.sendAs_ = await SendAs.getDefault();
    let senders = defined(
        this.sendAs_.senders,
        `Gmail didn't give make-time a list of from addresses. This should never happen. Please file a make-time bug. `)

    for (let sender of senders) {
      let option = document.createElement('option');
      option.append(defined(sender.sendAsEmail));
      if (selected ? sender.sendAsEmail === selected.sendAsEmail :
                     sender.isDefault)
        option.setAttribute('selected', 'true');
      this.from_.append(option);
    }
  }

  async init() {
    let localData = await this.model_.loadFromDisk();
    if (!localData)
      localData = this.params_;

    // TODO: Make it possible to set the sender via query parameter.
    await this.setFrom_(localData.sender);

    if (localData.to)
      this.to_.value = localData.to;
    if (localData.inlineTo)
      this.getInlineTo_().value = localData.inlineTo;
    if (localData.subject)
      this.subject_.value = localData.subject;
    if (localData.body)
      this.body_.value = localData.body;

    if (!this.autoSend_) {
      this.handleUpdates_(true);
      this.focusFirstEmpty_();
    }

    await login();

    if (this.autoSend_) {
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

  async handleUpdates_(
      skipFlushToDisk?: boolean, skipHideSentToolbar?: boolean) {
    if (!skipHideSentToolbar)
      this.showSent_(false, true);

    let emails = this.body_.getEmails();
    if (emails.length) {
      this.getInlineTo_().value =
          emails.map(x => serializeAddress(x)).join(',');
    } else {
      this.clearInlineTo_();
    }

    if (this.from_.selectedOptions.length) {
      let sendAsEmail = this.from_.selectedOptions[0].value;
      let sender = defined(defined(this.sendAs_).senders)
                       .find(x => x.sendAsEmail == sendAsEmail);
      this.model_.setSender(sender);
    }

    this.model_.setTo(this.to_.value);
    this.model_.setInlineTo(this.inlineToText_());
    this.model_.setSubject(this.subject_.value);
    this.model_.setBody(this.body_.rawValue, this.body_.plainText);
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
    if (!this.sent_) {
      this.sent_ = document.createElement('div');
      this.sent_.style.cssText = `
        border-bottom: 1px dotted var(--border-and-hover-color);
        padding: 3px;
      `;

      let container = document.createElement('div');
      container.style.cssText = `
        background-color: var(--nested-background-color);
        margin: 10px 4px;
        text-align: center;
        border-radius: 3px;
        border: 1px solid var(--border-and-hover-color);
      `;
      container.append(this.sent_);
      this.append(container);
    }

    this.showSent_(true);

    let sent;
    try {
      this.sent_.textContent = `Sending "${this.subject_.value}"`
      sent = await this.model_.send(this.body_.value);
    } finally {
      this.sent_.textContent = sent ?
          `Sent "${sent.subject}". Would you like to triage it for later?` :
          `Failed to send "${this.subject_.value}"`;
    }

    if (!sent)
      return;

    this.sentThreadId_ = defined(sent.response.threadId);

    if (!this.sentToolbar_) {
      this.sentToolbar_ = new Actions(this);
      this.sentToolbar_.setActions(SENT_ACTIONS);
      notNull(this.sent_.parentNode).append(this.sentToolbar_);
    }

    this.to_.value = this.params_.to && !this.autoSend_ ? this.params_.to : '';
    this.clearInlineTo_();
    this.subject_.value =
        this.params_.subject && !this.autoSend_ ? this.params_.subject : '';
    this.body_.value =
        this.params_.body && !this.autoSend_ ? this.params_.body : '';

    this.autoSend_ = false;

    // Flush the model so that sending doesn't try to send the same message
    // again.
    this.handleUpdates_(false, true);
  }

  private showSent_(show: boolean, preventCloseWindow?: boolean) {
    if (!this.sent_)
      return;

    notNull(this.sent_.parentElement).style.display = show ? '' : 'none';

    if (!show && this.sentToolbar_) {
      // Intentionally only autoclose the window if the sent toolbar is still
      // visible. window.close only works when there's nothing in the back
      // history unfortunately.
      // Can't do this on mobile due to crbug.com/988330.
      if (!preventCloseWindow && !isMobileUserAgent())
        window.close();

      this.sentToolbar_.remove();
      this.sentToolbar_ = undefined;
      this.sentThreadId_ = undefined;
    }
  }

  visibilityChanged() {
    this.closeIfHidden();
  }

  closeIfHidden() {
    if (document.visibilityState !== 'visible') {
      this.showSent_(false);
      return true;
    }
    return false;
  }

  async takeAction(action: Action) {
    if (action == SEND) {
      await this.send_();
      return;
    }

    if (action == CLOSE) {
      this.showSent_(false);
      return;
    }

    if (action == HELP) {
      new HelpDialog(...(await getHelpText()));
      return;
    }

    const sentActions = SENT_ACTIONS.flat(2);
    if (sentActions.includes(action)) {
      if (!this.sentThreadId_)
        return;

      // Disable the toolbar while updating the thread to give an indication
      // that the update is in progress.
      let toolbar = defined(this.sentToolbar_);
      toolbar.style.opacity = '0.5';
      toolbar.style.pointerEvents = 'none';

      let metadata = await Thread.fetchMetadata(this.sentThreadId_);
      let thread = Thread.create(this.sentThreadId_, metadata);

      try {
        await takeAction(thread, action);
      } finally {
        // Enable the toolbar again whether the update fails or succeeds.
        toolbar.style.opacity = '';
        toolbar.style.pointerEvents = '';
      }

      this.showSent_(false);

      // Do this after hiding the sent toolbar since this is just an
      // opitimization and we shouldn't make the user wait on this to get
      // confirmation that the action has succeeded. Technically this will
      // happen automatically the next time we sync with gmail, but do it
      // proactively to minimize the window this thread has no label.
      // Intentionally don't await processThread so the UI updates without
      // waiting for this.
      (await this.getMailProcessor_()).processThread(thread.id);
      return;
    }

    this.body_.takeAction_(action);
  }
}

window.customElements.define('mt-compose-view', ComposeView);
