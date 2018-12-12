class Logger extends HTMLElement {
  messageContainer_: HTMLDivElement;

  constructor() {
    super();

    this.style.cssText = `
      position: fixed;
      bottom: 10px;
      right: 10px;
      border: 1px solid black;
      background-color: white;
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

    let ok = document.createElement('button');
    ok.append('Close');
    ok.onclick = () => this.close_();

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      justify-content: center;
      flex-shrink: 0;
    `;
    buttonContainer.append(ok);
    this.append(buttonContainer);
  }

  log(message: string) {
    console.error(message);

    if (!this.parentNode)
      document.body.append(this);
    let container = document.createElement('div');
    container.style.cssText = `
      border-bottom: 1px solid black;
      padding: 3px;
    `;
    container.append(`${this.messageContainer_.children.length + 1}: ${message}`);
    this.messageContainer_.append(container);
  }

  close_() {
    this.remove();
    this.messageContainer_.textContent = '';
  }
}
window.customElements.define('mt-error-logger', Logger);

export let ErrorLogger = new Logger();
