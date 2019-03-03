import {firebase} from '../../public/third_party/firebasejs/5.8.2/firebase-app.js';
import {assert, notNull} from '../Base.js';
import {firestoreUserCollection} from '../BaseMain.js';
import {Labels} from '../Labels.js';
import {Priority, ThreadMetadataKeys, ThreadMetadataUpdate} from '../Thread.js';
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
  private collapsedGroupNames_: Map<string, boolean>;
  private snapshotToProcess_?: firebase.firestore.QuerySnapshot|null;
  private processSnapshotTimeout_?: number;
  private faviconCount_: number;

  constructor(queryKey: string) {
    super();

    this.resetUndoableActions_();
    this.threads_ = [];
    this.collapsedGroupNames_ = new Map();
    this.snapshotToProcess_ = null;
    this.faviconCount_ = queryKey === ThreadMetadataKeys.hasPriority ? 0 : -1;

    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    metadataCollection.where(queryKey, '==', true)
        .onSnapshot((snapshot) => this.queueProcessSnapshot(snapshot));
  }

  protected abstract defaultCollapsedState(groupName: string): boolean;
  protected abstract compareThreads(a: Thread, b: Thread): number;
  abstract getGroupName(thread: Thread): string;
  abstract showPriorityLabel(): boolean;

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

    let mustDoCount = 0;
    this.threads_ = [];
    for (let doc of snapshot.docs) {
      let data = doc.data() as ThreadMetadata;
      if (data.blocked || data.queued)
        continue;

      if (data.priorityId === Priority.MustDo)
        mustDoCount++;

      let thread = Thread.create(doc.id, data as ThreadMetadata);
      this.threads_.push(thread);
    };

    // The favicon doesn't support showing 3 digets so cap at 99.
    mustDoCount = Math.min(99, mustDoCount);
    if (this.faviconCount_ >= 0 && mustDoCount !== this.faviconCount_) {
      this.faviconCount_ = mustDoCount;
      this.updateFavicon_();
    }

    this.threads_.sort(this.compareThreads.bind(this));
    this.fetchThreads();
  }

  updateFavicon_() {
    // Don't update the favicon on mobile where it's not visibile in the tab
    // strip and we want the regular favicon for add to homescreen.
    if (navigator.userAgent.includes(' Mobile '))
      return;

    let faviconUrl;
    if (this.faviconCount_) {
      let canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 48;
      let ctx = notNull(canvas.getContext('2d'));

      ctx.fillStyle = 'red';
      ctx.beginPath();
      ctx.arc(24, 24, 24, 0, 2 * Math.PI);
      ctx.fill();

      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'white';
      ctx.strokeStyle = 'white';
      let text = String(this.faviconCount_);
      ctx.strokeText(text, 24, 24);
      ctx.fillText(text, 24, 24);
      faviconUrl = canvas.toDataURL();
    } else {
      faviconUrl = '/favicon.ico';
    }

    var link = document.createElement('link');
    var oldLink = document.getElementById('dynamic-favicon');
    link.id = 'dynamic-favicon';
    link.rel = 'shortcut icon';
    link.href = faviconUrl;
    if (oldLink)
      document.head.removeChild(oldLink);
    document.head.appendChild(link);
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

  protected compareDates(a: Thread, b: Thread) {
    return -(a.getDate() > b.getDate()) || +(a.getDate() < b.getDate());
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

  protected destinationToPriority(destination: string|null) {
    switch (destination) {
      case Labels.MustDo:
        return Priority.MustDo;
      case Labels.Urgent:
        return Priority.Urgent;
      case Labels.Backlog:
        return Priority.Backlog;
      case Labels.NeedsFilter:
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

        case Labels.Blocked:
          oldState = await thread.setBlocked();
          break;

        case Labels.Muted:
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
