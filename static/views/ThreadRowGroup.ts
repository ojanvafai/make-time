import {collapseArrow, expandArrow} from '../Base.js';
import {SelectBox, SelectChangedEvent} from '../SelectBox.js';
import {ALL, NONE, SOME} from '../SelectBox.js';

import {SelectRowEvent, ThreadRow} from './ThreadRow.js';

export class ThreadRowGroup extends HTMLElement {
  private rowContainer_: HTMLElement;
  private placeholder_: HTMLElement;
  private selectBox_: SelectBox;
  private groupNameContainer_: HTMLElement;
  private rowCountDisplay_: Text;
  private expander_: HTMLElement;
  private lastRowHeight_?: number;
  private wasCollapsed_?: boolean;
  private inViewport_: boolean;
  private wasInViewport_: boolean;
  private collapsed_: boolean;
  private manuallyCollapsed_: boolean;
  private rows_?: ThreadRow[];

  constructor(private groupName_: string, private allowedCount_?: number) {
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

    this.wasInViewport_ = true;
    this.inViewport_ = false;
    this.collapsed_ = true;
    this.manuallyCollapsed_ = false;

    this.selectBox_ = new SelectBox();
    this.selectBox_.addEventListener(SelectChangedEvent.NAME, () => {
      this.selectRows_(this.selectBox_.selected() === ALL);
    });

    this.groupNameContainer_ = document.createElement('div');
    this.groupNameContainer_.style.cssText = `
      font-weight: bold;
      font-size: 18px;
      flex: 1;
      padding: 12px 4px 12px 0;
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

    this.rowCountDisplay_ = new Text();

    this.expander_ = document.createElement('div');
    this.expander_.style.cssText = `
      color: var(--dim-text-color);
      margin-top: 2px;
      font-weight: bold;
      font-size: 12px;
    `;

    this.groupNameContainer_.append(
        this.expander_, groupName_, this.rowCountDisplay_);

    let header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: stretch;
    `;
    header.append(this.selectBox_, this.groupNameContainer_);
    this.append(header);

    this.rowContainer_ = document.createElement('div');
    this.placeholder_ = document.createElement('div');
    this.placeholder_.style.backgroundColor = 'var(--nested-background-color)';
    this.append(this.rowContainer_, this.placeholder_);

    this.addEventListener(SelectRowEvent.NAME, () => this.updateSelectBox_());
  }

  setInViewport(inViewport: boolean) {
    this.inViewport_ = inViewport;

    if (this.collapsed_)
      return;

    this.rowContainer_.style.display = inViewport ? '' : 'none';
    this.placeholder_.style.display = inViewport ? 'none' : '';

    let rows = Array.from(this.rowContainer_.children) as ThreadRow[];
    for (let row of rows) {
      row.setInViewport(inViewport);
    }
  }

  private updateSelectBox_() {
    let rows = this.getRows();
    let hasChecked = false;
    let hasUnchecked = false;
    for (let row of rows) {
      if (hasChecked && hasUnchecked)
        break;
      if (!hasChecked)
        hasChecked = row.checked;
      if (!hasUnchecked)
        hasUnchecked = !row.checked;
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

  private updateRowCount_(count: number, collapsed: boolean) {
    let overLimit = this.allowedCount_ && count > this.allowedCount_;
    this.groupNameContainer_.style.color = overLimit ? 'red' : '';

    let text;
    if (overLimit)
      text = ` (${count}/${this.allowedCount_})`;
    else if (collapsed)
      text = ` (${count})`;
    else
      text = '';
    this.rowCountDisplay_.textContent = text;
  }

  setCollapsed(collapsed: boolean, force?: boolean) {
    if (!force && this.manuallyCollapsed_)
      return;

    this.collapsed_ = collapsed;
    this.render_();
  }

  getRows() {
    return Array.from(this.rowContainer_.childNodes) as ThreadRow[];
  }

  getFirstRow() {
    return this.rowContainer_.firstChild as ThreadRow | null;
  }
  hasRows() {
    return !!this.rowContainer_.childElementCount;
  }

  rowsChanged_(rows: ThreadRow[]) {
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
    return this.render_();
  }

  render_() {
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
    this.updateRowCount_(this.rows_.length, this.collapsed_);

    this.expander_.textContent = '';
    this.expander_.append(this.collapsed_ ? expandArrow() : collapseArrow());
    this.selectBox_.setDisabled(this.collapsed_);

    this.rowContainer_.style.display = this.collapsed_ ? 'none' : '';

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

    return removed;
  }

  private selectRows_(select: boolean) {
    if (this.collapsed_)
      return;

    this.selectBox_.select(select ? ALL : NONE);
    let rows = this.getRows();
    for (let child of rows) {
      child.setChecked(select);
      if (!select)
        child.clearFocusImpliesSelected();
    }

    if (select) {
      let lastRow = rows[rows.length - 1];
      lastRow.setFocus(true, false);
    }
  }

  get name() {
    return this.groupName_;
  }
}
window.customElements.define('mt-thread-row-group', ThreadRowGroup);
