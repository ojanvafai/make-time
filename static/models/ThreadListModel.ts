import {getCachedThread, ThreadData} from '../BaseMain.js';
import {IDBKeyVal} from '../idb-keyval.js';
import {Labels} from '../Labels.js';
import {TaskQueue} from '../TaskQueue.js';
import {Thread} from '../Thread.js';

import {Model} from './Model.js';

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

export class ThreadListChangedEvent extends Event {
  constructor() {
    super('thread-list-changed');
  }
}

export abstract class ThreadListModel extends Model {
  private undoableActions_!: TriageResult[];
  private threads_: Thread[];
  private isUpdating_: boolean;

  constructor(
      updateTitle: (key: string, ...title: string[]) => void,
      protected labels: Labels, private serializationKey_: string) {
    super(updateTitle);

    this.resetUndoableActions_();
    this.threads_ = [];
    this.isUpdating_ = false;
  }

  protected abstract handleUndo(thread: Thread): void;
  protected abstract handleTriaged(destination: string|null, thread: Thread):
      void;
  protected abstract async fetch(): Promise<void>;
  protected abstract compareThreads(a: Thread, b: Thread): number;
  abstract getGroupName(thread: Thread): string;

  async loadFromDisk() {
    let data = await IDBKeyVal.getDefault().get(this.serializationKey_);
    if (!data)
      return;

    let threads = await Promise.all(<Promise<Thread>[]>data.map(
        async (x: ThreadData) => await getCachedThread(x)));
    this.setThreads(threads, true);
  }

  async update() {
    // Updates can take a very long time if there's a lot of threads to process.
    // Make sure two don't happen in parallel.
    if (this.isUpdating_)
      return;

    this.isUpdating_ = true;
    await this.fetch();
    this.isUpdating_ = false;
  }

  protected compareDates(a: Thread, b: Thread) {
    return -(a.getDateSync() > b.getDateSync()) ||
        +(a.getDateSync() < b.getDateSync());
  }

  getThreads() {
    return this.threads_;
  }

  async setThreads(threads: Thread[], skipSerialization?: boolean) {
    let oldThreads = this.threads_.concat();

    this.threads_ = threads.concat();
    this.threads_.sort(this.compareThreads.bind(this));

    let changed = oldThreads.length != this.threads_.length;
    if (!changed) {
      for (let i = 0; i < oldThreads.length; i++) {
        if (!oldThreads[i].equals(this.threads_[i])) {
          changed = true;
          break;
        }
      }
    }

    if (skipSerialization || changed)
      this.threadListChanged_(skipSerialization);
  }

  private async threadListChanged_(skipSerialization?: boolean) {
    this.dispatchEvent(new ThreadListChangedEvent());

    if (skipSerialization)
      return;

    let threadData = this.threads_.map(
        (thread) => new ThreadData(thread.id, thread.historyId));
    IDBKeyVal.getDefault().set(this.serializationKey_, threadData);
  }

  async addThread(thread: Thread) {
    this.threads_.push(thread);
    this.threads_.sort(this.compareThreads.bind(this));
    this.threadListChanged_();
  }

  resetUndoableActions_() {
    this.undoableActions_ = [];
  }

  private removeThreadInternal_(thread: Thread) {
    var index = this.threads_.indexOf(thread);
    if (index == -1)
      throw 'Attempted to remove thread not in the model.';
    this.threads_.splice(index, 1);
  }

  private removeThreads_(threads: Thread[]) {
    for (let thread of threads) {
      this.removeThreadInternal_(thread);
    }
    this.threadListChanged_();
  }

  protected removeThread(thread: Thread) {
    this.removeThreadInternal_(thread);
    this.threadListChanged_();
  }

  private async markTriagedInternal_(
      thread: Thread, destination: string|null,
      expectedNewMessageCount?: number) {
    let triageResult = <TriageResult>(
        await thread.markTriaged(destination, expectedNewMessageCount));
    if (triageResult)
      this.undoableActions_.push(triageResult);
    await this.handleTriaged(destination, thread);
  }

  async markSingleThreadTriaged(
      thread: Thread, destination: string|null,
      expectedNewMessageCount?: number) {
    this.resetUndoableActions_();
    this.removeThread(thread);
    await this.markTriagedInternal_(
        thread, destination, expectedNewMessageCount);
  }

  async markThreadsTriaged(
      threads: Thread[], destination: string|null,
      expectedNewMessageCount?: number) {
    this.resetUndoableActions_();

    this.updateTitle('archiving', `Modifying ${threads.length} threads...`);

    this.removeThreads_(threads);

    const taskQueue = new TaskQueue(3);
    for (let thread of threads) {
      taskQueue.queueTask(
          () => this.markTriagedInternal_(
              thread, destination, expectedNewMessageCount));
    };
    await taskQueue.flush();

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
      this.updateTitle(
          'undoLastAction_', `Undoing ${i + 1}/${actions.length}...`);

      let action = actions[i];
      this.handleUndo(action.thread);

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
