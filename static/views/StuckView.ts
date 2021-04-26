import { Action } from '../Actions.js';
import { compareDates, defined, notNull } from '../Base.js';
import { firestoreUserCollection, login } from '../BaseMain.js';
import { ThreadListModel } from '../models/ThreadListModel.js';
import { Settings } from '../Settings.js';
import { STUCK_LABEL_NAME, Thread, ThreadMetadataKeys } from '../Thread.js';

import { AppShell } from './AppShell.js';
import { ThreadListView } from './ThreadListView.js';
import { View } from './View.js';

class StuckModel extends ThreadListModel {
  constructor(settings_: Settings) {
    super(settings_);

    let metadataCollection = firestoreUserCollection().doc('threads').collection('metadata');
    const query = metadataCollection.orderBy(ThreadMetadataKeys.blocked, 'asc');
    this.setQueries(query);
  }

  compareThreads(a: Thread, b: Thread) {
    // Reverse sort by blocked date.
    return compareDates(notNull(b.getStuckDate()), notNull(a.getStuckDate()));
  }

  protected shouldShowThread(thread: Thread) {
    return !thread.needsTriage() && super.shouldShowThread(thread);
  }

  getGroupName(_thread: Thread) {
    return STUCK_LABEL_NAME;
  }
}

export class StuckView extends View {
  private threadListView_?: ThreadListView;

  constructor(private appShell_: AppShell, private settings_: Settings) {
    super();

    let container = document.createElement('div');
    container.className = 'center mt-half';
    this.append(container);
  }

  async init() {
    await login();
    this.render_();
  }

  render_() {
    // If we're in view one mode, hide the back arrow since we're going back
    // to the threadlist, but with a new ThreadListView.
    this.appShell_.showBackArrow(false);

    let model = new StuckModel(this.settings_);
    this.threadListView_ = new ThreadListView(model, this.appShell_, this.settings_, false);
    this.append(this.threadListView_);
  }

  async goBack() {
    await defined(this.threadListView_).goBack();
  }

  async dispatchShortcut(e: KeyboardEvent) {
    return await defined(this.threadListView_).dispatchShortcut(e);
  }

  async takeAction(action: Action) {
    return await defined(this.threadListView_).takeAction(action);
  }
}
window.customElements.define('mt-stuck-view', StuckView);
