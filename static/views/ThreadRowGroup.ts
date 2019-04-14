import {defined} from '../Base.js';
import {ThreadListModel} from '../models/ThreadListModel.js';

import {ThreadRow} from './ThreadRow.js';

export class ToggleCollapsedEvent extends Event {
  static NAME = 'toggle-collapsed';
  constructor() {
    super(ToggleCollapsedEvent.NAME);
  }
}

const NUM_TOP_THREADS = 3;

export class ThreadRowGroup extends HTMLElement {
  private rowContainer_: HTMLElement;
  private rowCountWhenCollapsed_: number;
  private expander_?: HTMLElement;

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
    groupNameContainer.append(this.groupName_);

    let header = document.createElement('div');
    header.style.cssText = `
      margin-left: 5px;
      padding-top: 10px;
    `;
    header.append(groupNameContainer);
    this.append(header);

    this.appendControls_(header);

    this.rowCountWhenCollapsed_ = 0;
    this.rowContainer_ = document.createElement('div');
    this.append(this.rowContainer_);
  }

  appendControls_(header: HTMLElement) {
    if (this.hideControls_())
      return;

    let toggler = document.createElement('div');
    toggler.style.cssText = `
      display: inline-block;
      text-decoration: underline;
      margin: 0 10px;
    `;
    toggler.append(this.isCollapsed_() ? 'expand' : 'collapse');
    toggler.addEventListener('click', () => this.toggleCollapsed_());

    this.expander_ = toggler;
    header.append(toggler);

    if (!this.isCollapsed_()) {
      header.append(
          ' select ', this.createSelector_('all', this.selectAll_),
          this.createSelector_('none', this.selectNone_));
    }

    if (this.isCollapsed_() && this.showTopThreads_()) {
      this.expander_ = document.createElement('div');
      this.expander_.addEventListener('click', () => this.toggleCollapsed_());
      this.append(this.expander_);
    }
  }

  isCollapsed_() {
    return this.model_.isCollapsed(this.groupName_);
  }

  showTopThreads_() {
    return this.model_.showTopThreads(this.groupName_);
  }

  hideControls_() {
    return this.model_.hideGroupControls(this.groupName_);
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

  setExpanderText_(text: string) {
    let expander = defined(this.expander_);
    expander.style.cssText = `
      padding: 5px;
      text-decoration: underline;
    `;
    expander.textContent = text;
  }

  push(row: ThreadRow) {
    if (!this.hideControls_() && this.isCollapsed_()) {
      let threadsElided = ++this.rowCountWhenCollapsed_;
      if (this.showTopThreads_()) {
        threadsElided -= NUM_TOP_THREADS;
        if (threadsElided > 0)
          this.setExpanderText_(`${threadsElided} more...`);
      } else {
        this.setExpanderText_(`expand ${threadsElided} threads`);
      }
    }

    if (this.hideControls_() || !this.isCollapsed_() ||
        (this.showTopThreads_() &&
         this.rowContainer_.childElementCount < NUM_TOP_THREADS)) {
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
