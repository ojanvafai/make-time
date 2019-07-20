import {createMktimeButton, showDialog} from '../Base.js';

export class HelpDialog extends HTMLElement {
  constructor(helpText: HTMLElement|string) {
    super();

    let container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      height: -webkit-fill-available;
    `;
    let dialog = showDialog(container);

    let help = document.createElement('div');
    help.style.cssText = `
      overflow: auto;
      flex: 1;
      white-space: pre-wrap;
    `;

    if (typeof helpText === 'string')
      help.innerHTML = <string>helpText;
    else
      help.append(helpText);

    container.append(help);

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      justify-content: flex-end;
    `;
    buttonContainer.append(createMktimeButton('close', () => dialog.close()));
    container.append(buttonContainer);
  }
}
window.customElements.define('mt-help-dialog', HelpDialog);
