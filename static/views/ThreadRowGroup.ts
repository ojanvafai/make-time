import {collapseArrow, expandArrow} from '../Base.js';
import {ALL, NONE} from '../SelectBox.js';

import {BaseThreadRowGroup} from './BaseThreadRowGroup.js';
import {ThreadRow} from './ThreadRow.js';

export class ThreadRowGroup extends BaseThreadRowGroup {
  private rowContainer_: HTMLElement;
  private placeholder_: HTMLElement;
  private rowCountDisplay_: Text;
  private lastRowHeight_?: number;
  private wasCollapsed_?: boolean;
  private inViewport_: boolean;
  private wasInViewport_: boolean;
  private rows_?: ThreadRow[];

  constructor(groupName: string, private allowedCount_?: number) {
    super(groupName);
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

    this.rowCountDisplay_ = new Text();
    this.groupNameContainer_.append(this.rowCountDisplay_);

    this.rowContainer_ = document.createElement('div');
    this.placeholder_ = document.createElement('div');
    this.placeholder_.style.backgroundColor = 'var(--nested-background-color)';
    this.append(this.rowContainer_, this.placeholder_);
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

  hasChecked() {
    return this.selectBox_.selected() !== NONE;
  }

  hasUnchecked() {
    return this.selectBox_.selected() !== ALL;
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

  selectRows(select: boolean) {
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
}
window.customElements.define('mt-thread-row-group', ThreadRowGroup);
