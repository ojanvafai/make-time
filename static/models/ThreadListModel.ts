import {firebase} from '../../public/third_party/firebasejs/5.8.2/firebase-app.js';
import {assert} from '../Base.js';
import {firestoreUserCollection} from '../BaseMain.js';
import {Labels} from '../Labels.js';
import {Priority, ThreadMetadataUpdate} from '../Thread.js';
import {Thread, ThreadMetadata} from '../Thread.js';

import {Model} from './Model.js';

interface TriageResult {
  thread: Thread;
  state: ThreadMetadataUpdate;
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
  private snapshotToProcess_?: firebase.firestore.QuerySnapshot|null;
  private processSnapshotTimeout_?: number;

  constructor(queryKey: string) {
    super();

    this.resetUndoableActions_();
    this.threads_ = [];
    this.snapshotToProcess_ = null;

    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    metadataCollection.where(queryKey, '==', true)
        .onSnapshot((snapshot) => this.queueProcessSnapshot(snapshot));
  }

  protected abstract compareThreads(a: Thread, b: Thread): number;
  protected abstract shouldShowThread(thread: Thread): boolean;
  abstract getGroupName(thread: Thread): string;

  // onSnapshot is called sync for local changes. If we modify a bunch of things
  // locally in rapid succession we want to debounce to avoid hammering the CPU.
  private async queueProcessSnapshot(snapshot:
                                         firebase.firestore.QuerySnapshot) {
    // In the debounce case, intentionally only process the last snapshot since
    // that has the most up to date data.
    this.snapshotToProcess_ = snapshot;
    window.clearTimeout(this.processSnapshotTimeout_);
    this.processSnapshotTimeout_ = window.setTimeout(async () => {
      if (!this.snapshotToProcess_)
        return;
      this.processSnapshot_();
      // Intentionally do this after processing all the threads in the disk
      // cache so that they show up atomically and so we spend less CPU
      // rendering incremental frames.
      // TODO: Should probably call this occasionaly in the above loop if that
      // loop is taking too long to run.
      this.threadListChanged_();
      await this.updateMessages_();
    }, 100);
  }

  private async updateMessages_() {
    // First fetch all the threads from disk so we show the local data ASAP.
    for (let thread of this.threads_) {
      await thread.fetchFromDisk();
    }

    // Then update the threads from the network.
    // TODO: Use TaskQueue to do in parallel.
    for (let thread of this.threads_) {
      await thread.update();
    }
  }

  private async processSnapshot_() {
    let snapshot = assert(this.snapshotToProcess_);
    this.snapshotToProcess_ = null;

    this.threads_ = [];
    for (let doc of snapshot.docs) {
      let data = doc.data();
      if (data.blocked || data.queued)
        continue;

      let thread = Thread.create(doc.id, data as ThreadMetadata);
      this.threads_.push(thread);
    };

    this.threads_.sort(this.compareThreads.bind(this));
  }

  protected compareDates(a: Thread, b: Thread) {
    return -(a.getDate() > b.getDate()) || +(a.getDate() < b.getDate());
  }

  getThreads() {
    // Make sure any in progress snapshot updates get flushed.
    if (this.snapshotToProcess_) {
      this.processSnapshot_();
      // Intentionally don't await this since we're on the critical path for
      // putting up a frame.
      this.updateMessages_();
    }
    return this.threads_;
  }

  private async threadListChanged_() {
    this.dispatchEvent(new ThreadListChangedEvent());
  }

  resetUndoableActions_() {
    this.undoableActions_ = [];
  }

  protected destinationToPriority(destination: string|null) {
    switch (destination) {
      case Labels.MUST_DO_LABEL:
        return Priority.MustDo;
      case Labels.URGENT_LABEL:
        return Priority.Urgent;
      case Labels.BACKLOG_LABEL:
        return Priority.Backlog;
      case Labels.NEEDS_FILTER_LABEL:
        return Priority.NeedsFilter;
      default:
        return null;
    }
  }

  private async markTriagedInternal_(
      thread: Thread, destination: string|null,
      _expectedNewMessageCount?: number) {
    let priority = this.destinationToPriority(destination);
    let oldState;
    if (priority) {
      oldState = await thread.setPriority(priority);
    } else {
      switch (destination) {
        case null:
          oldState = await thread.archive();
          break;

        case Labels.BLOCKED_LABEL:
          oldState = await thread.setBlocked();
          break;

        case Labels.MUTED_LABEL:
          oldState = await thread.setMuted();
          break;

        default:
          assert(false, 'This should never happen.');
      }
    }

    this.undoableActions_.push({
      thread: thread,
      state: oldState,
    })
  }

  async markSingleThreadTriaged(
      thread: Thread, destination: string|null,
      expectedNewMessageCount?: number) {
    this.resetUndoableActions_();
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
    for (let thread of threads) {
      this.markTriagedInternal_(thread, destination, expectedNewMessageCount);
      progress.incrementProgress();
    };
  }

  async undoLastAction_() {
    if (!this.undoableActions_ || !this.undoableActions_.length) {
      alert('Nothing left to undo.');
      return;
    }

    let actions = this.undoableActions_;
    this.resetUndoableActions_();

    let progress = this.updateTitle(
        'ThreadListModel.undoLastAction_', actions.length, 'Undoing...');

    for (let i = 0; i < actions.length; i++) {
      let newState = actions[i].state;
      // TODO: We should also keep track of the messages we marked read so we
      // can mark them unread again, and theoretically, we should only put the
      // messages that we previously in the inbox back into the inbox, so we
      // should keep track of the actual message IDs modified.
      newState.moveToInbox = true;
      await actions[i].thread.updateMetadata(newState);
      this.dispatchEvent(new UndoEvent(actions[i].thread));
      progress.incrementProgress();
    }
  }
}
