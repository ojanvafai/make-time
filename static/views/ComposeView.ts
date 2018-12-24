import { EmailCompose } from '../EmailCompose.js';
import { ComposeModel } from '../models/ComposeModel.js';
import { showDialog } from '../Base.js';
import { View } from './View.js';

const SEND = { name: 'Send', description: 'Send the mail.' };
const HELP = { name: 'Help', description: 'Help tips.' };
const ACTIONS = [ SEND, HELP ];
const PRE_FILL_URL = '/compose?to=email@address.com&subject=This is my subject&body=This is the email itself';
const HELP_TEXT = `Put ## followed by a priority level in your email to automatically route your message to a that make-time priority. Valid priorities are ##must-do, ##urgent, ##backlog, ##delegate.

URL to prefill fields: <a href='${PRE_FILL_URL}'>${PRE_FILL_URL}</a>.
`;

export class ComposeView extends View {
  private params_: any;
  private to_: HTMLInputElement;
  private subject_: HTMLInputElement;
  private body_: EmailCompose;
  private inlineTo_: HTMLElement| undefined;

  constructor(private model_: ComposeModel, contacts: any, params: any) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
      height: 100%;
    `;

    this.params_ = params || {};

    this.to_ = this.createInput_();
    this.appendLine_('To:\xa0', this.to_);

    this.subject_ = this.createInput_();
    this.appendLine_('Subject:\xa0', this.subject_);

    this.body_ = new EmailCompose(contacts, true);
    this.body_.style.cssText = `
      flex: 1 1 0;
      margin: 4px;
      display: flex;
      background-color: white;
      min-height: 50px;
    `;

    this.body_.addEventListener('email-added', this.handleUpdates_.bind(this));
    this.body_.addEventListener('input', this.debounceHandleUpdates_.bind(this));
    this.append(this.body_);

    this.appendButtons_();
  }

  getModel() {
    return this.model_;
  }

  async renderFromDisk() {
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

    this.focusFirstEmpty_();
  }

  createInput_() {
    let input = document.createElement('input');
    input.addEventListener('input', this.debounceHandleUpdates_.bind(this));
    input.style.cssText = `
      border: 1px solid;
      flex: 1;
      outline: none;
      padding: 4px;
    `;
    return input;
  }

  appendLine_(...children: (string | Node)[]) {
    let line = this.createLine_(...children);
    this.append(line);
  }

  createLine_(...children: (string | Node)[]) {
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
      let parent = <HTMLElement> this.to_.parentNode;
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

  appendButtons_() {
    let container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      justify-content: center;
      position: relative;
    `;
    this.append(container);

    for (let action of ACTIONS) {
      let button = document.createElement('button');
      button.setAttribute('tooltip', action.description);

      button.onclick = () => this.takeAction_(action);

      let tooltipElement: HTMLElement;
      button.onmouseenter = () => {
        tooltipElement = document.createElement('div');
        tooltipElement.style.cssText = `
          position: absolute;
          top: ${container.offsetHeight}px;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
        `;

        let text = document.createElement('div');
        text.style.cssText = `
          background-color: white;
          border: 1px solid;
          padding: 4px;
          width: 300px;
        `;

        text.append(<string>button.getAttribute('tooltip'));
        tooltipElement.append(text);
        container.append(tooltipElement);
      }
      button.onmouseleave = () => {
        tooltipElement.remove();
      }
      let name = action.name;
      button.textContent = name;
      container.append(button);
    }
  }

  showHelp_() {
    let contents = document.createElement('div');
    contents.style.overflow = 'auto';
    contents.innerHTML = HELP_TEXT;
    let dialog = showDialog(contents);
    dialog.style.whiteSpace = 'pre-wrap';

    let closeButton = document.createElement('div');
    closeButton.classList.add('close-button');
    closeButton.style.cssText = `
      float: right;
      position: sticky;
      top: 0;
      background-color: white;
      padding-left: 10px;
    `;
    closeButton.onclick = () => dialog.close();
    contents.prepend(closeButton);
  }

  async send_() {
    await this.model_.send();

    this.to_.value = this.params_.to || '';
    this.clearInlineTo_();
    this.subject_.value = this.params_.subject || '';
    this.body_.value = this.params_.body || '';
  }

  async takeAction_(action: any) {
    if (action == SEND) {
      await this.send_();
      return;
    }

    if (action == HELP) {
      this.showHelp_();
      return;
    }

    throw `Invalid action: ${JSON.stringify(action)}`;
  }

  tearDown() {
  }

  async goBack() {
  }

  async update() {
  }

  async dispatchShortcut(_e: KeyboardEvent) {
  }

  pushBestEffort() {
  }
}

window.customElements.define('mt-compose-view', ComposeView);
