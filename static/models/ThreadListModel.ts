import {getCachedThread, ThreadData} from '../BaseMain.js';
import {IDBKeyVal} from '../idb-keyval.js';
import {Labels} from '../Labels.js';
import {TASK_COMPLETED_EVENT_NAME, TaskQueue} from '../TaskQueue.js';
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
  private undoableActions_!: Promise<TriageResult|null>[];
  private threads_: Thread[];
  private queuedRemoves_: Thread[];
  private isUpdating_: boolean;

  constructor(protected labels: Labels, private serializationKey_: string) {
    super();

    this.resetUndoableActions_();
    this.threads_ = [];
    this.queuedRemoves_ = [];
    this.isUpdating_ = false;
  }

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

    let queuedRemoves = this.queuedRemoves_;
    this.queuedRemoves_ = [];

    this.threads_ = threads.filter(x => !queuedRemoves.includes(x));
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
    // If an update is in progress, we need to make sure to apply this remove to
    // that update as well as the current working thread list.
    if (this.queuedRemoves_)
      this.queuedRemoves_.push(thread);
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
    // Put the promises into the undoableActions_ list instead of the resolve
    // promises to avoid a race there undoableActions_ is reset (e.g. due to
    // another triage action) and we push the result to it anyways.
    let triageAction = thread.markTriaged(destination, expectedNewMessageCount);
    this.undoableActions_.push(triageAction);
    await triageAction;
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

    let progress = this.updateTitle(
        'ThreadListModel.markThreadsTriaged', threads.length,
        'Modifying threads...');

    // Update the UI first and then archive one at a time.
    this.removeThreads_(threads);

    const taskQueue = new TaskQueue(3);
    taskQueue.addEventListener(TASK_COMPLETED_EVENT_NAME, () => {
      progress.incrementProgress();
    });

    for (let thread of threads) {
      taskQueue.queueTask(
          () => this.markTriagedInternal_(
              thread, destination, expectedNewMessageCount));
    };
    await taskQueue.flush();
  }

  async undoLastAction_() {
    if (!this.undoableActions_ || !this.undoableActions_.length) {
      alert('Nothing left to undo.');
      return;
    }

    let actionPromises = this.undoableActions_;
    this.resetUndoableActions_();

    let progress = this.updateTitle(
        'ThreadListModel.undoLastAction_', actionPromises.length, 'Undoing...');

    let actions = await Promise.all(actionPromises);
    for (let i = 0; i < actions.length; i++) {
      let action = actions[i];
      if (action) {
        await action.thread.modify(action.removed, action.added);
        await action.thread.update();
        await this.addThread(action.thread);

        this.dispatchEvent(new UndoEvent(action.thread));
      }

      progress.incrementProgress();
    }
  }

  hasBestEffortThreads() {
    return false;
  }
}
