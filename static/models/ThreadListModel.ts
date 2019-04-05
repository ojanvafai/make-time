import {firebase} from '../../public/third_party/firebasejs/5.8.2/firebase-app.js';
import {Action} from '../Actions.js';
import {assert, compareDates, setFaviconCount as setFavicon} from '../Base.js';
import {Priority, ThreadMetadataUpdate} from '../Thread.js';
import {Thread, ThreadMetadata} from '../Thread.js';
import {ARCHIVE_ACTION, BACKLOG_ACTION, BLOCKED_14D_ACTION, BLOCKED_1D_ACTION, BLOCKED_2D_ACTION, BLOCKED_30D_ACTION, BLOCKED_7D_ACTION, MUST_DO_ACTION, MUTE_ACTION, NEEDS_FILTER_ACTION, URGENT_ACTION} from '../views/ThreadListView.js';

import {Model} from './Model.js';

export interface TriageResult {
  thread: Thread;
  state: ThreadMetadataUpdate;
  groupName: string;
}

export class UndoEvent extends Event {
  constructor(public thread: Thread, public groupName: string) {
    super('undo');
  }
}

export class ThreadListChangedEvent extends Event {
  static NAME = 'thread-list-changed';
  constructor() {
    super(ThreadListChangedEvent.NAME);
  }
}

export abstract class ThreadListModel extends Model {
  public timerCountsDown: boolean;
  private undoableActions_!: TriageResult[];
  private threads_: Thread[];
  private collapsedGroupNames_: Map<string, boolean>;
  private snapshotToProcess_?: firebase.firestore.QuerySnapshot|null;
  private processSnapshotTimeout_?: number;
  private faviconCount_: number;

  constructor(
      showFaviconCount?: boolean, private showHiddenThreads_?: boolean) {
    super();

    this.timerCountsDown = false;
    this.resetUndoableActions_();
    this.threads_ = [];
    this.collapsedGroupNames_ = new Map();
    this.snapshotToProcess_ = null;
    this.faviconCount_ = showFaviconCount ? 0 : -1;
  }

  protected abstract defaultCollapsedState(groupName: string): boolean;
  protected abstract compareThreads(a: Thread, b: Thread): number;
  abstract getThreadRowLabel(thread: Thread): string;
  abstract getGroupName(thread: Thread): string;

  setSortOrder(_threads: Thread[]) {
    assert(false);
  }

  protected setQuery(query: firebase.firestore.Query) {
    query.onSnapshot((snapshot) => this.queueProcessSnapshot(snapshot));
  }

  protected shouldShowThread(thread: Thread) {
    // If we have archived all the messages but the change hasn't been
    // propagated to gmail yet, don't show them. This avoids threads
    // disappearing from view in ThreadListView.markTriaged_ only to show up
    // again a frame later. Long-term, don't remove rows from markTriaged_ at
    // all and just rely on firebase changes, but that will depend on first
    // moving focus state into ThreadListModel so focus updates don't read stale
    // state of whether any rows are checked.
    if (thread.getMessageIds().length === thread.getCountToArchive())
      return false;
    return true;
  }

  toggleCollapsed(groupName: string) {
    let isCollapsed = this.isCollapsed(groupName);
    this.collapsedGroupNames_.set(groupName, !isCollapsed);
    this.dispatchEvent(new ThreadListChangedEvent());
  }

  isCollapsed(groupName: string) {
    let isCollapsed = this.collapsedGroupNames_.get(groupName);
    if (isCollapsed === undefined)
      return this.defaultCollapsedState(groupName);
    return isCollapsed;
  }

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
    }, 100);
  }

  private processSnapshot_() {
    let snapshot = assert(this.snapshotToProcess_);
    this.snapshotToProcess_ = null;

    let faviconCount = 0;
    this.threads_ = [];
    for (let doc of snapshot.docs) {
      let data = doc.data() as ThreadMetadata;
      if (!this.showHiddenThreads_ && (data.blocked || data.queued))
        continue;

      if (data.priorityId === Priority.MustDo ||
          data.priorityId === Priority.NeedsFilter)
        faviconCount++;

      let thread = Thread.create(doc.id, data as ThreadMetadata);
      this.threads_.push(thread);
    };

    // The favicon doesn't support showing 3 digets so cap at 99.
    faviconCount = Math.min(99, faviconCount);
    if (this.faviconCount_ >= 0 && faviconCount !== this.faviconCount_) {
      this.faviconCount_ = faviconCount;
      setFavicon(faviconCount);
    }

    this.sort();
    this.fetchThreads();
  }

  protected sort() {
    this.threads_.sort(this.compareThreads.bind(this));
  }

  async fetchThreads() {
    for (const thread of this.threads_) {
      await thread.fetchFromDisk();
    };

    // Do network fetching after we've fetched everything off disk first.
    for (const thread of this.threads_) {
      await thread.syncMessagesInFirestore();
    }
  }

  static compareDates(a: Thread, b: Thread) {
    return compareDates(a.getDate(), b.getDate());
  }

  getThreads() {
    // Make sure any in progress snapshot updates get flushed.
    if (this.snapshotToProcess_)
      this.processSnapshot_();
    return this.threads_;
  }

  private async threadListChanged_() {
    this.dispatchEvent(new ThreadListChangedEvent());
  }

  resetUndoableActions_() {
    this.undoableActions_ = [];
  }

  protected destinationToPriority(destination: Action) {
    switch (destination) {
      case MUST_DO_ACTION:
        return Priority.MustDo;
      case URGENT_ACTION:
        return Priority.Urgent;
      case BACKLOG_ACTION:
        return Priority.Backlog;
      case NEEDS_FILTER_ACTION:
        return Priority.NeedsFilter;
      default:
        return null;
    }
  }

  protected async markTriagedInternal(
      thread: Thread, destination: Action, moveToInboxAgain?: boolean) {
    // Save this off before we modify the thread and lose this state.
    let groupName = this.getGroupName(thread);

    let priority = this.destinationToPriority(destination);
    let oldState;
    if (priority) {
      oldState = await thread.setPriority(priority, moveToInboxAgain);
    } else {
      switch (destination) {
        case ARCHIVE_ACTION:
          oldState = await thread.archive();
          break;

        case BLOCKED_1D_ACTION:
          oldState = await thread.setBlocked(1, moveToInboxAgain);
          break;

        case BLOCKED_2D_ACTION:
          oldState = await thread.setBlocked(2, moveToInboxAgain);
          break;

        case BLOCKED_7D_ACTION:
          oldState = await thread.setBlocked(7, moveToInboxAgain);
          break;

        case BLOCKED_14D_ACTION:
          oldState = await thread.setBlocked(14, moveToInboxAgain);
          break;

        case BLOCKED_30D_ACTION:
          oldState = await thread.setBlocked(30, moveToInboxAgain);
          break;

        case MUTE_ACTION:
          oldState = await thread.setMuted();
          break;

        default:
          assert(false, 'This should never happen.');
      }
    }

    this.undoableActions_.push({
      thread: thread,
      state: oldState,
      // Save out the group name since it won't be on the thread synchronously
      // after the undo action due to needing to wait for the onSnapshot.
      groupName: groupName,
    })
  }

  async markSingleThreadTriaged(thread: Thread, destination: Action) {
    this.resetUndoableActions_();
    await this.markTriagedInternal(thread, destination);
  }

  async markThreadsTriaged(threads: Thread[], destination: Action) {
    this.resetUndoableActions_();

    let progress = this.updateTitle(
        'ThreadListModel.markThreadsTriaged', threads.length,
        'Modifying threads...');
    for (let thread of threads) {
      this.markTriagedInternal(thread, destination);
      progress.incrementProgress();
    };
  }

  async handleUndoAction(action: TriageResult) {
    let newState = action.state;
    // TODO: We should also keep track of the messages we marked read so we
    // can mark them unread again, and theoretically, we should only put the
    // messages that we previously in the inbox back into the inbox, so we
    // should keep track of the actual message IDs modified.
    newState.moveToInbox = true;
    await action.thread.updateMetadata(newState);
  }

  async undoLastAction() {
    if (!this.undoableActions_ || !this.undoableActions_.length) {
      alert('Nothing left to undo.');
      return;
    }

    let actions = this.undoableActions_;
    this.resetUndoableActions_();

    let progress = this.updateTitle(
        'ThreadListModel.undoLastAction_', actions.length, 'Undoing...');

    for (let i = 0; i < actions.length; i++) {
      this.handleUndoAction(actions[i]);
      this.dispatchEvent(
          new UndoEvent(actions[i].thread, actions[i].groupName));
      progress.incrementProgress();
    }
  }
}
