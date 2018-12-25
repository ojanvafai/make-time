import { ThreadRow } from "./ThreadRow";

export class ThreadRowGroup extends HTMLElement {
  private rowContainer_: HTMLElement;

  constructor(private queue_: string) {
    super();
    this.style.display = 'block';

    let queueContainer = document.createElement('span')
    queueContainer.style.cssText = `
      font-weight: bold;
      font-size: 18px;
    `;
    queueContainer.append(queue_);

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

  rows(): ThreadRow[] {
    return Array.prototype.slice.call(this.rowContainer_.children);
  }

  setRows(rows: ThreadRow[]) {
    // Try to minimize DOM mutations. If the rows are exactly the same
    // there should be no DOM mutations here.
    for (var i = 0; i < rows.length; i++) {
      let oldRow = this.rowContainer_.children[i];
      if (!oldRow) {
        let rowsLeft = rows.slice(i);
        this.rowContainer_.append(...rowsLeft);
        break;
      }

      let newRow = rows[i];
      if (newRow != oldRow) {
        oldRow.before(newRow);
      }
    }
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

