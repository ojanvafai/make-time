import {BaseThreadRowGroup} from './BaseThreadRowGroup.js';
import {ThreadRowGroup} from './ThreadRowGroup.js';

export class MetaThreadRowGroup extends BaseThreadRowGroup {
  private rowContainer_: HTMLElement;

  constructor(groupName_: string) {
    super(groupName_);

    this.rowContainer_ = document.createElement('div');
    this.rowContainer_.style.cssText = `
    margin: 0px 0px 6px 20px;
    padding-left: 19px;
      border-left: 1px solid var(--midpoint-color);
    `;
    this.append(this.rowContainer_);
    this.render();
  }

  getItems() {
    return Array.from(
        this.rowContainer_.childNodes as NodeListOf<ThreadRowGroup>);
  }

  getSubGroups() {
    return this.getItems();
  }

  getRows() {
    return this.getItems().map(x => x.getRows()).flat();
  }

  getFirstRow() {
    return (this.rowContainer_.firstChild as ThreadRowGroup).getFirstRow();
  }

  push(group: ThreadRowGroup) {
    this.rowContainer_.append(group);
  }

  shift(group: ThreadRowGroup) {
    this.rowContainer_.prepend(group);
  }

  render() {
    super.render();
    this.rowContainer_.style.display = this.collapsed_ ? 'none' : '';
    this.updateRowCount_();
  }

  selectRows(select: boolean) {
    this.getItems().map(x => x.selectRows(select));
  }
}
window.customElements.define('mt-meta-thread-row-group', MetaThreadRowGroup);
