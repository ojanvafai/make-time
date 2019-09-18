import {firebase} from '../../public/third_party/firebasejs/5.8.2/firebase-app.js';
import {Action} from '../Actions.js';
import {assert, compareDates} from '../Base.js';
import {Calendar} from '../calendar/Calendar.js';
import {SendAs} from '../SendAs.js';
import {ServerStorage} from '../ServerStorage.js';
import {Settings} from '../Settings.js';
import {TaskQueue} from '../TaskQueue.js';
import {ThreadMetadataUpdate} from '../Thread.js';
import {Thread, ThreadMetadata} from '../Thread.js';
import {createDateUpdate, createUpdate, pickDate} from '../ThreadActions.js';

import {Model} from './Model.js';

export interface TriageResult {
  thread: Thread;
  state: ThreadMetadataUpdate;
}

export class UndoEvent extends Event {
  constructor(public thread: Thread) {
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
  private perSnapshotThreads_: Thread[][];
  private snapshotsToProcess_: firebase.firestore.QuerySnapshot[];
  private processSnapshotTimeout_?: number;
  private filter_?: string;
  private days_?: number;
  private threadFetcher_: TaskQueue;
  private haveEverProcessedSnapshot_?: boolean;
  private offices_?: string;
  private haveLoadedFirstQuery_: boolean;
  private isProcessingSnapshots_: boolean;

  constructor(
      protected settings_: Settings, private forceTriageIndex_?: number) {
    super();

    this.timerCountsDown = false;
    this.resetUndoableActions_();

    this.perSnapshotThreads_ = [];
    this.threads_ = [];
    this.snapshotsToProcess_ = [];
    this.threadFetcher_ = new TaskQueue(3);

    this.haveLoadedFirstQuery_ = false;
    this.isProcessingSnapshots_ = false;
  }

  protected abstract compareThreads(a: Thread, b: Thread): number;
  abstract getGroupName(thread: Thread): string;

  hasFetchedThreads() {
    return this.haveEverProcessedSnapshot_;
  }

  isTriage() {
    return false;
  }

  postProcessThreads(_threads: Thread[]) {}

  // Mark a bit that this thread was triaged with unread messages so it can be
  // grouped differently in todo view. Don't mark this bit for things that are
  // overdue, stuck, or retriage since those have already been fully triaged
  // once. If the unread messages were all sent by me, then consider them read
  // as well since I don't need to read messages I sent.
  private needsMessageTriage_(thread: Thread, sendAs: SendAs) {
    return this.isTriage() && thread.unreadNotSentByMe(sendAs) &&
        !thread.hasDueDate() && !thread.isStuck() && !thread.needsRetriage();
  }

  async getNoMeetingRoomEvents() {
    let offices =
        this.offices_ || this.settings_.get(ServerStorage.KEYS.LOCAL_OFFICES);

    if (!offices)
      return [];

    let end = new Date();
    end.setDate(end.getDate() + 28);

    let model = new Calendar(this.settings_, new Date(), end);
    await model.init();

    return model.getEventsWithoutLocalRoom(offices);
  }

  setSortOrder(_threads: Thread[]) {
    assert(false);
  }

  protected setQueries(...queries: firebase.firestore.Query[]) {
    for (let i = 0; i < queries.length; i++) {
      this.perSnapshotThreads_[i] = [];

      queries[i].onSnapshot((snapshot) => {
        this.snapshotsToProcess_[i] = snapshot;
        this.queueProcessSnapshot_();
      });
    }
  }

  setOffices(offices?: string) {
    this.offices_ = offices;
  }

  setViewFilters(filter?: string, days?: string) {
    this.filter_ = filter && filter.toLowerCase();
    this.days_ = days ? Number(days) : undefined;
    this.dispatchEvent(new ThreadListChangedEvent());
  }

  private threadDays_(thread: Thread) {
    // TODO: Make this respect day boundaries instead of just doing 24 hours.
    let oneDay = 24 * 60 * 60 * 1000;
    return (Date.now() - thread.getDate().getTime()) / (oneDay);
  }

  protected shouldShowThread(thread: Thread, showQueued?: boolean) {
    if (!showQueued && (thread.isQueued() || thread.isThrottled()))
      return false;

    let label = thread.getLabel();
    if (this.filter_ && (!label || this.filter_ !== label.toLowerCase()))
      return false;

    if (this.days_ !== undefined && this.threadDays_(thread) > this.days_)
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

  allowedCount(_groupName: string) {
    return 0;
  }

  showFinalVersion() {
    return false;
  }

  // onSnapshot is called sync for local changes. If we modify a bunch of things
  // locally in rapid succession we want to debounce to avoid hammering the CPU.
  // TODO: Do we need this debounce still now that processAllSnapshots early
  // returns if we are already processing snapshots?
  private async queueProcessSnapshot_() {
    window.clearTimeout(this.processSnapshotTimeout_);
    this.processSnapshotTimeout_ =
        window.setTimeout(async () => this.processAllSnapshots_(true), 100);
  }

  private processAllSnapshots_(fireChange?: boolean) {
    // this.fetchThreads_ modifies threads when it does network fetches, which
    // in turn modifies the snapshot, and causes us to loop back through this
    // code. Early return and process snapshots again when we're one rather than
    // trying to make snapshot processing interruptible.
    if (this.isProcessingSnapshots_)
      return;

    // Wait until all the snapshots have loaded once to start processiing them.
    // This helps avoid clogging the main thread with work for a secondary
    // snapshot before we've gotten the first.
    if (!this.haveLoadedFirstQuery_ &&
        this.snapshotsToProcess_[0] === undefined) {
      return;
    }

    this.haveLoadedFirstQuery_ = true;
    this.isProcessingSnapshots_ = true;

    // If there's an error thrown in processAllSnapshotsHelper_, we don't want
    // to get stuck never processing snapshots again, so put in a try-finally.
    try {
      this.processAllSnapshotsHelper_(fireChange);
    } finally {
      this.isProcessingSnapshots_ = false;
    }

    // If new snapshots have been added since we started processing these ones,
    // then keep processing.
    if (this.snapshotsToProcess_.length)
      this.processAllSnapshots_(fireChange);
  }

  private processAllSnapshotsHelper_(fireChange?: boolean) {
    let snapshotsToProcess = this.snapshotsToProcess_;
    this.snapshotsToProcess_ = [];

    let didProcess = false;
    for (let i = 0; i < snapshotsToProcess.length; i++) {
      let snapshot = snapshotsToProcess[i];

      // This can happen since we use a sparse array.
      if (!snapshot)
        continue;

      this.perSnapshotThreads_[i] = [];
      this.processSnapshot_(
          snapshot, this.perSnapshotThreads_[i], i === this.forceTriageIndex_);
      didProcess = true;
    }

    if (!didProcess)
      return;

    this.threadFetcher_.cancel();

    // TODO: have this.threads be an array of arrays so each snapshot gets its
    // own array and then when we read threads we need to concat them all
    // together.
    this.threads_ = ([] as Thread[]).concat(...this.perSnapshotThreads_);
    this.postProcessThreads(this.threads_);
    this.sort();
    this.fetchThreads_();

    if (fireChange)
      this.threadListChanged_();
  }

  private processSnapshot_(
      snapshot: firebase.firestore.QuerySnapshot, output: Thread[],
      forceTriage: boolean) {
    this.haveEverProcessedSnapshot_ = true;

    for (let doc of snapshot.docs) {
      let data = doc.data() as ThreadMetadata;
      let thread = Thread.create(doc.id, data as ThreadMetadata, forceTriage);
      output.push(thread);
    };
  }

  protected sort() {
    this.threads_.sort(this.compareThreads.bind(this));
  }

  private async fetchThreads_() {
    // TODO: When the view switches, deprioritize all these fetches until the
    // new view is finished.
    await this.threadFetcher_.cancel();

    for (let thread of this.threads_) {
      this.threadFetcher_.queueTask(async () => {
        await thread.fetchFromDisk();
        await thread.syncMessagesInFirestore();
      });
    }

    await this.threadFetcher_.flush();
  }

  static compareDates(a: Thread, b: Thread) {
    return compareDates(a.getDate(), b.getDate());
  }

  getThreads(skipFireChangeEvent?: boolean) {
    // Make sure any in progress snapshot updates get flushed.
    this.processAllSnapshots_(!skipFireChangeEvent);
    return this.threads_.filter(
        (thread: Thread) => this.shouldShowThread(thread));
  }

  private async threadListChanged_() {
    this.dispatchEvent(new ThreadListChangedEvent());
  }

  resetUndoableActions_() {
    this.undoableActions_ = [];
  }

  async markTriaged(
      destination: Action, threads: Thread[], moveToInbox?: boolean) {
    if (!threads.length)
      return;

    this.resetUndoableActions_();

    // Need to pick the date first for actions that require the date picker
    // since we don't want to show the date picker once per thread.
    let date = await pickDate(destination);
    // Null means that this is a date action, but no date was selected.
    // TODO: Move this up so we avoid setting actionInProgress in the early
    // return case. Or return a bool that unsets actionInProgress?
    if (date === null)
      return;

    let pending = [];

    let progress = this.updateTitle(
        'ThreadListModel.markThreadsTriaged', threads.length,
        'Modifying threads...');

    for (let thread of threads) {
      let update = date ?
          createDateUpdate(thread, destination, date, moveToInbox) :
          createUpdate(
              thread, destination, moveToInbox,
              this.needsMessageTriage_(thread, await SendAs.getDefault()));

      if (!update)
        continue;

      pending.push({update: update, thread: thread});
      this.undoableActions_.push({
        thread: thread,
        state: thread.oldMetadataState(update),
      })
    };

    for (let x of pending) {
      // TODO: Use TaskQueue to do these in parallel.
      await x.thread.updateMetadata(x.update);
      progress.incrementProgress();
    }
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
      this.dispatchEvent(new UndoEvent(actions[i].thread));
      progress.incrementProgress();
    }
  }
}
