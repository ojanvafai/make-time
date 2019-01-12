import {showDialog} from '../Base.js';
import {Labels} from '../Labels.js';
import {QueueSettings} from '../QueueSettings.js';
import {Settings} from '../Settings.js';

import {FiltersView} from './FiltersView.js';
import {QueuesView} from './QueuesView.js';

export class SettingsView extends HTMLElement {
  private scrollable_: HTMLElement;
  private hadChanges_: boolean;
  private dialog_: HTMLDialogElement;
  private basicSettings_: HTMLElement;

  constructor(
      private settings_: Settings, private queueSettings_: QueueSettings) {
    super();
    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

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

    let queuesLinkContainer = document.createElement('div');
    queuesLinkContainer.style.cssText = `
      margin-bottom: 16px;
    `;
    let queuesLink = document.createElement('a');
    queuesLink.append('Modify queues');
    queuesLink.onclick = () => this.showQueuesDialog_();
    queuesLinkContainer.append(queuesLink);
    this.scrollable_.append(queuesLinkContainer);

    this.basicSettings_ = document.createElement('div');
    this.populateSettings_(this.basicSettings_);

    let spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${
        this.settings_.spreadsheetId}/edit`;
    let clearBackendInstructions = document.createElement('div');
    clearBackendInstructions.style.cssText = `margin: 16px 0;`;
    clearBackendInstructions.innerHTML =
        `To disconnect backend spreadsheet completely, delete or rename <a href=${
            spreadsheetUrl}>the spreadsheet itself</a>.`;
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

    this.hadChanges_ = false;
    this.addEventListener('change', () => this.hadChanges_ = true, true);

    this.dialog_ = showDialog(this);
  }

  showFilterDialog_() {
    if (this.hadChanges_) {
      alert(
          'You have changed some settings in this dialog. Please save or cancel first.');
      return;
    }
    new FiltersView(this.settings_);
    this.cancel_();
  }

  async showQueuesDialog_() {
    if (this.hadChanges_) {
      alert(
          'You have changed some settings in this dialog. Please save or cancel first.');
      return;
    }

    let filters = await this.settings_.getFilters();
    let queues: Set<string> = new Set();
    for (let rule of filters) {
      if (!rule.label)
        throw 'This should never happen.';
      queues.add(rule.label);
    }

    queues.delete(Labels.ARCHIVE_LABEL);
    queues.add(Labels.FALLBACK_LABEL);
    queues.add(Labels.BLOCKED_SUFFIX);

    new QueuesView(queues, this.queueSettings_);
    this.cancel_();
  }

  populateSettings_(container: HTMLElement) {
    for (let field of Settings.fields) {
      let label = document.createElement('label');
      label.style.cssText = `
        display: flex;
        margin: 5px 0;
        position: relative;
      `;

      let helpButton = document.createElement('span');
      helpButton.style.cssText = `
        margin: 0 4px;
        text-decoration: underline;
        color: blue;
      `;
      helpButton.textContent = '?';
      helpButton.setAttribute('tooltip', field.description);

      let tooltipElement: HTMLElement;
      helpButton.onmouseenter = () => {
        tooltipElement = document.createElement('div');

        tooltipElement.style.cssText = `
          position: absolute;
          top: ${helpButton.offsetHeight + 2}px;
          width: 300px;
          background-color: white;
          border: 1px solid;
          padding: 4px;
          z-index: 100;
        `;

        tooltipElement.append(<string>helpButton.getAttribute('tooltip'));
        helpButton.after(tooltipElement);
      };

      helpButton.onmouseleave = () => {
        tooltipElement.remove();
      };

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

      input.setAttribute('key', field.key);

      label.append(field.name, helpButton, input);
      container.append(label);
    }

    this.scrollable_.append(container);
  }

  async save_() {
    // No need to reload the page if nothing's changed.
    if (!this.hadChanges_) {
      this.dialog_.close();
      return;
    }

    let updates: {key: string, value: string|boolean}[] = [];
    let inputs = this.basicSettings_.querySelectorAll('input');
    for (let input of inputs) {
      let key = input.getAttribute('key');
      if (!key)
        throw 'This should never happen.';
      let value = input.type == 'checkbox' ? input.checked : input.value;
      updates.push({key: key, value: value});
    }
    await this.settings_.writeUpdates(updates);

    window.location.reload();
  }

  cancel_() {
    // TODO: prompt if there are changes.
    this.dialog_.close();
  }
}

window.customElements.define('mt-settings', SettingsView);
