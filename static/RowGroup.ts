import {ErrorLogger} from './ErrorLogger.js';
import {Thread} from './Thread.js';
import {ThreadRow} from './views/ThreadRow.js';
import {ThreadRowGroup} from './views/ThreadRowGroup.js';

export class RowGroup {
  node: ThreadRowGroup;
  private rows_: ThreadRow[];
  private sorted_: boolean;

  private static groups_: any = {};

  static create(queue: string) {
    if (!RowGroup.groups_[queue])
      RowGroup.groups_[queue] = new RowGroup(queue);
    return <RowGroup>RowGroup.groups_[queue];
  }

  constructor(public queue: string) {
    this.node = new ThreadRowGroup(queue);
    this.rows_ = [];
    this.sorted_ = true;
  }

  push(thread: Thread) {
    this.sorted_ = false;

    let currentRow = this.getRow(thread);
    if (currentRow) {
      currentRow.mark = false;
      currentRow.setThread(thread);
      return;
    }

    this.rows_.push(new ThreadRow(thread, this));
  }

  delete(row: ThreadRow) {
    var index = this.rows_.indexOf(row);
    if (index > -1)
      this.rows_.splice(index, 1);
  }

  getRow(thread: Thread) {
    return this.rows_.find((item) => item.thread.id == thread.id);
  }

  async getSortedRows() {
    if (!this.sorted_) {
      let rowsWithDates = await Promise.all(this.rows_.map(async row => {
        return {date: await row.thread.getDate(), row: row};
      }));
      rowsWithDates.sort((a, b) => -(a.date > b.date) || +(a.date < b.date));
      this.rows_ = rowsWithDates.map(x => x.row);
      this.sorted_ = true;
    }
    return this.rows_;
  }

  hasRows() {
    return !!this.rows_.length;
  }

  async getFirstRow() {
    let rows = await this.getSortedRows();
    return rows[0];
  }

  async getLastRow() {
    let rows = await this.getSortedRows();
    return rows[rows.length - 1];
  }

  async getRowFromRelativeOffset(row: ThreadRow, offset: number) {
    let rowToFind = this.getRow(row.thread);
    if (rowToFind != row)
      ErrorLogger.log(
          `Warning: ThreadRows don't match. Something went wrong in bookkeeping.`);
    let rows = await this.getSortedRows();
    let index = rows.indexOf(row);
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
    return this.rows_.filter((row) => (<ThreadRow>row).mark);
  }
}
