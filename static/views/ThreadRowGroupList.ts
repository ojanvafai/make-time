import { ThreadRowGroupBase } from './ThreadRowGroupBase.js';

export class ThreadRowGroupList extends HTMLElement {
  getSubGroups() {
    return Array.from(this.childNodes as NodeListOf<ThreadRowGroupBase>);
  }
  getFirstRow() {
    return this.firstChild && (this.firstChild as ThreadRowGroupBase).getFirstRow();
  }
}
window.customElements.define('mt-thread-row-group-list', ThreadRowGroupList);
