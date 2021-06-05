import { assert, createMktimeButton, notNull } from '../Base.js';
import { Dialog } from '../Dialog.js';
import { NO_OFFICES } from '../models/TodoModel.js';
import { ServerStorage } from '../ServerStorage.js';
import { Settings } from '../Settings.js';

import { SettingsView } from './SettingsView.js';
import { View } from './View.js';
import { LabelSelect } from '../LabelSelect.js';

const DAYS_TO_SHOW_SETTING = {
  key: 'days',
  name: 'Days to show',
  description: `Only show emails from the past N days.`,
  type: 'number',
  min: 1,
  default: null,
};

const QUERY_PARAMS = ['label', 'days', 'offices'];

export class ViewFiltersChanged extends Event {
  static NAME = 'view-filters-changed';
  constructor(public label: string, public days: string, public offices: string) {
    super(ViewFiltersChanged.NAME, { bubbles: true });
  }
}

export class FilterDialogView extends View {
  private container_: HTMLElement;
  private label_: HTMLElement;
  private saveButton_: HTMLButtonElement;
  private dialog_: Dialog;

  constructor(
    private settings_: Settings,
    positionRect: { top?: string; right?: string; bottom?: string; left?: string },
    private queryParameters_?: { [property: string]: string },
  ) {
    super();

    this.container_ = document.createElement('table');
    this.append(this.container_);

    this.appendDaysToShow_();

    this.label_ = document.createElement('tr');
    this.container_.append(this.label_);
    this.appendLabelSelect_();
    this.appendOffices_();

    this.addEventListener('change', () => this.handleChange_());
    // change only fires on text inputs after the field is blurred, so also
    // listen to input so we can enable the savechanges button without having to
    // blur the input.
    this.addEventListener('input', () => this.handleChange_());

    let cancel = createMktimeButton(() => this.close_(), 'cancel');
    this.saveButton_ = createMktimeButton(() => this.save_(), 'save');
    this.saveButton_.disabled = true;

    this.dialog_ = new Dialog({
      contents: this,
      buttons: [cancel, this.saveButton_],
      positionRect,
    });
  }

  static containsFilterParameter(params?: { [property: string]: string }) {
    return params && QUERY_PARAMS.some((x) => x in params);
  }

  private createNameCell_(contents: string | HTMLElement) {
    let cell = document.createElement('td');
    cell.style.cssText = `
      padding-right: 4px;
      text-align: right;
      max-width: 125px;
    `;
    cell.append(contents);
    return cell;
  }

  private createValueCell_(...contents: (string | HTMLElement)[]) {
    let cell = document.createElement('td');
    cell.style.cssText = `
      display: flex;
      align-items: center;
      padding: 10px 0px;
    `;
    cell.append(...contents);
    return cell;
  }

  private appendDaysToShow_() {
    let row = document.createElement('tr');
    this.container_.append(row);

    // TODO: Should probably share appendSettings code through inheritance.
    let input = SettingsView.createInput(this.settings_, DAYS_TO_SHOW_SETTING);

    row.append(
      this.createNameCell_('Only show rows from the last'),
      this.createValueCell_(input, 'days'),
    );

    if (this.queryParameters_) {
      let daysElement = this.querySelector(
        `input[key=${DAYS_TO_SHOW_SETTING.key}]`,
      ) as HTMLInputElement;
      daysElement.value = this.queryParameters_.days;
    }
  }

  private appendOffices_() {
    let offices = this.settings_.get(ServerStorage.KEYS.LOCAL_OFFICES);
    if (!offices) return;

    let officesRow = document.createElement('tr');
    officesRow.toggleAttribute('offices');
    this.container_.append(officesRow);

    let officesCell = this.createValueCell_();
    officesCell.style.flexDirection = 'column';
    officesCell.style.alignItems = 'flex-start';
    officesRow.append(
      this.createNameCell_('Only show meetings lacking rooms in these offices'),
      officesCell,
    );

    let parts = (offices as string).split(',').map((x) => x.trim());
    for (let part of parts) {
      let checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked =
        !this.queryParameters_ ||
        !this.queryParameters_.offices ||
        this.queryParameters_.offices.split(',').some((x) => x.trim() === part);

      let office = document.createElement('div');
      office.style.cssText = `
        display: flex;
        align-items: center;
      `;
      office.append(checkbox, part);
      officesCell.append(office);
    }
  }

  private async appendLabelSelect_() {
    let select = new LabelSelect();
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

    this.label_.append(
      this.createNameCell_('Only show rows labeled'),
      this.createValueCell_(select),
    );
  }

  private handleChange_() {
    this.saveButton_.disabled = false;
  }

  private async save_() {
    assert(!this.saveButton_.disabled);

    let select = notNull(this.label_.querySelector('select'));
    let option = select.selectedOptions[0];
    let label = option.value;

    let daysElement = this.querySelector(
      `input[key=${DAYS_TO_SHOW_SETTING.key}]`,
    ) as HTMLInputElement;
    let days = daysElement.value;

    let officesElements = Array.from(
      this.querySelectorAll(`[offices] input`) as NodeListOf<HTMLInputElement>,
    );

    let offices = '';
    let checkedOffices = officesElements.filter((x) => x.checked);
    if (officesElements.length !== checkedOffices.length) {
      offices = checkedOffices.length
        ? checkedOffices.map((x) => notNull(x.nextSibling).textContent).join(',')
        : NO_OFFICES;
    }

    this.dispatchEvent(new ViewFiltersChanged(label, days, offices));
    this.close_();
  }

  private close_() {
    // TODO: prompt if there are changes.
    this.dialog_.remove();
  }
}

window.customElements.define('mt-filter-dialog-view', FilterDialogView);
