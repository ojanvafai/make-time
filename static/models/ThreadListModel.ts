import {firebase} from '../../public/third_party/firebasejs/5.8.2/firebase-app.js';
import {Action} from '../Actions.js';
import {assert, compareDates, setFaviconCount as setFavicon} from '../Base.js';
import {Priority, ThreadMetadataUpdate} from '../Thread.js';
import {Thread, ThreadMetadata} from '../Thread.js';
import {takeAction} from '../ThreadActions.js';

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

  constructor(showFaviconCount?: boolean) {
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
  abstract getGroupName(thread: Thread): string;

  setSortOrder(_threads: Thread[]) {
    assert(false);
  }

  labelHref(_label: string) {
    return '';
  }

  protected setQuery(query: firebase.firestore.Query) {
    query.onSnapshot((snapshot) => this.queueProcessSnapshot(snapshot));
  }

  protected shouldShowThread(thread: Thread, showQueued?: boolean) {
    if (!showQueued && thread.isQueued())
      return false;

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

  showTopThreads(_groupName: string) {
    return false;
  }

  hideGroupControls(_groupName: string) {
    return false;
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
      let thread = Thread.create(doc.id, data as ThreadMetadata);

      if (!this.shouldShowThread(thread))
        continue;

      if (data.priorityId === Priority.MustDo ||
          data.priorityId === Priority.NeedsFilter)
        faviconCount++;

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

  * getThreadGenerator() {
    for (const event of this.threads_)
      yield event;
  }

  processInIdleTime_<T>(
      items: IterableIterator<T>, callback: (item: T) => Promise<void>) {
    return new Promise((resolve) => {
      window.requestIdleCallback(async (deadline) => {
        let handler = async () => {
          let item = items.next();
          while (!item.done) {
            await callback(item.value);
            if (deadline.timeRemaining() === 0) {
              window.requestIdleCallback(() => handler());
              return;
            }
            item = items.next();
          }
          resolve();
        };
        handler();
      });
    });
  }

  async fetchThreads() {
    // Do this fetching in idle time so it doesn't block other work like
    // switching views. If there's a lot of threads in this model, then we want
    // to interleave work for the other view's model as well so it can make
    // progress.
    // TODO: When the view switches, deprioritize all these fetches until the
    // new view is finished.
    await this.processInIdleTime_(
        this.getThreadGenerator(),
        async (thread) => await thread.fetchFromDisk());
    await this.processInIdleTime_(
        this.getThreadGenerator(),
        async (thread) => await thread.syncMessagesInFirestore());
  }

  static compareDates(a: Thread, b: Thread) {
    return compareDates(a.getDate(), b.getDate());
  }

  getThreads() {
    // Make sure any in progress snapshot updates get flushed.
    if (this.snapshotToProcess_)
      this.processSnapshot_();
    return this.threads_.filter(
        (thread: Thread) => this.shouldShowThread(thread));
  }

  private async threadListChanged_() {
    this.dispatchEvent(new ThreadListChangedEvent());
  }

  resetUndoableActions_() {
    this.undoableActions_ = [];
  }

  protected async markTriagedInternal(
      thread: Thread, destination: Action, moveToInboxAgain?: boolean) {
    // Save this off before we modify the thread and lose this state.
    let groupName = this.getGroupName(thread);

    this.undoableActions_.push({
      thread: thread,
      state: await takeAction(thread, destination, moveToInboxAgain),
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
