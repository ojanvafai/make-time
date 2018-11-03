import { Actions } from '../Actions.js';
import { Compose } from '../Compose.js';

const SEND = { name: 'Send', description: 'Ummm...send the mail.' };
const ACTIONS = [ SEND ];

export class ComposeView extends HTMLElement {
  constructor(contacts, updateTitle) {
    super();

    this.updateTitle_ = updateTitle;

    let toLine = document.createElement('div');
    toLine.style.cssText = `
      display: flex;
      margin: 4px;
    `;
    this.append(toLine);

    this.to_ = document.createElement('div');
    toLine.append('To:\xa0', this.to_);

    let subjectLine = document.createElement('div');
    subjectLine.style.cssText = `
      display: flex;
      margin: 4px;
    `;
    this.append(subjectLine);

    this.subject_ = document.createElement('input');
    this.subject_.style.cssText = `
      border: 1px solid;
      flex: 1;
      outline: none;
    `;
    subjectLine.append('Subject:\xa0', this.subject_);

    this.compose_ = new Compose(contacts, true);
    this.compose_.style.cssText = `
      flex: 1;
      margin: 4px;
      display: flex;
      background-color: white;
      min-height: 200px;
    `;

    this.compose_.addEventListener('email-added', this.updateToField_.bind(this));
    this.compose_.addEventListener('input', this.debounceUpdateToField_.bind(this));

    this.append(this.compose_);
  }

  debounceUpdateToField_() {
    requestIdleCallback(this.updateToField_.bind(this));
  }

  updateToField_() {
    this.to_.textContent = this.compose_.getEmails().join(', ');
  }

  connectedCallback() {
    this.compose_.focus();

    let footer = document.getElementById('footer');
    footer.textContent = '';

    for (let action of ACTIONS) {
      let button = document.createElement('button');
      button.tooltip = action.description;

      button.onclick = () => this.takeAction_(action);
      button.onmouseenter = () => {
        button.tooltipElement = document.createElement('div');
        button.tooltipElement.style.cssText = `
          position: absolute;
          bottom: ${this.offsetHeight}px;
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

        text.append(button.tooltip);
        button.tooltipElement.append(text);
        footer.append(button.tooltipElement);
      }
      button.onmouseleave = () => {
        button.tooltipElement.remove();
      }
      let name = action.name;
      button.textContent = name;
      footer.append(button);
    }
  }

  async takeAction_(action) {
    if (action != SEND)
      throw `Invalid action: ${JSON.stringify(action)}`;

    if (this.sending_)
      return;
    this.sending_ = true;

    this.updateTitle_('sending', 'Sending...');
    let mail = await import('./Mail.js');
    await mail.send(this.compose_.value, this.to_.textContent, this.subject_.value);
    this.updateTitle_('sending');

    this.compose_.value = '';
    this.to_.textContent = '';
    this.subject_.value = '';

    this.sending_ = false;
  }

  tearDown() {
  }
}

window.customElements.define('mt-compose-view', ComposeView);
