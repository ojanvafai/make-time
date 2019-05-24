import {assert, defined, notNull, showDialog} from '../Base.js';
import {Settings} from '../Settings.js';

import {SettingsView} from './SettingsView.js';
import {View} from './View.js';

const DAYS_TO_SHOW_SETTING = {
  key: 'days',
  name: 'Days to show',
  description: `Only show emails from the past N days.`,
  type: 'number',
  min: 1,
  default: null,
};

const SETTINGS = [DAYS_TO_SHOW_SETTING];
const QUERY_PARAMS = ['label', 'days'];

export class ViewFiltersChanged extends Event {
  static NAME = 'view-filters-changed';
  constructor(public label: string, public days: string) {
    super(ViewFiltersChanged.NAME, {bubbles: true});
  }
}

export class FilterDialogView extends View {
  private container_: HTMLElement;
  private label_: HTMLElement;
  private saveButton_: HTMLButtonElement;
  private dialog_?: HTMLDialogElement;

  constructor(
      private settings_: Settings,
      private queryParameters_?: {[property: string]: string}) {
    super();

    this.container_ = document.createElement('table');
    // TODO: Should probably share appendSettings code through inheritance.
    SettingsView.appendSettings(this.container_, this.settings_, SETTINGS);
    this.append(this.container_);

    if (this.queryParameters_) {
      let daysElement =
        this.querySelector(`input[key=${DAYS_TO_SHOW_SETTING.key}]`) as
        HTMLInputElement;
      daysElement.value = this.queryParameters_.days;
    }

    this.label_ = document.createElement('tr');
    this.container_.append(this.label_);
    this.appendLabelSelect_();

    let cancel = document.createElement('button');
    cancel.append('cancel');
    cancel.addEventListener('click', () => this.close_());

    this.saveButton_ = document.createElement('button');
    this.saveButton_.append('save');
    this.saveButton_.addEventListener('click', () => this.save_());
    this.saveButton_.disabled = true;

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      align-items: center;
    `;
    buttonContainer.append(cancel, this.saveButton_);
    this.append(buttonContainer);

    this.addEventListener('change', () => this.handleChange_());
    // change only fires on text inputs after the field is blurred, so also
    // listen to input so we can enable the savechanges button without having to
    // blur the input.
    this.addEventListener('input', () => this.handleChange_());

    this.dialog_ = showDialog(this);
  }

  static containsFilterParameter(params?: {[property: string]: string}) {
    return params && QUERY_PARAMS.some(x => x in params);
  }

  private async appendLabelSelect_() {
    let name = document.createElement('td');
    name.append('View label');

    let select = await this.settings_.getLabelSelect();
    let none = document.createElement('option');
    none.selected = true;
    select.prepend(none);

    if (this.queryParameters_) {
      let selected = this.queryParameters_.label;
      for (let item of select.children) {
        if (item.textContent === selected) {
          (item as HTMLOptionElement).selected = true;
        }
      }
    }

    let value = document.createElement('td');
    value.append(select);
    this.label_.append(name, value);
  }

  private handleChange_() {
    this.saveButton_.disabled = false;
  }

  private async save_() {
    assert(!this.saveButton_.disabled);

    let select = notNull(this.label_.querySelector('select'));
    let option = select.selectedOptions[0];
    let label = option.value;

    let daysElement =
        this.querySelector(`input[key=${DAYS_TO_SHOW_SETTING.key}]`) as
        HTMLInputElement;
    let days = daysElement.value;

    this.dispatchEvent(new ViewFiltersChanged(label, days));
    this.close_();
  }

  private close_() {
    // TODO: prompt if there are changes.
    defined(this.dialog_).close();
  }
}

window.customElements.define('mt-filter-dialog-view', FilterDialogView);
