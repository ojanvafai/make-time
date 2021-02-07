import { createMktimeButton } from './Base.js';

class Logger extends HTMLElement {
  messageContainer_: HTMLDivElement;

  constructor() {
    super();

    this.style.cssText = `
      position: fixed;
      bottom: 10px;
      right: 10px;
      border: 1px solid var(--border-and-hover-color);
      background-color: var(--overlay-background-color);
      max-width: 50%;
      max-height: 50%;
      display: flex;
      flex-direction: column;
    `;

    this.append('Something went wrong...');

    this.messageContainer_ = document.createElement('div');
    this.messageContainer_.style.cssText = `
      overflow: auto;
    `;
    this.append(this.messageContainer_);

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      justify-content: center;
      flex-shrink: 0;
    `;
    buttonContainer.append(createMktimeButton(() => this.close_(), 'Close'));
    this.append(buttonContainer);
  }

  log(message: string, details?: string) {
    console.error(message);

    if (!this.parentNode) document.body.append(this);
    let container = document.createElement('div');
    container.style.cssText = `
      border-bottom: 1px solid #000000bb;
      padding: 3px;
    `;
    container.append(`${this.messageContainer_.children.length + 1}: ${message}`);

    if (details) {
      let summary = document.createElement('summary');
      summary.append('Details');
      let detailsElement = document.createElement('details');
      detailsElement.append(summary, details);
      container.append(detailsElement);
    }

    this.messageContainer_.append(container);
  }

  close_() {
    this.remove();
    this.messageContainer_.textContent = '';
  }
}
window.customElements.define('mt-error-logger', Logger);

export let ErrorLogger = new Logger();
