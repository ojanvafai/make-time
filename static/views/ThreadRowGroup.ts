import {ThreadRow} from './ThreadRow';

export class ThreadRowGroup extends HTMLElement {
  private rowContainer_: HTMLElement;

  constructor(private groupName_: string) {
    super();
    this.style.display = 'block';

    let groupNameContainer = document.createElement('span')
    groupNameContainer.style.cssText = `
      font-weight: bold;
      font-size: 18px;
    `;
    groupNameContainer.append(groupName_);

    let header = document.createElement('div');
    header.append(
        groupNameContainer, ' select ',
        this.createSelector_('all', this.selectAll_),
        this.createSelector_('none', this.selectNone_));

    header.style.cssText = `
      margin-left: 5px;
      padding-top: 10px;
    `;

    this.rowContainer_ = document.createElement('div');
    this.append(header, this.rowContainer_);
  }

  getRows() {
    return <NodeListOf<ThreadRow>>this.querySelectorAll('mt-thread-row');
  }

  hasRows() {
    return !!this.rowContainer_.childElementCount;
  }

  rows(): ThreadRow[] {
    return Array.prototype.slice.call(this.rowContainer_.children);
  }

  push(row: ThreadRow) {
    this.rowContainer_.append(row);
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
