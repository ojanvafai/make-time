import { ThreadRow } from './ThreadRow.js';

// TODO: Make this inherit from an abstract base class shared with
// ThreadRowGroup.
export abstract class ThreadRowGroupBase extends HTMLElement {
  constructor(public name: string) {
    super();
    this.style.cssText = `
      display: block;
      border-radius: 3px;
      margin: auto;
      max-width: var(--max-width);
      position: relative;
    `;
  }

  protected createGroupNameContainer() {
    const groupNameContainer = document.createElement('div');
    groupNameContainer.style.cssText = `
      font-weight: bold;
      font-size: 18px;
      flex: 1;
      padding: 12px 4px 12px 7px;
      display: flex;
      align-items: center;
      border-radius: 3px;
      white-space: nowrap;
      overflow: hidden;
    `;
    return groupNameContainer;
  }

  abstract setInViewport(_inViewport: boolean): void;
  abstract getRows(): ThreadRow[];
  abstract getFirstRow(): ThreadRow | null;
  abstract setCollapsed(_collapsed: boolean, _force?: boolean): void;
  abstract setRows(rows: ThreadRow[]): ThreadRow[];
  abstract render(): ThreadRow[];
  abstract hasSelectedRows(): boolean;
  abstract selectRows(_select: boolean): void;
}
