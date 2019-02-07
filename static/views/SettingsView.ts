import {assert, notNull} from '../Base.js';
import {ServerStorage, StorageUpdates} from '../ServerStorage.js';
import {Settings} from '../Settings.js';

import {FiltersView} from './FiltersView.js';
import {HelpDialog} from './HelpDialog.js';
import {QueuesView} from './QueuesView.js';
import {View} from './View.js';

let HELP_TEXT = `<b>Reordering queues:</b>
Use ctrl+up/down or cmd+up/down to reorder the focused queue. Hold shift to move 10 rows at a time.

Pro-tip: I have emails to me from VIPs show up immediately. All other emails are queued to either be daily (to me or one of my primary project's lists), weekly (to lists I need to pay attention to and sometimes reply to) or monthly (to lists I need to keep abrest of but basically never need to reply to). And if it's not something I need to pay attention to, but occasionally need to search for, then its just archived immediately.

Queues can be marked as "Inbox Zero" or "Best Effort". Best Effort queues are only shown after the Inbox Zero threads have all be processed. Best Effort threads are autotriaged to a "bankrupt/queuename" label when they are too old (1 week for daily queues, 2 weeks for weekly, or 6 weeks for monthly). This distinction is especially useful for times when you have to play email catchup (returning from vacation, post perf, etc.). It allows you to focus on at least triaging the potentially important Inbox Zero emails while still getting your non-email work done. Since the queue structure is maintained, you can always go back and get caught up on the bankrupt threads.`;

export class SettingsView extends View {
  private scrollable_: HTMLElement;
  private basicSettings_: HTMLElement;
  private queues_: QueuesView;
  private saveButton_: HTMLButtonElement;

  constructor(private settings_: Settings) {
    super();

    this.style.cssText = `
      background: white;
      display: block;
    `;

    this.scrollable_ = document.createElement('div');
    this.scrollable_.style.cssText = `
      overflow: auto;
      padding: 4px;
    `;
    this.append(this.scrollable_);

    let filtersLinkContainer = document.createElement('div');
    filtersLinkContainer.style.cssText = `
      margin-bottom: 16px;
    `;
    let filtersLink = document.createElement('a');
    filtersLink.append('Modify email filters');
    filtersLink.onclick = () => this.showFilterDialog_();
    filtersLinkContainer.append(filtersLink);
    this.scrollable_.append(filtersLinkContainer);

    this.basicSettings_ = document.createElement('table');
    this.populateSettings_(this.basicSettings_);
    this.scrollable_.append(this.basicSettings_);

    this.queues_ = new QueuesView(this.settings_);
    this.queues_.addEventListener('change', () => this.handleChange_());

    let queuesContainer = document.createElement('fieldset');
    queuesContainer.innerHTML = '<legend>Queue sort order</legend>';
    queuesContainer.append(this.queues_);
    this.scrollable_.append(queuesContainer);

    let helpButton = document.createElement('button');
    helpButton.append('Help');
    helpButton.onclick = () => {
      new HelpDialog(HELP_TEXT);
    };

    this.saveButton_ = document.createElement('button');
    this.saveButton_.append('Save Changes');
    this.saveButton_.disabled = true;
    this.saveButton_.onclick = () => this.save_();

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      justify-content: center;
    `;
    buttonContainer.append(this.saveButton_, helpButton);
    this.append(buttonContainer);

    this.addEventListener('change', () => this.handleChange_(), true);
    // change only fires on text inputs after the field is blurred, so also
    // listen to input so we can enable the savechanges button without having to
    // blur the input.
    this.addEventListener('input', () => this.handleChange_(), true);
  }

  handleChange_() {
    this.saveButton_.disabled = false;
  }

  showFilterDialog_() {
    new FiltersView(this.settings_);
  }

  populateSettings_(container: HTMLElement) {
    for (let field of Settings.fields) {
      let row = document.createElement('tr');
      row.style.cssText = `
        margin: 5px 0;
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

        let rect = helpButton.getBoundingClientRect();

        tooltipElement.style.cssText = `
          position: fixed;
          top: ${rect.bottom + 2}px;
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
        input.value = this.settings_.getNonDefault(field.key);

      input.setAttribute('key', field.key);

      let label = document.createElement('td');
      label.append(field.name, helpButton);

      let inputContainer = document.createElement('td');
      inputContainer.append(input);
      row.append(label, inputContainer);

      container.append(row);
    }
  }

  async save_() {
    assert(!this.saveButton_.disabled);

    let updates: StorageUpdates = {};
    let inputs = this.basicSettings_.querySelectorAll('input');
    for (let input of inputs) {
      let key = notNull(input.getAttribute('key'));
      let value;
      switch (input.type) {
        case 'checkbox':
          value = input.checked;
          break;
        case 'number':
          value = input.value === '' ? null : input.value;
          break;
        default:
          value = input.value;
      }
      updates[key] = value;
    }

    updates[ServerStorage.KEYS.QUEUES] = this.queues_.getAllQueueDatas();

    await this.settings_.writeUpdates(updates);
    this.saveButton_.disabled = true;
  }
}

window.customElements.define('mt-settings', SettingsView);
