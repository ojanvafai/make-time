import {ThreadRowGroup} from './ThreadRowGroup.js';

export class ThreadRowGroupList extends HTMLElement {
  getSubGroups() {
    return Array.from(this.childNodes as NodeListOf<ThreadRowGroup>);
  }
  getFirstRow() {
    return this.firstChild && (this.firstChild as ThreadRowGroup).getFirstRow();
  }
}
window.customElements.define('mt-thread-row-group-list', ThreadRowGroupList);
