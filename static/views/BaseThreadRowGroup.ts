import {collapseArrow, expandArrow} from '../Base.js';
import {SelectBox, SelectChangedEvent} from '../SelectBox.js';
import {ALL, NONE, SOME} from '../SelectBox.js';
import {ThreadRow} from './ThreadRow.js';

// TODO: Find a better home for this. In theory it should be in ThreadRow.ts,
// but that creates a circular reference loading ThreadRowGroup and
// BaseThreadRowGroup.
export class SelectRowEvent extends Event {
  static NAME = 'select-row';
  constructor(public selected: boolean, public shiftKey: boolean) {
    super(SelectRowEvent.NAME, {bubbles: true});
  }
}

interface Item {
  hasChecked: () => boolean;
  hasUnchecked: () => boolean;
}

export abstract class BaseThreadRowGroup extends HTMLElement {
  protected selectBox_: SelectBox;
  protected groupNameContainer_: HTMLElement;
  protected rowCountDisplay_: Text;
  protected expander_: HTMLElement;
  protected collapsed_: boolean;
  private manuallyCollapsed_: boolean;

  constructor(public name: string, private allowedCount_?: number) {
    super();
    // Use negative margin and width to make is so that the rounded corners are
    // clipped when filling the width of the window.
    this.style.cssText = `
      display: block;
      margin-bottom: 12px;
      margin-top: 12px;
      border-radius: 3px;
      background-color: var(--nested-background-color);
    `;

    this.collapsed_ = true;
    this.manuallyCollapsed_ = false;

    this.selectBox_ = new SelectBox();
    this.selectBox_.addEventListener(SelectChangedEvent.NAME, () => {
      this.selectRows(this.selectBox_.selected() === ALL);
    });

    this.groupNameContainer_ = document.createElement('div');
    this.groupNameContainer_.style.cssText = `
      font-weight: bold;
      font-size: 18px;
      flex: 1;
      padding: 12px 4px 12px 7px;
      display: flex;
      align-items: center;
      border-radius: 3px;
      white-space: nowrap;
      overflow: hidden;
    `;
    this.groupNameContainer_.className = 'hover';
    this.groupNameContainer_.addEventListener('click', () => {
      this.manuallyCollapsed_ = true;
      this.setCollapsed(!this.collapsed_, true);
    });

    this.expander_ = document.createElement('div');
    this.expander_.style.cssText = `
      color: var(--dim-text-color);
      margin-top: 2px;
      font-weight: bold;
      font-size: 12px;
    `;

    this.rowCountDisplay_ = new Text();
    this.groupNameContainer_.append(
        this.expander_, name, this.rowCountDisplay_);

    let header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: stretch;
    `;
    header.append(this.selectBox_, this.groupNameContainer_);
    this.append(header);

    this.addEventListener(SelectRowEvent.NAME, () => this.updateSelectBox_());
  }

  setInViewport(_inViewport: boolean) {}

  protected abstract selectRows(_select: boolean): void;
  protected abstract getItems(): Item[];
  abstract getRows(): ThreadRow[];
  abstract getFirstRow(): ThreadRow|null;
  abstract getSubGroups(): BaseThreadRowGroup[];

  protected updateRowCount_() {
    let count = this.getRows().length;
    let overLimit = this.allowedCount_ && count > this.allowedCount_;
    this.groupNameContainer_.style.color = overLimit ? 'red' : '';

    let text;
    if (overLimit)
      text = ` (${count}/${this.allowedCount_})`;
    else if (this.collapsed_)
      text = ` (${count})`;
    else
      text = '';
    this.rowCountDisplay_.textContent = text;
  }

  private updateSelectBox_() {
    // This needs to look at all the row groups
    let hasChecked = false;
    let hasUnchecked = false;
    let items = this.getItems();
    for (let item of items) {
      if (hasChecked && hasUnchecked)
        break;
      if (!hasChecked)
        hasChecked = item.hasChecked();
      if (!hasUnchecked)
        hasUnchecked = item.hasUnchecked();
    }

    let select;
    if (hasChecked && hasUnchecked) {
      select = SOME;
    } else if (hasUnchecked) {
      select = NONE;
    } else {
      select = ALL;
    }

    this.selectBox_.select(select);
  }

  setCollapsed(collapsed: boolean, force?: boolean) {
    if (!force && this.manuallyCollapsed_)
      return;

    // Performance optimization to avoid rendering when nothing has changed.
    if (this.collapsed_ === collapsed)
      return;

    if (collapsed)
      this.selectRows(false);

    this.collapsed_ = collapsed;
    this.render();
  }

  protected render() {
    this.expander_.textContent = '';
    this.expander_.append(this.collapsed_ ? expandArrow() : collapseArrow());
    this.selectBox_.setDisabled(this.collapsed_);
  }
}
