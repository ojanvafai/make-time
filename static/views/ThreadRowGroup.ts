import {collapseArrow, expandArrow} from '../Base.js';
import {ALL, NONE, SelectBox, SelectChangedEvent, SOME} from '../SelectBox.js';
import {PINNED_PRIORITY_NAME} from '../Thread.js';

import {ThreadRow} from './ThreadRow.js';

// TODO: Find a better home for this. In theory it should be in ThreadRow.ts,
// but that creates a circular reference loading ThreadRowGroup.
export class SelectRowEvent extends Event {
  static NAME = 'select-row';
  constructor(public selected: boolean, public shiftKey: boolean) {
    super(SelectRowEvent.NAME, {bubbles: true});
  }
}

export class ThreadRowGroup extends HTMLElement {
  private rowContainer_: HTMLElement;
  private placeholder_: HTMLElement;
  private lastRowHeight_?: number;
  private wasCollapsed_?: boolean;
  private inViewport_: boolean;
  private wasInViewport_: boolean;
  private rows_?: ThreadRow[];
  private selectBox_: SelectBox;
  private groupNameContainer_: HTMLElement;
  private rowCountDisplay_: Text;
  private expander_: HTMLElement;
  private collapsed_: boolean;
  private manuallyCollapsed_: boolean;

  constructor(public name: string, private allowedCount_: number) {
    super();
    this.style.cssText = `
      display: block;
      border-radius: 3px;
      margin: auto;
      max-width: var(--max-width);
    `;

    this.collapsed_ = true;
    this.manuallyCollapsed_ = false;
    this.wasInViewport_ = true;
    this.inViewport_ = false;
    this.collapsed_ = true;

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

    this.selectBox_ = new SelectBox();
    this.selectBox_.addEventListener(SelectChangedEvent.NAME, () => {
      this.selectRows(this.selectBox_.selected() === ALL);
    });
    let header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: stretch;
    `;
    header.append(this.selectBox_, this.groupNameContainer_);
    this.append(header);
    this.addEventListener(SelectRowEvent.NAME, () => this.updateSelectBox_());

    this.rowContainer_ = document.createElement('div');
    this.rowContainer_.style.cssText = `
      display: flex;
      justify-content: space-evenly;
    `;
    if (name === PINNED_PRIORITY_NAME) {
      this.rowContainer_.style.flexWrap = 'wrap';
    } else {
      this.rowContainer_.style.flexDirection = 'column';
    }

    this.placeholder_ = document.createElement('div');
    this.placeholder_.style.backgroundColor = 'var(--nested-background-color)';
    this.append(this.rowContainer_, this.placeholder_);
  }

  setInViewport(inViewport: boolean) {
    this.inViewport_ = inViewport;

    if (this.collapsed_)
      return;

    this.showRows_();

    let rows = Array.from(this.rowContainer_.children) as ThreadRow[];
    for (let row of rows) {
      row.setInViewport(inViewport);
    }
  }

  private showRows_() {
    this.rowContainer_.style.display = this.inViewport_ ? 'flex' : 'none';
    this.placeholder_.style.display = this.inViewport_ ? 'none' : '';
  }

  hasChecked() {
    return this.selectBox_.selected() !== NONE;
  }

  hasUnchecked() {
    return this.selectBox_.selected() !== ALL;
  }

  getRows() {
    return Array.from(this.rowContainer_.childNodes) as ThreadRow[];
  }

  getItems() {
    return this.getRows();
  }

  getFirstRow() {
    return this.rowContainer_.firstChild as ThreadRow | null;
  }

  // ThreadRowGroups don't have subgroups.
  getSubGroups() {
    return [this];
  }

  private updateRowCount_() {
    // -1 is a magic value for allowed count to hide the count of threads
    // entirely.
    if (this.allowedCount_ === -1)
      return;

    let count = this.getRows().length;
    let overLimit = this.allowedCount_ && count > this.allowedCount_;
    this.groupNameContainer_.style.color = overLimit ? 'red' : '';

    let text;
    if (overLimit)
      text = ` (${count}/${this.allowedCount_})`;
    else
      text = ` (${count})`;
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

  private rowsChanged_(rows: ThreadRow[]) {
    if (rows.length !== this.rowContainer_.childElementCount)
      return true;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] !== this.rowContainer_.children[i])
        return true;
    }
    return false;
  }

  setRows(rows: ThreadRow[]) {
    this.rows_ = rows;
    return this.render();
  }

  render() {
    if (!this.rows_)
      return [];

    // Minimize DOM modifications to only the cases where something has changed.
    let rowListChanged = this.rowsChanged_(this.rows_);
    if (rowListChanged || this.lastRowHeight_ !== ThreadRow.lastHeight()) {
      this.lastRowHeight_ = ThreadRow.lastHeight();
      this.placeholder_.style.height = this.collapsed_ ?
          '0' :
          `${this.rows_.length * this.lastRowHeight_}px`;
    }

    let collapseChanged = this.wasCollapsed_ !== this.collapsed_;
    // Performance optimization to avoid doing a bunch of DOM if the count and
    // sort order of rows didn't change.
    if (!rowListChanged && !collapseChanged)
      return [];

    // We early return in setInViewport, so we need to call it again when
    // collapse state changes.
    if (collapseChanged && this.wasInViewport_ !== this.inViewport_) {
      this.setInViewport(this.inViewport_);
      this.wasInViewport_ = this.inViewport_;
    }

    this.wasCollapsed_ = this.collapsed_;
    this.expander_.textContent = '';
    this.expander_.append(this.collapsed_ ? expandArrow() : collapseArrow());
    this.selectBox_.setDisabled(this.collapsed_);
    if (this.collapsed_) {
      this.rowContainer_.style.display = 'none';
      this.placeholder_.style.display = 'none';
    } else {
      this.showRows_();
    }

    let removed = [];
    // Remove rows that no longer exist.
    for (let row of Array.from(this.rowContainer_.children) as ThreadRow[]) {
      if (!this.rows_.includes(row)) {
        row.remove();
        removed.push(row);
      }
    }

    let previousRow;
    // Ensure the order of rows match the new order, but also try to
    // minimize moving things around in the DOM to minimize style recalc.
    for (let row of this.rows_) {
      if (previousRow ? row.previousSibling !== previousRow :
                        row !== this.rowContainer_.firstChild) {
        if (previousRow)
          previousRow.after(row);
        else
          this.rowContainer_.prepend(row);
      }

      row.setInViewport(this.inViewport_);
      previousRow = row;
    }

    this.updateRowCount_();
    return removed;
  }

  selectRows(select: boolean) {
    this.selectBox_.select(select ? ALL : NONE);
    let rows = this.getRows();
    for (let child of rows) {
      if (child.checked !== select)
        child.setChecked(select);
      if (!select)
        child.clearFocusImpliesSelected();
    }

    if (select) {
      let lastRow = rows[rows.length - 1];
      lastRow.setFocus(true, true);
    }
  }
}
window.customElements.define('mt-thread-row-group', ThreadRowGroup);
