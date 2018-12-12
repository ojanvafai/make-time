import { ErrorLogger } from './ErrorLogger.js';
import { Thread } from './Thread.js';
import { ThreadRow } from './views/ThreadRow.js';
import { ThreadRowGroup } from './views/ThreadRowGroup.js';

export class RowGroup {
  queue: string;
  node: ThreadRowGroup;
  private rows_: { [threadId: string]: ThreadRow; };

  private static groups_: any = {};

  static create(queue: string) {
    if (!RowGroup.groups_[queue])
      RowGroup.groups_[queue] = new RowGroup(queue);
    return <RowGroup> RowGroup.groups_[queue];
  }

  constructor(queue: string) {
    this.queue = queue;
    this.node = new ThreadRowGroup(queue);
    this.rows_ = {};
  }

  push(thread: Thread) {
    let currentRow = this.rows_[thread.id];
    if (currentRow) {
      currentRow.mark = false;
      currentRow.setThread(thread);
      return;
    }
    this.rows_[thread.id] = new ThreadRow(thread, this);
  }

  delete(row: ThreadRow) {
    delete this.rows_[row.thread.id];
  }

  getRow(thread: Thread) {
    return this.rows_[thread.id];
  }

  getRows() {
    return Object.values(this.rows_);
  }

  hasRows() {
    return !!this.getRows().length;
  }

  getFirstRow() {
    return Object.values(this.rows_)[0];
  }

  getRowFromRelativeOffset(row: ThreadRow, offset: number) {
    let rowToFind = this.getRow(row.thread);
    if (rowToFind != row)
      ErrorLogger.log(`Warning: ThreadRows don't match. Something went wrong in bookkeeping.`);
    let rows = Object.values(this.rows_);
    let index = rows.indexOf(rowToFind);
    if (index == -1)
      throw `Tried to get row via relative offset on a row that's not in the group.`;
    if (0 <= index + offset && index + offset < rows.length)
      return rows[index + offset];
    return null;
  }

  mark() {
    for (let id in this.rows_) {
      let row = this.rows_[id];
      row.mark = true;
    }
  }

  getMarked() {
    return Object.values(this.rows_).filter((row) => (<ThreadRow>row).mark);
  }
}
