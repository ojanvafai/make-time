import { RenderedThread } from '../RenderedThread.js';
import { ViewInGmailButton } from '../ViewInGmailButton.js';

export class ThreadRow extends HTMLElement {
  constructor(thread, group) {
    super();
    this.style.display = 'flex';

    this.group = group;
    this.focused = false;

    let label = document.createElement('label');
    label.style.cssText = `
      width: 32px;
      border-right: 0;
      display: flex;
      justify-content: center;
      align-items: center;
    `;

    this.checkBox_ = document.createElement('input');
    this.checkBox_.type = 'checkbox';
    this.checkBox_.style.cssText = `
      margin-left: 5px;
      margin-right: 5px;
    `;
    this.checkBox_.onchange = this.updateHighlight_.bind(this);

    label.append(this.checkBox_);
    this.append(label);

    this.messageDetails_ = document.createElement('div');
    this.messageDetails_.style.cssText = `
      display: flex;
      overflow: hidden;
      flex: 1;
    `;
    this.messageDetails_.onclick = () => {
      this.dispatchEvent(new Event('renderThread', {bubbles: true}));
    };
    this.append(this.messageDetails_);

    this.updateHighlight_();
    this.setThread(thread);
  }

  setThread(thread) {
    if (this.thread_ && this.thread_.historyId == thread.historyId)
      return;

    this.thread_ = thread;
    this.rendered = new RenderedThread(thread);

    this.thread_.getSubject()
    .then(subject => {
      this.thread_.getMessages()
      .then(messages => {
        let lastMessage = messages[messages.length - 1];

        let fromContainer = document.createElement('div');
        fromContainer.style.cssText = `
          width: 150px;
          margin-right: 25px;
          padding-left: 5px;
          display: flex;
          align-items: baseline;
        `;

        let from = document.createElement('div');
        from.style.cssText = `
          overflow: hidden;
        `;
        from.textContent = lastMessage.fromName;

        let count = document.createElement('div');
        count.style.cssText = `
          font-size: 80%;
          margin-left: 4px;
          color: grey;
        `;
        if (messages.length > 1)
          count.textContent = messages.length;

        fromContainer.append(from, count);

        let snippet = document.createElement('span');
        snippet.style.color = '#666';
        // Snippet as returned by the gmail API is html escaped.
        snippet.innerHTML = ` - ${this.thread_.snippet}`;

        let title = document.createElement('div');
        title.append(subject, snippet);
        title.style.cssText = `
          overflow: hidden;
          margin-right: 25px;
          flex: 1;
        `;

        let date = document.createElement('div');
        date.textContent = this.dateString_(lastMessage.date);

        let popoutButton = new ViewInGmailButton();
        popoutButton.setMessageId(messages[messages.length - 1].id);
        popoutButton.style.marginLeft = '4px';
        popoutButton.style.marginRight = '4px';

        this.messageDetails_.textContent = '';
        if (window.innerWidth < 600) {
          let topRow = document.createElement('div');
          topRow.style.display = 'flex';
          topRow.append(fromContainer, date, popoutButton);
          this.messageDetails_.append(topRow, title);

          this.messageDetails_.style.flexDirection = 'column';
          fromContainer.style.flex = '1';
          title.style.fontSize = '12px';
          title.style.margin = '5px 5px 0 5px';
        } else {
          this.messageDetails_.append(fromContainer, title, date, popoutButton);
        }
      });
    });
  }

  updateHighlight_() {
    if (this.checkBox_.checked)
      this.style.backgroundColor = '#c2dbff';
    else if (this.focused)
      this.style.backgroundColor = "#ccc";
    else
      this.style.backgroundColor = 'white';
  }

  dateString_(date) {
    let options = {};
    let today = new Date();
    if (today.getYear() != date.getYear())
      options.year = 'numeric';

    if (today.getMonth() != date.getMonth() || today.getDate() != date.getDate()) {
      options.month = 'short';
      options.day = 'numeric';
    } else {
      options.hour = 'numeric';
      options.minute = 'numeric';
    }

    return date.toLocaleString(undefined, options);
  }

  get checked() {
    // If we're mid construction of the row, then the checkbox may not exist yet.
    return this.checkBox_ && this.checkBox_.checked;
  }

  set checked(value) {
    this.checkBox_.checked = value;
    this.updateHighlight_();
  }

  get thread() {
    return this.thread_;
  }
}

window.customElements.define('mt-thread-row', ThreadRow);
