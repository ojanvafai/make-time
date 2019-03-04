import {Action} from '../Actions.js';
import {defined} from '../Base.js';
import {login} from '../BaseMain.js';
import {ThreadListModel} from '../models/ThreadListModel.js';
import {Settings} from '../Settings.js';
import {Thread} from '../Thread.js';

import {AppShell} from './AppShell.js';
import {ThreadListView} from './ThreadListView.js';
import {View} from './View.js';

let FIRESTORE_KEYS = ['muted', 'blocked', 'queued'];

class HiddenModel extends ThreadListModel {
  constructor(private keyIndex_: number) {
    // For muted, don't put undo items back in the inbox.
    super(FIRESTORE_KEYS[keyIndex_], true, keyIndex_ === 0);
  }

  defaultCollapsedState(_groupName: string) {
    return false;
  }

  compareThreads(a: Thread, b: Thread) {
    return this.compareDates(a, b);
  }

  getGroupName(_thread: Thread) {
    return FIRESTORE_KEYS[this.keyIndex_];
  }

  // There's no priorities to show, but when in queued, we want the label to
  // show the group so you can see which group it's queued into.
  showPriorityLabel() {
    return false;
  }
}

export class HiddenView extends View {
  private threadListView_?: ThreadListView;
  private select_: HTMLSelectElement;

  constructor(private appShell_: AppShell, private settings_: Settings) {
    super();

    let container = document.createElement('div');
    this.append(container);

    this.select_ = document.createElement('select');
    for (let key of FIRESTORE_KEYS) {
      let option = document.createElement('option');
      option.append(key);
      this.select_.append(option);
    }
    this.select_.addEventListener('change', () => this.handleSelectChange_());

    container.append('Show: ', this.select_);
  }

  async init() {
    await login();
    this.render_();
  }

  render_() {
    let model = new HiddenModel(this.select_.selectedIndex);
    if (this.threadListView_)
      this.threadListView_.remove();
    this.threadListView_ =
        new ThreadListView(model, this.appShell_, this.settings_);
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
