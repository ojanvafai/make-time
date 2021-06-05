import { createMktimeButton } from '../Base.js';
import { Dialog } from '../Dialog.js';

export class HelpDialog extends HTMLElement {
  constructor(...helpText: (HTMLElement | string)[]) {
    super();

    let container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      height: -webkit-fill-available;
    `;
    let help = document.createElement('div');
    help.style.cssText = `
      overflow: auto;
      flex: 1;
      white-space: pre-wrap;
    `;
    help.append(...helpText);
    container.append(help);

    const closeButton = createMktimeButton(() => dialog.remove(), 'close');
    const dialog = new Dialog({contents: container, buttons: [closeButton]});
  }
}
window.customElements.define('mt-help-dialog', HelpDialog);
