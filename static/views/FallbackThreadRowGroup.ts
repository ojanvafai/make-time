import { UpdatedEvent } from '../Thread.js';

import { ThreadRow } from './ThreadRow.js';
import { ThreadRowGroupBase } from './ThreadRowGroupBase.js';

export class FallbackThreadRowGroup extends ThreadRowGroupBase {
  private rows_?: ThreadRow[];
  private rowContainer_: HTMLElement;
  private rowCountDisplay_: Text;
  private hasQueuedFrame_: boolean;

  constructor(name: string) {
    super(name);
    this.className = 'mx-auto p1-and-half';

    this.rowCountDisplay_ = new Text();
    this.hasQueuedFrame_ = false;

    let groupNameContainer = this.createGroupNameContainer();
    groupNameContainer.className = 'justify-center';
    groupNameContainer.append(this.rowCountDisplay_, ` need filter rules from:`);

    this.rowContainer_ = document.createElement('div');
    this.rowContainer_.className = 'contains-pii text-size-small flex flex-wrap justify-center';

    let linkContainer = document.createElement('a');
    linkContainer.className = 'hover mx-auto block text-decoration-none';
    linkContainer.href = '/unfiltered';
    linkContainer.append(groupNameContainer, this.rowContainer_);
    this.append(linkContainer);
  }

  setInViewport(_inViewport: boolean) {}

  getRows() {
    return [];
  }

  getFirstRow() {
    return null;
  }

  setCollapsed(_collapsed: boolean, _force?: boolean) {}

  setRows(rows: ThreadRow[]) {
    this.rows_ = rows;
    this.rowCountDisplay_.textContent = String(rows.length);
    for (let row of rows) {
      let messages = row.thread.getMessages();
      if (messages.length) {
        continue;
      }
      row.thread.addEventListener(UpdatedEvent.NAME, () => this.queueRender_(), { once: true });
    }
    return this.render();
  }

  private queueRender_() {
    if (this.hasQueuedFrame_) return;
    this.hasQueuedFrame_ = true;
    requestAnimationFrame(() => {
      this.hasQueuedFrame_ = false;
      this.render();
    });
  }

  render() {
    if (!this.rows_) {
      return [];
    }

    const allMessages = this.rows_.map((x) => x.thread.getMessages()).flat();
    const allFrom = allMessages.map((x) => x.parsedFrom).flat();
    const allNames = Array.from(new Set(allFrom.map((x) => x.name || x.address).flat()));

    this.rowContainer_.textContent = '';
    const elements = allNames.map((x) => this.getAddressElement_(x));
    this.rowContainer_.append(...elements);
    return [];
  }

  private getAddressElement_(name: string) {
    let element = document.createElement('div');
    element.className = 'inline-block m1';
    element.append(name);
    return element;
  }

  hasSelectedRows() {
    return false;
  }

  selectRows(_select: boolean) {}
}
window.customElements.define('mt-fallback-thread-row-group', FallbackThreadRowGroup);
