class ErrorDialog extends HTMLElement {
  constructor(message) {
    super();
    this.append(message);

    let ok = document.createElement('button');
    ok.append('OK');
    ok.onclick = () => this.dialog_.close();

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      justify-content: flex-end;
    `;
    buttonContainer.append(ok);
    this.append(buttonContainer);

    this.dialog_ = showDialog(this);
  }
}
window.customElements.define('mt-error-dialog', ErrorDialog);
