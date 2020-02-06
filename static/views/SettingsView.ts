import {assert, create, createMktimeButton, notNull} from '../Base.js';
import {ServerStorage, StorageUpdates} from '../ServerStorage.js';
import {Setting, Settings} from '../Settings.js';

import {AppShell} from './AppShell.js';
import {CalendarFiltersView} from './CalendarFiltersView.js';
import {CalendarSortView} from './CalendarSortView.js';
import {FiltersView} from './FiltersView.js';
import {HelpDialog} from './HelpDialog.js';
import {QueuesView} from './QueuesView.js';
import {View} from './View.js';

let HELP_TEXT = [
  create('b', 'Reordering labels:'),
  create('p', 'Use ctrl+up/down or cmd+up/down to reorder the focused label. Hold shift to move 10 rows at a time.'),
  create('p', `Pro-tip: I have emails to me from VIPs show up immediately. All other emails are queued to either be daily (to me or one of my primary project's lists), weekly (to lists I need to pay attention to and sometimes reply to) or monthly (to lists I need to keep abrest of but basically never need to reply to). And if it's not something I need to pay attention to, but occasionally need to search for, then it's just archived immediately.`)
];

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
    `;
    this.append(this.scrollable_);

    this.basicSettings_ = document.createElement('table');
    this.basicSettings_.style.cssText = `
      margin: 8px;
      padding: 8px;
      background-color: var(--nested-background-color);
      border-radius: 5px;
    `;
    SettingsView.appendSettings(
        this.basicSettings_, this.settings_, Settings.fields);
    this.scrollable_.append(this.basicSettings_);

    let sortContainer = document.createElement('div');
    sortContainer.style.cssText = `
      display: flex;
      flex-wrap: wrap;
    `;
    this.scrollable_.append(sortContainer);

    this.queues_ = new QueuesView(this.settings_);
    this.queues_.addEventListener('change', () => this.handleChange_());

    let queuesLegend = document.createElement('legend');
    queuesLegend.append('Email label sort order');

    let queuesContainer = document.createElement('div');
    queuesContainer.append(queuesLegend, this.queues_);
    sortContainer.append(queuesContainer);

    this.calendarSortView_ = new CalendarSortView(this.settings_);
    this.calendarSortView_.addEventListener(
        'change', () => this.handleChange_());

        let calendarLegend = document.createElement('legend');
        calendarLegend.append('Calendar label sort order');

    let calendarSortContainer = document.createElement('div');
    calendarSortContainer.append(calendarLegend, this.calendarSortView_);
    sortContainer.append(calendarSortContainer);

    queuesContainer.style.cssText = calendarSortContainer.style.cssText = `
      margin: 8px;
      padding: 8px;
      background-color: var(--nested-background-color);
      border-radius: 5px;
      flex: 1;
      white-space: nowrap;
    `;

    let helpButton =
        createMktimeButton(() => new HelpDialog(...HELP_TEXT), 'Help');

    this.saveButton_ = createMktimeButton(() => this.save_(), 'Save Changes');
    this.saveButton_.disabled = true;

    let mailFilters = createMktimeButton(
        () => new FiltersView(this.settings_), 'Modify email filters');
    let calendarFilters = createMktimeButton(
        () => new CalendarFiltersView(this.settings_),
        'Modify calendar filters');

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
    `;
    buttonContainer.append(
        this.saveButton_, mailFilters, calendarFilters, helpButton);
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

  static createInput(settings: Settings, field: Setting) {
    let input;
    if (field.values) {
      input = document.createElement('select');
      let currentValue = field.default;
      if (settings.has(field.key))
        currentValue = settings.getNonDefault(field.key);

      for (let value of field.values) {
        let option = document.createElement('option');
        option.append(value);
        if (currentValue === value)
          option.selected = true;
        input.append(option);
      }
    } else {
      input = document.createElement('input');

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

      input.style.maxWidth = '100px';
    }

    input.style.marginRight = '10px';
    input.style.flex = '0 0 auto';

    input.setAttribute('key', field.key);
    return input;
  }

  static appendSettings(
      container: HTMLElement, settings: Settings, fields: Setting[]) {
    for (let field of fields) {
      let label = document.createElement('td');
      label.style.cssText = `
        font-weight: bold;
        padding-right: 12px;
      `;
      label.append(field.name);

      let description = document.createElement('span');
      description.style.color = 'var(--dim-text-color)';
      description.append(field.description);

      let rightCell = document.createElement('td');
      rightCell.style.cssText = `
        display: flex;
        align-items: center;
        padding: 10px 0;
      `;
      rightCell.append(this.createInput(settings, field), description);

      let row = document.createElement('tr');
      row.append(label, rightCell);
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

    let [themeSelect, priorityInboxSelect] =
        this.querySelectorAll('select') as NodeListOf<HTMLSelectElement>;
    updates[ServerStorage.KEYS.THEME] = themeSelect.selectedOptions[0].value;
    updates[ServerStorage.KEYS.PRIORITY_INBOX] =
        priorityInboxSelect.selectedOptions[0].value;

    updates[ServerStorage.KEYS.QUEUES] = this.queues_.getAllQueueDatas();
    updates[ServerStorage.KEYS.CALENDAR_SORT] =
        this.calendarSortView_.getAllCalendarSortDatas();

    await this.settings_.writeUpdates(updates);
    this.saveButton_.disabled = true;
  }
}

window.customElements.define('mt-settings', SettingsView);
