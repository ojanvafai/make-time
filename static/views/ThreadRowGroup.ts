import {ThreadListModel} from '../models/ThreadListModel';

import {ThreadRow} from './ThreadRow';

export class ToggleCollapsedEvent extends Event {
  static NAME = 'toggle-collapsed';
  constructor() {
    super(ToggleCollapsedEvent.NAME);
  }
}

export class ThreadRowGroup extends HTMLElement {
  private rowContainer_: HTMLElement;
  private rowCountWhenCollapsed_: number;
  private toggler_: HTMLElement;

  constructor(private groupName_: string, private model_: ThreadListModel) {
    super();
    this.style.cssText = `
      display: block;
      border-bottom: 1px solid #ddd;
    `;

    let groupNameContainer = document.createElement('span')
    groupNameContainer.style.cssText = `
      font-weight: bold;
      font-size: 18px;
    `;
    groupNameContainer.append(groupName_);

    this.toggler_ = document.createElement('div');
    this.toggler_.style.cssText = `
      display: inline-block;
      text-decoration: underline;
      margin: 0 10px;
    `;
    this.toggler_.append(this.isCollapsed_() ? 'expand' : 'collapse');
    this.toggler_.addEventListener('click', () => this.toggleCollapsed_());

    let header = document.createElement('div');
    header.style.cssText = `
      margin-left: 5px;
      padding-top: 10px;
    `;

    header.append(groupNameContainer, this.toggler_)

    if (!this.isCollapsed_()) {
      header.append(
          ' select ', this.createSelector_('all', this.selectAll_),
          this.createSelector_('none', this.selectNone_));
    }

    this.rowCountWhenCollapsed_ = 0;
    this.rowContainer_ = document.createElement('div');
    this.append(header, this.rowContainer_);
  }

  isCollapsed_() {
    return this.model_.isCollapsed(this.groupName_);
  }

  toggleCollapsed_() {
    this.model_.toggleCollapsed(this.groupName_);
  }

  getRows() {
    return <NodeListOf<ThreadRow>>this.querySelectorAll('mt-thread-row');
  }

  hasRows() {
    return !!this.rowContainer_.childElementCount;
  }

  push(row: ThreadRow) {
    if (this.isCollapsed_()) {
      this.toggler_.textContent =
          `expand ${++this.rowCountWhenCollapsed_} threads`;
    } else {
      this.rowContainer_.append(row);
    }
  }

  removeIfEmpty() {
    if (!this.rowContainer_.childElementCount)
      this.remove();
  }

  createSelector_(textContent: string, callback: () => void) {
    let selector = document.createElement('span');
    selector.textContent = textContent;
    selector.style.textDecoration = 'underline';
    selector.style.marginRight = '4px';
    selector.onclick = callback.bind(this);
    return selector;
  }

  selectAll_() {
    this.selectRows_(true);
  }

  selectNone_() {
    this.selectRows_(false);
  }

  selectRows_(select: boolean) {
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
