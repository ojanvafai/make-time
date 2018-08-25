class SettingsView extends HTMLElement {
  constructor(settingsData, queuedLabelData) {
    super();

    this.settings_ = settingsData;
    this.queuedLabelData_ = queuedLabelData;

    let spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${this.settings_.spreadsheetId}/edit`;

    let title = document.createElement('div');
    title.style.cssText = `
      font-weight: bold;
      margin-bottom: 16px;
    `;
    title.append('Settings');
    this.append(title);

    let filtersLinkContainer = document.createElement('div');
    filtersLinkContainer.style.cssText = `
      margin-bottom: 16px;
    `;
    let filtersLink = document.createElement('a');
    filtersLink.append('Modify email filters');
    filtersLink.href = spreadsheetUrl;
    filtersLinkContainer.append(filtersLink);
    this.append(filtersLinkContainer);

    this.addBasicSettings_(spreadsheetUrl);
    this.addQueues_();

    let clearBackendInstructions = document.createElement('div');
    clearBackendInstructions.style.cssText = `margin: 16px 0;`;
    clearBackendInstructions.innerHTML = `To disconnect backend spreadsheet completely, delete or rename <a href=${spreadsheetUrl}>the spreadsheet itself</a>.`;
    this.append(clearBackendInstructions);

    let save = document.createElement('button');
    save.style.cssText = `float: right;`;
    save.append('save');
    save.onclick = () => this.save_();
    this.append(save);

    let cancel = document.createElement('button');
    cancel.style.cssText = `float: right;`;
    cancel.append('cancel');
    cancel.onclick = () => this.cancel_();
    this.append(cancel);

    this.dialog_ = showDialog(this);
  }

  addBasicSettings_(spreadsheetUrl) {
    this.basicSettings_ = document.createElement('div');
    for (let field of Settings.fields) {
      let label = document.createElement('label');
      label.style.cssText = `
        display: flex;
        margin: 5px 0;
      `;

      let input = document.createElement('input');
      input.style.cssText = `
        flex: 1;
        margin-left: 5px;
      `;

      if (field.default)
        input.placeholder = `default: ${field.default}`;
      if (field.type)
        input.type = field.type;
      if (this.settings_.has(field.key))
        input.value = this.settings_.get(field.key);
      input.key = field.key;

      label.append(`${field.name}:`, input);
      this.basicSettings_.append(label);
    }

    this.append(this.basicSettings_);
  }

  addQueues_() {
    this.queues_ = document.createElement('div');
    this.queues_.style.cssText = `margin: 16px 0;`;
    this.queues_.append('Queues');

    for (let label of Object.keys(this.queuedLabelData_).sort()) {
      let selector = this.createQueueSelector_(label, this.queuedLabelData_[label]);
      this.queues_.append(selector);
    }

    let addRow = document.createElement('a');
    addRow.append('Add row');
    addRow.style.cssText = `font-size: 11px;`;
    addRow.onclick = () => this.appendEmptyQueueSelector_();
    this.queues_.append(addRow);

    this.append(this.queues_);
  }

  appendEmptyQueueSelector_() {
    let emptySelector = this.createQueueSelector_('');
    this.queues_.querySelector('a').before(emptySelector);
  }

  createQueueSelector_(label, opt_selectedQueue) {
    let container = document.createElement('div');
    container.classList.add('queue-selector');
    let input = document.createElement('input');
    input.value = label;
    container.append(input);

    let select = document.createElement('select');
    for (let queue of SettingsView.queues_) {
      let option = document.createElement('option');
      option.value = queue;

      if (opt_selectedQueue == queue)
        option.selected = true;

      option.append(queue);
      select.append(option);
    }
    container.append(select);

    let closeButton = document.createElement('span');
    closeButton.classList.add('close-button');
    closeButton.style.cssText = `padding: 5px;`;
    closeButton.onclick = () => { container.remove(); };
    container.append(closeButton);

    return container;
  }

  async save_() {
    let updates = [];
    let inputs = this.basicSettings_.querySelectorAll('input');
    for (let input of inputs) {
      updates.push({key: input.key, value: input.value});
    }
    await this.settings_.writeUpdates(updates);

    let newQueueData = [];
    let selectors = this.queues_.querySelectorAll('.queue-selector');
    for (let selector of selectors) {
      let label = selector.querySelector('input').value;
      if (!label)
        continue;
      let queue = selector.querySelector('select').selectedOptions[0].value;
      newQueueData.push([label, queue]);
    }

    if (newQueueData.length) {
      let originalQueueCount = Object.keys(this.queuedLabelData_).length;
      await SpreadsheetUtils.write2ColumnSheet(this.settings_.spreadsheetId, Settings.QUEUED_LABELS_SHEET_NAME, newQueueData, originalQueueCount, 1);
    }

    window.location.reload();
  }

  cancel_() {
    this.dialog_.close();
  }
}

SettingsView.queues_ = ['Daily', 'Monthly', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

window.customElements.define('mt-settings', SettingsView);
