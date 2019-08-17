import {Action} from '../Actions.js';
import {compareDates, defined, notNull} from '../Base.js';
import {firestoreUserCollection, login} from '../BaseMain.js';
import {ThreadListModel, TriageResult} from '../models/ThreadListModel.js';
import {TodoModel} from '../models/TodoModel.js';
import {Settings} from '../Settings.js';
import {STUCK_LABEL_NAME, Thread, ThreadMetadataKeys} from '../Thread.js';

import {AppShell} from './AppShell.js';
import {ThreadListView} from './ThreadListView.js';
import {View} from './View.js';

let FIRESTORE_KEYS = [
  ThreadMetadataKeys.blocked,
  ThreadMetadataKeys.queued,
  ThreadMetadataKeys.muted,
  ThreadMetadataKeys.softMuted,
  ThreadMetadataKeys.archivedByFilter,
];

class HiddenModel extends ThreadListModel {
  constructor(settings_: Settings, private keyIndex_: number) {
    // For muted, don't put undo items back in the inbox.
    super(settings_);

    if (this.queryKey_() === ThreadMetadataKeys.blocked) {
      // TODO: Exclude hasLabel threads
      let metadataCollection =
          firestoreUserCollection().doc('threads').collection('metadata');
      this.setQueries(metadataCollection.orderBy('blocked', 'asc'));
    } else {
      let metadataCollection =
          firestoreUserCollection().doc('threads').collection('metadata');
      this.setQueries(metadataCollection.where(this.queryKey_(), '==', true));
    }
  }

  private queryKey_() {
    return FIRESTORE_KEYS[this.keyIndex_];
  }

  compareThreads(a: Thread, b: Thread) {
    switch (this.queryKey_()) {
      case ThreadMetadataKeys.blocked:
        // Reverse sort by blocked date for the blocked view.
        return compareDates(
            notNull(b.getStuckDate()), notNull(a.getStuckDate()));

      case ThreadMetadataKeys.queued:
        return TodoModel.compareTriageThreads(this.settings_, a, b);

      default:
        return ThreadListModel.compareDates(a, b);
    }
  }

  protected shouldShowThread(thread: Thread) {
    switch (this.queryKey_()) {
      case ThreadMetadataKeys.blocked:
        if (this.queryKey_() === ThreadMetadataKeys.blocked &&
            thread.needsTriage())
          return false;
        break;

      case ThreadMetadataKeys.queued:
        return super.shouldShowThread(thread, true);
    }

    return super.shouldShowThread(thread);
  }

  getGroupName(thread: Thread) {
    switch (this.queryKey_()) {
      case ThreadMetadataKeys.blocked:
        return STUCK_LABEL_NAME;

      case ThreadMetadataKeys.queued:
        return TodoModel.getTriageGroupName(this.settings_, thread);

      default:
        return this.queryKey_();
    }
  }

  // Moving one of these types out of hidden into a priority or blocked means
  // we need to mvoe it back into the inbox.
  triageMovesToInbox_() {
    return this.queryKey_() === ThreadMetadataKeys.muted ||
        this.queryKey_() === ThreadMetadataKeys.softMuted ||
        this.queryKey_() === ThreadMetadataKeys.archivedByFilter;
  }

  async markTriaged(destination: Action, threads: Thread[]) {
    super.markTriaged(destination, threads, this.triageMovesToInbox_());
  }

  // Override the undo action for muted and archive since we need to have them
  // set the appropriate state for removeing the thread from the inbox again
  // if the thread was already put back in the inbox.
  async handleUndoAction(action: TriageResult) {
    switch (this.queryKey_()) {
      case ThreadMetadataKeys.softMuted:
        await action.thread.softMute();
        return;

      case ThreadMetadataKeys.muted:
        await action.thread.mute();
        return;

      case ThreadMetadataKeys.archivedByFilter:
        await action.thread.archive(true);
        return;

      default:
        await super.handleUndoAction(action);
    }
  }
}

export class HiddenView extends View {
  private threadListView_?: ThreadListView;
  private select_: HTMLSelectElement;

  constructor(private appShell_: AppShell, private settings_: Settings) {
    super();

    let container = document.createElement('div');
    container.style.cssText = `
      text-align: center;
      margin-top: 4px;
    `;
    this.append(container);

    this.select_ = document.createElement('select');
    for (let key of FIRESTORE_KEYS) {
      let option = document.createElement('option');
      if (key === ThreadMetadataKeys.blocked) {
        option.append(STUCK_LABEL_NAME);
        option.value = key;
      } else {
        option.append(key);
      }
      this.select_.append(option);
    }
    this.select_.addEventListener('change', () => this.handleSelectChange_());

    container.append(this.select_);
  }

  async init() {
    await login();
    this.render_();
  }

  render_() {
    // If we're in view one mode, hide the back arrow since we're going back
    // to the threadlist, but with a new ThreadListView.
    this.appShell_.showBackArrow(false);

    let model = new HiddenModel(this.settings_, this.select_.selectedIndex);

    if (this.threadListView_)
      this.threadListView_.remove();
    // TODO: Make ThreadListView take a property back for all it's optional
    // arguments.
    this.threadListView_ = new ThreadListView(
        model, this.appShell_, this.settings_, undefined, false);
    this.append(this.threadListView_);
  }

  async handleSelectChange_() {
    this.render_();
  }

  async goBack() {
    await defined(this.threadListView_).goBack();
  }

  async dispatchShortcut(e: KeyboardEvent) {
    await defined(this.threadListView_).dispatchShortcut(e);
  };

  async takeAction(action: Action) {
    await defined(this.threadListView_).takeAction(action);
  }
}
window.customElements.define('mt-hidden-view', HiddenView);
