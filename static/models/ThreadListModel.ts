import { Model } from "./Model.js";
import { Thread } from "../Thread.js";
import { Labels } from "../Labels.js";
import { IDBKeyVal } from "../idb-keyval.js";
import { getCachedThread, fetchThreads } from '../BaseMain.js';
import { RowGroup } from "../RowGroup.js";
import { ThreadRow } from "../views/ThreadRow.js";

export class PlainThreadData {
  constructor(public id: string, public historyId: string) {
  }
  equals(other: PlainThreadData) {
    return this.id == other.id && this.historyId == other.historyId;
  }
}

interface TriageResult {
  thread: Thread;
  removed: string[];
  added: string[];
}

export class UndoEvent extends Event {
  constructor(public thread: Thread) {
    super('undo');
  }
}

export class ThreadRemovedEvent extends Event {
  constructor(public row: ThreadRow, public nextRow: ThreadRow | null) {
    super('thread-removed');
  }
}

export abstract class ThreadListModel extends Model {
  private serializedThreads_: PlainThreadData[];
  private undoableActions_!: TriageResult[];
  // TODO: Rename this to groupedRows_?
  private groupedThreads_: RowGroup[];

  constructor(updateTitle: any, protected labels: Labels, private serializationKey_: string) {
    super(updateTitle);

    this.serializedThreads_ = [];
    this.resetUndoableActions_();

    // TODO: Rename this to groupedRows_?
    this.groupedThreads_ = [];
  }

  abstract handleUndo(thread: Thread): void;
  abstract handleTriaged(destination: string | null, thread: Thread): void;
  abstract async fetch(): Promise<void>;
  abstract compareRowGroups(a: any, b: any): number;
  abstract async getDisplayableQueue(thread: Thread): Promise<string>;

  async loadFromDisk() {
    let data = await IDBKeyVal.getDefault().get(this.serializationKey_);
    if (!data)
      return;

    this.serializedThreads_ = data;
    for (let threadData of data) {
      let thread = await getCachedThread(threadData);
      await this.addThread(thread);
    }
  }

  async update() {
    // Mark threads
    for (let group of this.groupedThreads_) {
      group.mark();
    }

    // Fetch unmarks any threads still in the view.
    await this.fetch();

    // Remove any marked threads from the model.
    for (let group of this.groupedThreads_) {
      let rows = group.getMarked();
      for (let row of rows) {
        await this.removeRow_(row);
      }
    }
  }

  async fetchLabels(forEachThread: (thread: Thread) => void, labels: string[]) {
    if (!labels.length)
      return;
    await fetchThreads(forEachThread, {
      query: `in:${labels.join(' OR in:')}`,
    });
  }

  async getRowFromRelativeOffset(row: ThreadRow, offset: number): Promise<ThreadRow | null> {
    if (offset != -1 && offset != 1)
      throw `getRowFromRelativeOffset called with offset of ${offset}`

    let nextRow = await row.group.getRowFromRelativeOffset(row, offset);
    if (nextRow)
      return nextRow;

    let groupIndex = this.groupedThreads_.indexOf(row.group);
    if (groupIndex == -1)
      throw `Tried to get row via relative offset on a group that's not in the tree.`;

    const group = this.getGroupFromRelativeOffset(row.group, offset);
    if (!group)
      return null;
    if (offset > 0)
      return group.getFirstRow();
    else
      return group.getLastRow();
  }

  getNextRow(row: ThreadRow) {
    return this.getRowFromRelativeOffset(row, 1);
  }

  getPreviousRow(row: ThreadRow) {
    return this.getRowFromRelativeOffset(row, -1);
  }

  getGroupFromRelativeOffset(rowGroup:RowGroup, offset : number) : RowGroup | null {
    let groupIndex = this.groupedThreads_.indexOf(rowGroup);
    if (groupIndex == -1)
      throw `Tried to get row via relative offset on a group that's not in the tree.`;
    if (0 <= groupIndex + offset && groupIndex + offset < this.groupedThreads_.length) {
      return this.groupedThreads_[groupIndex + offset];
    }
    return null;
  }

  getNextGroup(rowGroup: RowGroup) : RowGroup | null {
    return this.getGroupFromRelativeOffset(rowGroup, 1);
  }

  getPreviousGroup(rowGroup: RowGroup) : RowGroup | null {
    return this.getGroupFromRelativeOffset(rowGroup, -1);
  }

  getFirstGroup() {
    return this.groupedThreads_[0];
  }

  getLastGroup() {
    return this.groupedThreads_[this.groupedThreads_.length - 1];
  }

  getRowGroups() {
   return this.groupedThreads_;
  }

  getRowGroup_(queue: string) {
    return this.groupedThreads_.find((item) => item.queue == queue);
  }

  async addThread(thread: Thread) {
    let queue = await this.getDisplayableQueue(thread);
    let group = this.getRowGroup_(queue);
    if (!group) {
      group = RowGroup.create(queue);
      this.groupedThreads_.push(group);
      this.groupedThreads_.sort(this.compareRowGroups.bind(this));
    }
    group.push(thread);
    this.dispatchEvent(new Event('thread-list-changed'));
  }

  serializeThreads(threadsToSerialize: PlainThreadData[]) {
    let threadsChanged = threadsToSerialize.length != this.serializedThreads_.length;
    if (!threadsChanged) {
      for (var i = 0; i < threadsToSerialize.length; i++) {
        if (!threadsToSerialize[i].equals(this.serializedThreads_[i])) {
          threadsChanged = true;
          break;
        }
      }
    }

    if (threadsChanged) {
      this.serializedThreads_ = threadsToSerialize;
      IDBKeyVal.getDefault().set(this.serializationKey_, threadsToSerialize);
    }
  }

  resetUndoableActions_() {
    this.undoableActions_ = [];
  }

  async getRow(thread: Thread) {
    let queue = await this.getDisplayableQueue(thread);
    let group = this.getRowGroup_(queue);
    if (group)
      return group.getRow(thread);
    return null;
  }

  protected async removeThread(thread: Thread) {
    let row = await this.getRow(thread);
    if (row)
      await this.removeRow_(row);
  }

  private async removeRow_(row: ThreadRow) {
    let nextRow = await this.getNextRow(row);
    row.group.delete(row);
    this.dispatchEvent(new ThreadRemovedEvent(row, nextRow));
  }

  private async markTriagedInternal_(thread: Thread, destination: string | null) {
    let triageResult = <TriageResult>(await thread.markTriaged(destination));
    if (triageResult)
      this.undoableActions_.push(triageResult);
    await this.handleTriaged(destination, thread);
  }

  async markSingleThreadTriaged(row: ThreadRow, destination: string | null) {
    this.resetUndoableActions_();
    await this.removeRow_(row);
    this.markTriagedInternal_(row.thread, destination);
  }

  async markThreadsTriaged(rows: ThreadRow[], destination: string | null) {
    this.resetUndoableActions_();

    this.updateTitle('archiving', `Archiving ${rows.length} threads...`);

    for (let row of rows) {
      await this.removeRow_(row);
    }
    await this.dispatchEvent(new Event('thread-list-changed'));

    for (let i = 0; i < rows.length; i++) {
      this.updateTitle('archiving', `Archiving ${i + 1}/${rows.length} threads...`);
      let row = rows[i];
      await this.markTriagedInternal_(row.thread, destination);
    }

    this.updateTitle('archiving');
  }

  async undoLastAction_() {
    if (!this.undoableActions_ || !this.undoableActions_.length) {
      alert('Nothing left to undo.');
      return;
    }

    let actions = this.undoableActions_;
    this.resetUndoableActions_();

    for (let i = 0; i < actions.length; i++) {
      this.updateTitle('undoLastAction_', `Undoing ${i + 1}/${actions.length}...`);

      let action = actions[i];
      await this.handleUndo(action.thread);

      await action.thread.modify(action.removed, action.added);
      await action.thread.update();
      await this.addThread(action.thread);

      this.dispatchEvent(new UndoEvent(action.thread));
    }

    this.updateTitle('undoLastAction_');
  }

  hasBestEffortThreads() {
    return false;
  }
}
