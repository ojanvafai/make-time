class SettingsView extends HTMLElement {
  constructor(settingsData, queuedLabelData) {
    super();
    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    this.settings_ = settingsData;
    this.queuedLabelData_ = queuedLabelData;

    this.scrollable_ = document.createElement('div');
    this.scrollable_.style.cssText = `
      overflow: auto;
      padding: 4px;
    `;
    this.append(this.scrollable_);

    let title = document.createElement('div');
    title.style.cssText = `
      font-weight: bold;
      margin-bottom: 16px;
    `;
    title.append('Settings');
    this.scrollable_.append(title);

    let filtersLinkContainer = document.createElement('div');
    filtersLinkContainer.style.cssText = `
      margin-bottom: 16px;
    `;
    let filtersLink = document.createElement('a');
    filtersLink.append('Modify email filters');
    filtersLink.onclick = () => this.showFilterDialog_();
    filtersLinkContainer.append(filtersLink);
    this.scrollable_.append(filtersLinkContainer);

    this.addBasicSettings_();
    this.addQueues_();

    let spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${this.settings_.spreadsheetId}/edit`;
    let clearBackendInstructions = document.createElement('div');
    clearBackendInstructions.style.cssText = `margin: 16px 0;`;
    clearBackendInstructions.innerHTML = `To disconnect backend spreadsheet completely, delete or rename <a href=${spreadsheetUrl}>the spreadsheet itself</a>.`;
    this.scrollable_.append(clearBackendInstructions);

    let save = document.createElement('button');
    save.style.cssText = `float: right;`;
    save.append('save');
    save.onclick = () => this.save_();

    let cancel = document.createElement('button');
    cancel.style.cssText = `float: right;`;
    cancel.append('cancel');
    cancel.onclick = () => this.cancel_();

    let buttonContainer = document.createElement('div');
    buttonContainer.append(save, cancel);
    this.append(buttonContainer);

    this.dialog_ = showDialog(this);
  }

  showFilterDialog_() {
    new FiltersView(this.settings_);
  }

  addBasicSettings_() {
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

      if (field.type == 'checkbox')
        input.checked = this.settings_.get(field.key);
      else if (this.settings_.has(field.key))
        input.value = this.settings_.get(field.key);

      input.key = field.key;

      label.append(`${field.name}:`, input);
      this.basicSettings_.append(label);
    }

    this.scrollable_.append(this.basicSettings_);
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

    this.scrollable_.append(this.queues_);
  }

  appendEmptyQueueSelector_() {
    let emptySelector = this.createQueueSelector_('');
    this.queues_.querySelector('a').before(emptySelector);
  }

  createSelect_(list, opt_selectedItem) {
    let select = document.createElement('select');
    for (let item of list) {
      let option = document.createElement('option');
      option.value = item;

      if (opt_selectedItem == item)
        option.selected = true;

      option.append(item);
      select.append(option);
    }
    return select;
  }

  createQueueSelector_(label, opt_selected) {
    let container = document.createElement('div');
    container.classList.add('queue-selector');
    let input = document.createElement('input');
    input.value = label;
    container.append(input);

    let queues = this.createSelect_(SettingsView.queues_, opt_selected.queue);
    queues.className = 'queue';
    container.append(queues);

    let goals = this.createSelect_(SettingsView.goals_, opt_selected.goal);
    goals.className = 'goal';
    container.append(goals);

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
      let value = input.type == 'checkbox' ? input.checked : input.value;
      updates.push({key: input.key, value: value});
    }
    await this.settings_.writeUpdates(updates);

    let newQueueData = [];
    let selectors = this.queues_.querySelectorAll('.queue-selector');
    for (let selector of selectors) {
      let label = selector.querySelector('input').value;
      if (!label)
        continue;
      let queue = selector.querySelector('.queue').selectedOptions[0].value;
      let goal = selector.querySelector('.goal').selectedOptions[0].value;
      newQueueData.push([label, queue, goal]);
    }

    if (newQueueData.length) {
      let originalQueueCount = Object.keys(this.queuedLabelData_).length;
      await SpreadsheetUtils.writeSheet(this.settings_.spreadsheetId, Settings.QUEUED_LABELS_SHEET_NAME, newQueueData, originalQueueCount, 1);
    }

    window.location.reload();
  }

  cancel_() {
    this.dialog_.close();
  }
}

SettingsView.queues_ = ['Daily', 'Monthly', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
SettingsView.goals_ = ['Inbox Zero', 'Best Effort']

window.customElements.define('mt-settings', SettingsView);
