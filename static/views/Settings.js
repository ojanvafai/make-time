class SettingsView extends HTMLElement {
  constructor(settingsData) {
    super();

    this.settings_ = settingsData;

    let title = document.createElement('div');
    title.style.cssText = `
      font-weight: bold;
      margin-bottom: 16px;
    `;
    title.append('Settings');
    this.append(title);

    this.addSettings_();

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

  addSettings_() {
    let spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${this.settings_.spreadsheetId}/edit`;

    let filtersLinkContainer = document.createElement('div');
    filtersLinkContainer.style.cssText = `
      margin-bottom: 16px;
    `;
    let filtersLink = document.createElement('a');
    filtersLink.append('Modify email filters');
    filtersLink.href = spreadsheetUrl;
    filtersLinkContainer.append(filtersLink);
    this.append(filtersLinkContainer);

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
      this.append(label);
    }

    let clearBackendInstructions = document.createElement('div');
    clearBackendInstructions.style.cssText = `margin: 16px 0;`;
    clearBackendInstructions.innerHTML = `To disconnect backend spreadsheet completely, delete or rename <a href=${spreadsheetUrl}>the spreadsheet itself</a>.`;
    this.append(clearBackendInstructions);
  }

  async save_() {
    let updates = [];
    let inputs = this.querySelectorAll('input');
    for (let input of inputs) {
      updates.push({key: input.key, value: input.value});
    }
    await this.settings_.writeUpdates(updates);
    window.location.reload();
  }

  cancel_() {
    this.dialog_.close();
  }
}

window.customElements.define('mt-settings', SettingsView);