import {ThreadRowGroup} from './ThreadRowGroup.js';

export class MetaThreadRowGroup extends HTMLElement {
  getItems() {
    return Array.from(this.childNodes as NodeListOf<ThreadRowGroup>);
  }

  getSubGroups() {
    return this.getItems();
  }

  getRows() {
    return this.getItems().map(x => x.getRows()).flat();
  }

  getFirstRow() {
    return this.firstChild && (this.firstChild as ThreadRowGroup).getFirstRow();
  }

  push(group: ThreadRowGroup) {
    this.append(group);
  }

  shift(group: ThreadRowGroup) {
    this.prepend(group);
  }

  selectRows(select: boolean) {
    this.getItems().map(x => x.selectRows(select));
  }

  setCollapsed(_shouldCollapse: boolean) {}
}
window.customElements.define('mt-meta-thread-row-group', MetaThreadRowGroup);
