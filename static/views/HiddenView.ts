import { Action } from '../Actions.js';
import { compareDates, defined, notNull } from '../Base.js';
import { firestoreUserCollection, initialLogin } from '../BaseMain.js';
import { ThreadListModel, TriageResult } from '../models/ThreadListModel.js';
import { TodoModel } from '../models/TodoModel.js';
import { Settings } from '../Settings.js';
import { Thread, ThreadMetadataKeys } from '../Thread.js';

import { AppShell } from './AppShell.js';
import { ThreadListView } from './ThreadListView.js';
import { View } from './View.js';

let FIRESTORE_KEYS = [
  ThreadMetadataKeys.retriageTimestamp,
  ThreadMetadataKeys.throttled,
  ThreadMetadataKeys.queued,
  ThreadMetadataKeys.muted,
  ThreadMetadataKeys.softMuted,
  ThreadMetadataKeys.archivedByFilter,
];

let FIRESTORE_KEYS_TO_HUMAN_READABLE_NAME = Object.fromEntries([
  [ThreadMetadataKeys.retriageTimestamp, 'Recently modified'],
  [ThreadMetadataKeys.throttled, 'Throttled'],
  [ThreadMetadataKeys.queued, 'Queued'],
  [ThreadMetadataKeys.muted, 'Muted'],
  [ThreadMetadataKeys.softMuted, 'Soft muted'],
  [ThreadMetadataKeys.archivedByFilter, 'Archived by a filter'],
]);

class HiddenModel extends ThreadListModel {
  constructor(settings_: Settings, private keyIndex_: number) {
    // For muted, don't put undo items back in the inbox.
    super(settings_);

    let metadataCollection = firestoreUserCollection().doc('threads').collection('metadata');

    const queryKey = this.queryKey_();
    let query;
    if (queryKey === ThreadMetadataKeys.retriageTimestamp) {
      query = metadataCollection.orderBy(queryKey, 'desc').limit(50);
    } else {
      query = metadataCollection.where(queryKey, '==', true);
    }
    this.setQueries(query);
  }

  private queryKey_() {
    return FIRESTORE_KEYS[this.keyIndex_];
  }

  compareThreads(a: Thread, b: Thread) {
    switch (this.queryKey_()) {
      case ThreadMetadataKeys.retriageTimestamp:
        return compareDates(notNull(b.getRetriageDate()), notNull(a.getRetriageDate()));

      case ThreadMetadataKeys.throttled:
      case ThreadMetadataKeys.queued:
        return TodoModel.compareTriageThreads(this.settings_, a, b);

      default:
        return ThreadListModel.compareDates(a, b);
    }
  }

  protected shouldShowThread(thread: Thread) {
    switch (this.queryKey_()) {
      case ThreadMetadataKeys.retriageTimestamp:
        return true;

      case ThreadMetadataKeys.throttled:
      case ThreadMetadataKeys.queued:
        return super.shouldShowThread(thread, true);
    }

    return super.shouldShowThread(thread);
  }

  getGroupName(thread: Thread) {
    switch (this.queryKey_()) {
      case ThreadMetadataKeys.throttled:
      case ThreadMetadataKeys.queued:
        return TodoModel.getTriageGroupName(this.settings_, thread);

      default:
        return this.queryKey_();
    }
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
    container.className = 'center mt-half';
    this.append(container);

    this.select_ = document.createElement('select');
    for (let entry of Object.entries(FIRESTORE_KEYS_TO_HUMAN_READABLE_NAME)) {
      let option = document.createElement('option');
      option.append(entry[1]);
      option.value = entry[0];
      this.select_.append(option);
    }
    this.select_.addEventListener('change', () => this.render_());
  }

  async init() {
    await initialLogin();
    this.render_();
  }

  render_() {
    // If we're in view one mode, hide the back arrow since we're going back
    // to the threadlist, but with a new ThreadListView.
    this.appShell_.showBackArrow(false);

    let model = new HiddenModel(this.settings_, this.select_.selectedIndex);

    if (this.threadListView_) this.threadListView_.remove();
    // TODO: Make ThreadListView take a property back for all it's optional
    // arguments.
    this.threadListView_ = new ThreadListView(model, this.appShell_, this.settings_, false);
    this.append(this.threadListView_);

    this.appShell_.setToolbarSubject(this.select_);
  }

  async goBack() {
    await defined(this.threadListView_).goBack();
    this.appShell_.setToolbarSubject(this.select_);
  }

  async dispatchShortcut(e: KeyboardEvent) {
    return await defined(this.threadListView_).dispatchShortcut(e);
  }

  async takeAction(action: Action) {
    return await defined(this.threadListView_).takeAction(action);
  }
}
window.customElements.define('mt-hidden-view', HiddenView);
