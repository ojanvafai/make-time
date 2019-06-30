import {defined} from '../Base.js';
import {ThreadListModel} from '../models/ThreadListModel.js';

import {ThreadRow} from './ThreadRow.js';

export class ToggleCollapsedEvent extends Event {
  static NAME = 'toggle-collapsed';
  constructor() {
    super(ToggleCollapsedEvent.NAME);
  }
}

export class ThreadRowGroup extends HTMLElement {
  private rowContainer_: HTMLElement;
  private placeholder_: HTMLElement;
  private groupNameContainer_: HTMLElement;
  private expander_?: HTMLElement;
  private lastRowHeight_?: number;
  private wasCollapsed_?: boolean;

  constructor(
      private groupName_: string, private model_: ThreadListModel,
      private allowedCount_?: number) {
    super();
    this.style.cssText = `
      display: block;
      border-bottom: 1px solid #ddd;
    `;

    this.groupNameContainer_ = document.createElement('span');
    this.groupNameContainer_.style.cssText = `
      font-weight: bold;
      font-size: 18px;
    `;

    let header = document.createElement('div');
    header.style.cssText = `
      margin-left: 5px;
      padding-top: 10px;
      display: flex;
    `;
    header.append(this.groupNameContainer_);
    this.append(header);

    this.rowContainer_ = document.createElement('div');
    this.placeholder_ = document.createElement('div');
    // Match ThreadRow color in index.html.
    this.placeholder_.style.backgroundColor = '#ffffffbb';
    this.append(this.rowContainer_, this.placeholder_);

    this.appendControls_(header);
  }

  setInViewport(inViewport: boolean) {
    this.rowContainer_.style.display = inViewport ? '' : 'none';
    this.placeholder_.style.display = inViewport ? 'none' : '';

    let rows = Array.from(this.rowContainer_.children) as ThreadRow[];
    for (let row of rows) {
      row.setInViewport(inViewport);
    }
  }

  updateRowCount_(count: number) {
    if (this.isCollapsed()) {
      let expander = defined(this.expander_);
      let countContainer = document.createElement('div');
      countContainer.style.cssText = `
        display: inline-block;
        color: grey;
      `;
      countContainer.append(`ᐯ - ${count} rows`);
      expander.textContent = '';
      expander.append(countContainer);
    }

    this.groupNameContainer_.textContent = this.groupName_;

    if (this.allowedCount_ && count > this.allowedCount_) {
      this.groupNameContainer_.append(` (${count}/${this.allowedCount_})`);
      this.groupNameContainer_.style.color = 'red';
      return;
    }

    if (this.groupNameContainer_.style.color === 'red')
      this.groupNameContainer_.style.color = '';
  }

  private appendControls_(header: HTMLElement) {
    if (this.hideControls_())
      return;

    let expander = document.createElement('div');
    expander.style.cssText = `
      display: inline-block;
      color: grey;
      margin: 2px 4px;
      padding: 0 3px;
      font-weight: bold;
      font-size: 75%;
    `;
    expander.addEventListener(
        'pointerenter', () => expander.style.outline = '1px solid');
    expander.addEventListener(
        'pointerleave', () => expander.style.outline = '');
    expander.addEventListener('click', () => this.toggleCollapsed_());

    header.append(expander);
    this.expander_ = expander;

    if (!this.isCollapsed()) {
      header.append(
          ' select ', this.createSelector_('all', this.selectAll_),
          this.createSelector_('none', this.selectNone_));
    }
  }

  isCollapsed() {
    return this.model_.isCollapsed(this.groupName_);
  }

  private hideControls_() {
    return this.model_.hideGroupControls(this.groupName_);
  }

  private toggleCollapsed_() {
    this.model_.toggleCollapsed(this.groupName_);
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
    // Minimize DOM modifications to only the cases where something has changed.
    let rowListChanged = this.rowsChanged_(rows);
    if (rowListChanged || this.lastRowHeight_ !== ThreadRow.lastHeight()) {
      this.lastRowHeight_ = ThreadRow.lastHeight();
      this.placeholder_.style.height = `${rows.length * this.lastRowHeight_}px`;
    }

    // Performance optimization to avoid doing a bunch of DOM if the count and
    // sort order of rows didn't change.
    if (!rowListChanged && this.wasCollapsed_ === this.isCollapsed())
      return [];

    this.wasCollapsed_ = this.isCollapsed();
    this.updateRowCount_(rows.length);

    if (!this.hideControls_() && this.isCollapsed()) {
      // TODO: Should we retain the rows but display:none rowContainer_
      // instead?
      this.rowContainer_.textContent = '';
      return [];
    }

    defined(this.expander_).textContent = 'ᐱ';

    let removed = [];
    // Remove rows that no longer exist.
    for (let row of Array.from(this.rowContainer_.children) as ThreadRow[]) {
      if (!rows.includes(row)) {
        row.remove();
        removed.push(row);
      }
    }

    let isGroupInViewport = !!this.rowContainer_.parentNode;

    let previousRow;
    // Ensure the order of rows match the new order, but also try to
    // minimize moving things around in the DOM to minimize style recalc.
    for (let row of rows) {
      if (previousRow ? row.previousSibling !== previousRow :
                        row !== this.rowContainer_.firstChild) {
        if (previousRow)
          previousRow.after(row);
        else
          this.rowContainer_.prepend(row);
      }

      row.setInViewport(isGroupInViewport);
      previousRow = row;
    }

    return removed;
  }

  removeIfEmpty() {
    if (!this.rowContainer_.childElementCount)
      this.remove();
  }

  private createSelector_(textContent: string, callback: () => void) {
    let selector = document.createElement('span');
    selector.textContent = textContent;
    selector.style.textDecoration = 'underline';
    selector.style.marginRight = '4px';
    selector.onclick = callback.bind(this);
    return selector;
  }

  private selectAll_() {
    this.selectRows_(true);
  }

  private selectNone_() {
    this.selectRows_(false);
  }

  private selectRows_(select: boolean) {
    let rows = <NodeListOf<ThreadRow>>this.rowContainer_.childNodes;
    for (let child of rows) {
      child.checked = select;
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
