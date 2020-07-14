import {createMktimeButton, notNull} from '../Base.js';
import {AllCalendarSortDatas, CALENDAR_ALLOWED_COLORS, CalendarSortListEntry, UNBOOKED_TYPES} from '../calendar/Constants.js';
import {FiltersChangedEvent, Settings} from '../Settings.js';

const ROW_CLASS_NAME = 'row';

export class CalendarSortView extends HTMLElement {
  constructor(private settings_: Settings) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
      outline: 0;
    `;

    this.onkeydown = (e) => this.handleKeyDown_(e);
    this.settings_.addEventListener(
        FiltersChangedEvent.NAME, () => this.render_());

    this.render_();
  }

  handleKeyDown_(e: KeyboardEvent) {
    // TODO: Use metaKey on mac and ctrlKey elsewhere.
    let hasModifier = e.ctrlKey || e.metaKey;
    if (!hasModifier)
      return;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        this.moveRow_(e.key, e.shiftKey);
        break;

      case 'ArrowDown':
        e.preventDefault();
        this.moveRow_(e.key, e.shiftKey);
        break;
    }
  }

  isChecked_(row: HTMLElement) {
    return (<HTMLInputElement>row.querySelector('input')).checked;
  }

  moveRow_(direction: string, move10: boolean) {
    this.dispatchChange_();

    let rows = [].slice.call(this.querySelectorAll(`.${ROW_CLASS_NAME}`));
    let row: HTMLElement|undefined;
    for (let currentRow of rows) {
      if (this.isChecked_(currentRow)) {
        row = currentRow;
        break;
      }
    }
    if (!row)
      return;

    let parent = row.parentNode;
    while (parent && parent != this) {
      parent = parent.parentNode;
    }
    if (!parent)
      return;

    let count = move10 ? 10 : 1;

    if (direction == 'ArrowUp') {
      while (count--) {
        if (row.previousSibling)
          row.previousSibling.before(row);
      }
    } else if (direction == 'ArrowDown') {
      while (count--) {
        if (row.nextSibling)
          row.nextSibling.after(row);
      }
    } else {
      throw `Tried to move row in invalid direction: ${direction}`;
    }

    this.tabIndex = -1;
    this.focus();
  }

  private async render_(useDefaults?: boolean) {
    this.textContent = '';
    let calendarSortListEntries =
        await this.settings_.getCalendarSortData(useDefaults);
    for (let data of calendarSortListEntries) {
      this.appendRow_(data);
    }

    let button =
        createMktimeButton(() => this.resetToDefaults_(), 'Reset to defaults');
    button.style.alignSelf = 'center';
    this.append(button);
  }

  getAllCalendarSortDatas() {
    let newQueueData: AllCalendarSortDatas = {};

    let rows = this.querySelectorAll(`.${ROW_CLASS_NAME}`);
    for (let i = 0; i < rows.length; i++) {
      let row = rows[i];
      let label = row.querySelector('.label')!.textContent;
      let hardcodedColor =
          row.querySelector('.hardcoded-color') as HTMLElement | null;
      let color = hardcodedColor ?
          notNull(hardcodedColor.style.backgroundColor) :
          (<HTMLSelectElement>row.querySelector('.color')!)
              .selectedOptions[0]
              .value;
      newQueueData[label] = {color, index: i + 1};
    }

    return newQueueData;
  }

  private resetToDefaults_() {
    this.render_(true);
    this.dispatchChange_();
  }

  private dispatchChange_() {
    this.dispatchEvent(new Event('change'));
  }

  createSelect_(list: {[property: string]: string}, opt_selectedItem?: string) {
    let select = document.createElement('select');
    select.classList.add('color');
    select.addEventListener('change', (e: Event) => {
      let row =
          notNull((e.target as HTMLElement).closest(`.${ROW_CLASS_NAME}`));
      let color = row.querySelector('.color-viewer') as HTMLElement;
      color.style.backgroundColor = select.selectedOptions[0].value;
      this.dispatchChange_();
    });
    for (let item of Object.entries(list)) {
      let option = this.createOption_(item);
      option.selected = opt_selectedItem == item[1];
      select.append(option);
    }
    return select;
  }

  updateHighlights_() {
    let rows =
        <NodeListOf<HTMLElement>>this.querySelectorAll(`.${ROW_CLASS_NAME}`);
    for (let row of rows) {
      row.style.backgroundColor =
          this.isChecked_(row) ? 'var(--selected-background-color)' : '';
    }
  }

  appendRow_(queueData: CalendarSortListEntry) {
    let row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      margin: 4px 0;
    `;
    row.className = ROW_CLASS_NAME;

    let label = document.createElement('label')
    label.style.cssText = `
      flex: 1;
      display: flex;
      align-items: center;
    `;
    label.className = 'label';

    let checkbox = document.createElement('input');
    checkbox.type = 'radio';
    checkbox.name = 'row';
    checkbox.onchange = () => this.updateHighlights_();

    let color = queueData.data.color;

    let colorElement = document.createElement('div');
    colorElement.className = 'color-viewer';
    colorElement.style.cssText = `
      background-color: ${color};
      width: 18px;
      height: 18px;
      margin: 3px;
      border-radius: 50%;
    `;

    label.append(checkbox, colorElement, queueData.label);
    row.append(label);

    let colors = this.createSelect_(CALENDAR_ALLOWED_COLORS, color);
    row.append(colors);

    if (UNBOOKED_TYPES.includes(queueData.label)) {
      // For hardcoded colors, still create a select element with all the
      // options so that it sizes to the same width as the other rows, but
      // disable it so the user can't modify it and make both the text and
      // background-colors the hardcoded color so it just looks like a colored
      // div.
      colors.className = 'hardcoded-color';
      colors.disabled = true;
      colors.style.cssText = `
        color: ${color};
        background-color: ${color};
      `;
    } else {
      colors.className = 'color';
    }

    this.append(row);
  }

  createOption_(item: [string, string]) {
    let option = document.createElement('option');
    option.value = item[1];
    option.append(item[0]);
    return option;
  }
}

window.customElements.define('mt-calendar-sort-view', CalendarSortView);
