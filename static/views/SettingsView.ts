import {assert, notNull} from '../Base.js';
import {ServerStorage, StorageUpdates} from '../ServerStorage.js';
import {Setting, Settings} from '../Settings.js';

import {AppShell} from './AppShell.js';
import {CalendarFiltersView} from './CalendarFiltersView.js';
import {CalendarSortView} from './CalendarSortView.js';
import {FiltersView} from './FiltersView.js';
import {HelpDialog} from './HelpDialog.js';
import {QueuesView} from './QueuesView.js';
import {View} from './View.js';

let HELP_TEXT = `<b>Reordering labels:</b>
Use ctrl+up/down or cmd+up/down to reorder the focused label. Hold shift to move 10 rows at a time.

Pro-tip: I have emails to me from VIPs show up immediately. All other emails are queued to either be daily (to me or one of my primary project's lists), weekly (to lists I need to pay attention to and sometimes reply to) or monthly (to lists I need to keep abrest of but basically never need to reply to). And if it's not something I need to pay attention to, but occasionally need to search for, then its just archived immediately.
`;

export class SettingsView extends View {
  private scrollable_: HTMLElement;
  private basicSettings_: HTMLElement;
  private queues_: QueuesView;
  private calendarSortView_: CalendarSortView;
  private saveButton_: HTMLButtonElement;

  constructor(private settings_: Settings) {
    super();

    this.style.cssText = `
      display: block;
    `;

    this.scrollable_ = document.createElement('div');
    this.scrollable_.style.cssText = `
      overflow: auto;
      padding: 4px;
    `;
    this.append(this.scrollable_);

    this.basicSettings_ = document.createElement('table');
    SettingsView.appendSettings(
        this.basicSettings_, this.settings_, Settings.fields);
    this.scrollable_.append(this.basicSettings_);

    let filtersLinkContainer = document.createElement('div');
    filtersLinkContainer.style.cssText = `
      margin: 16px 0;
    `;
    let mailFilters = document.createElement('a');
    mailFilters.classList.add('label-button');
    mailFilters.append('Modify email filters');
    mailFilters.onclick = () => new FiltersView(this.settings_);

    let calendarFilters = document.createElement('a');
    calendarFilters.classList.add('label-button');
    calendarFilters.append('Modify calendar filters');
    calendarFilters.onclick = () => new CalendarFiltersView(this.settings_);

    filtersLinkContainer.append(mailFilters, calendarFilters);
    this.scrollable_.append(filtersLinkContainer);

    this.queues_ = new QueuesView(this.settings_);
    this.queues_.addEventListener('change', () => this.handleChange_());

    let queuesContainer = document.createElement('fieldset');
    queuesContainer.style.cssText = `
      margin-bottom: 16px;
    `;
    queuesContainer.innerHTML = '<legend>Email label sort order</legend>';
    queuesContainer.append(this.queues_);
    this.scrollable_.append(queuesContainer);

    this.calendarSortView_ = new CalendarSortView(this.settings_);
    this.calendarSortView_.addEventListener(
        'change', () => this.handleChange_());

    let calendarSortContainer = document.createElement('fieldset');
    calendarSortContainer.style.cssText = `
      margin-bottom: 16px;
    `;
    calendarSortContainer.innerHTML =
        '<legend>Calendar label sort order</legend>';
    calendarSortContainer.append(this.calendarSortView_);
    this.scrollable_.append(calendarSortContainer);

    let helpButton = document.createElement('button');
    helpButton.className = 'mktime-button';
    helpButton.append('Help');
    helpButton.onclick = () => {
      new HelpDialog(HELP_TEXT);
    };

    this.saveButton_ = document.createElement('button');
    this.saveButton_.className = 'mktime-button';
    this.saveButton_.append('Save Changes');
    this.saveButton_.disabled = true;
    this.saveButton_.onclick = () => this.save_();

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      justify-content: center;
    `;
    buttonContainer.append(this.saveButton_, helpButton);
    AppShell.setFooter(buttonContainer);

    this.addEventListener('change', () => this.handleChange_());
    // change only fires on text inputs after the field is blurred, so also
    // listen to input so we can enable the savechanges button without having to
    // blur the input.
    this.addEventListener('input', () => this.handleChange_());
  }

  handleChange_() {
    this.saveButton_.disabled = false;
  }

  static appendSettings(
      container: HTMLElement, settings: Settings, fields: Setting[]) {
    for (let field of fields) {
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
      helpButton.onpointerenter = () => {
        tooltipElement = document.createElement('div');

        let rect = helpButton.getBoundingClientRect();

        tooltipElement.style.cssText = `
          position: fixed;
          top: ${rect.bottom + 2}px;
          width: 300px;
          background-color: var(--overlay-background-color);
          border: 1px solid var(--border-and-hover-color);
          padding: 4px;
          z-index: 100;
        `;

        tooltipElement.append(<string>helpButton.getAttribute('tooltip'));
        helpButton.after(tooltipElement);
      };

      helpButton.onpointerleave = () => {
        tooltipElement.remove();
      };

      let input = document.createElement('input');
      input.toggleAttribute('setting');

      if (field.min !== undefined)
        input.min = String(field.min);
      if (field.max !== undefined)
        input.max = String(field.max);
      if (field.default)
        input.placeholder = `default: ${field.default}`;
      if (field.type)
        input.type = field.type;

      if (field.type == 'checkbox')
        input.checked = settings.get(field.key);
      else if (settings.has(field.key))
        input.value = settings.getNonDefault(field.key);

      input.setAttribute('key', field.key);

      let label = document.createElement('td');
      label.append(field.name, helpButton);

      let inputContainer = document.createElement('td');
      inputContainer.append(input);
      row.append(label, inputContainer);

      container.append(row);
    }
  }

  static setUpdates(updates: StorageUpdates, inputs: HTMLInputElement[]) {
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
  }

  async save_() {
    assert(!this.saveButton_.disabled);

    let updates: StorageUpdates = {};
    let inputs = Array.from(this.basicSettings_.querySelectorAll('input'));
    SettingsView.setUpdates(updates, inputs);

    updates[ServerStorage.KEYS.QUEUES] = this.queues_.getAllQueueDatas();
    updates[ServerStorage.KEYS.CALENDAR_SORT] =
        this.calendarSortView_.getAllCalendarSortDatas();

    await this.settings_.writeUpdates(updates);
    this.saveButton_.disabled = true;
  }
}

window.customElements.define('mt-settings', SettingsView);
