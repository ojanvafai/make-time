class ThreadRow extends HTMLElement {
  constructor(thread) {
    super();
    this.style.display = 'block';

    this.thread_ = thread;

    let label = document.createElement('label');
    label.style.cssText = `
      display: flex;
      line-height: 1;
    `;

    this.checkBox_ = document.createElement('input');
    this.checkBox_.type = 'checkbox';
    this.checkBox_.style.cssText = `
      margin-left: 5px;
      margin-right: 5px;
    `;
    this.checkBox_.onchange = this.updateHighlight_.bind(this);

    this.primaryLabel_ = document.createElement('div');

    this.updateHighlight_();

    this.thread_.getSubject()
    .then(subject => {
      this.thread_.getMessages()
      .then(messages => {
        let lastMessage = messages[messages.length - 1];

        let fromContainer = document.createElement('div');
        fromContainer.style.cssText = `
          width: 150px;
          margin-right: 25px;
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

        if (window.innerWidth < 600) {
          let topRow = document.createElement('div');
          topRow.style.display = 'flex';
          topRow.append(this.checkBox_, fromContainer, this.primaryLabel_, date, popoutButton);
          label.append(topRow, title);

          label.style.flexDirection = 'column';
          fromContainer.style.flex = '1';
          title.style.fontSize = '12px';
          title.style.margin = '5px 5px 0 5px';
        } else {
          label.append(this.checkBox_, fromContainer, this.primaryLabel_, title, date, popoutButton);
        }

        this.append(label);
      });
    });
  }

  async showPrimaryLabel(label) {
    if (!label)
      return;
    this.primaryLabel_.textContent = label;
    this.primaryLabel_.style.cssText = `
      color: white;
      background-color: grey;
      padding: 1px 2px;
      margin-right: 2px;
      border-radius: 3px;
    `;
  }

  updateHighlight_() {
    this.style.backgroundColor = this.checkBox_.checked ? '#c2dbff' : 'white';
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
