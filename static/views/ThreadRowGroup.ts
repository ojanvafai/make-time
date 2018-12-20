import { ThreadRow } from "./ThreadRow";

export class ThreadRowGroup extends HTMLElement {
  private queue_: string;
  private rowContainer_: HTMLElement;

  constructor(queue: string) {
    super();
    this.style.display = 'block';

    this.queue_ = queue;

    let queueContainer = document.createElement('span')
    queueContainer.style.cssText = `
      font-weight: bold;
      font-size: 18px;
    `;
    queueContainer.append(queue);

    let header = document.createElement('div');
    header.append(
      queueContainer,
      ' select ',
      this.createSelector_('all', this.selectAll_),
      this.createSelector_('none', this.selectNone_)
    );

    header.style.cssText = `
      margin-left: 5px;
      padding-top: 10px;
    `;

    this.rowContainer_ = document.createElement('div');
    this.append(header, this.rowContainer_);
  }

  removeChildren() {
    this.rowContainer_.textContent = '';
  }

  hasRows() {
    return !!this.rowContainer_.childElementCount;
  }

  rows() {
    return Array.prototype.slice.call(this.rowContainer_.children);
  }

  push(row: ThreadRow, opt_nextSibling?: HTMLElement) {
    if (opt_nextSibling && opt_nextSibling.parentNode == this.rowContainer_)
      opt_nextSibling.before(row);
    else
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

  selectRows_(value: boolean) {
    // TODO: Give this a proper type.
    let rows = <NodeListOf<any>>this.rowContainer_.childNodes;
    for (let child of rows) {
      child.checked = value;
    }
  }

  get queue() {
    return this.queue_;
  }
}
window.customElements.define('mt-thread-row-group', ThreadRowGroup);

