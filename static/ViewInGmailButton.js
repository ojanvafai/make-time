class ViewInGmailButton extends HTMLElement {
  constructor() {
    super();

    this.append('↗');

    this.style.cssText = `
      display: flex;
      border: 1px solid;
      width: 0.9em;
      height: 0.9em;
      align-items: center;
      justify-content: center;
      padding: 3px;
      margin: 1px;
      font-size: 12px;
    `;

    this.onclick = (e) => {
      if (!this.messageId_)
        throw 'Invalid message id';
      window.open(`https://mail.google.com/mail/#all/${this.messageId_}`);
      e.preventDefault();
    };
  }

  setMessageId(messageId) {
    // In theory, linking to the threadId should work, but it doesn't for some threads.
    // Linking to the messageId seems to work reliably. The message ID listed will be expanded
    // in the gmail UI, so link to the last one since that one is definitionally always expanded.
    this.messageId_ = messageId;

  }
}

window.customElements.define('mt-view-in-gmail-button', ViewInGmailButton);

