import {assert} from '../Base.js';
import {fetchThreads, getCachedThread} from '../BaseMain.js';
import {Labels} from '../Labels.js';
import {Thread} from '../Thread.js';
import {ThreadBase} from '../ThreadBase.js';
import {ThreadData} from '../ThreadData.js';

import {ThreadListModel} from './ThreadListModel.js';

let serializationKey = 'todo-view';

export class TodoModel extends ThreadListModel {
  private pendingThreads_: Thread[];
  private needsMessageDetailsThreads_: ThreadData[];

  constructor(private vacation_: string, labels: Labels) {
    super(labels, serializationKey);
    this.pendingThreads_ = [];
    this.needsMessageDetailsThreads_ = [];
  }

  async handleTriaged(destination: string, thread: Thread) {
    // Setting priority adds the thread back into the triaged list at it's new
    // priority.
    if (!destination || !Labels.isPriorityLabel(destination))
      return;
    await thread.update();
    await this.addThread(thread);
  }

  async addThread(thread: Thread) {
    let priority = await thread.getPriority();
    // Only threads with a priority should be added and
    // only show MUST_DO_LABEL when on vacation.
    if (priority && (!this.vacation_ || priority == Labels.MUST_DO_LABEL))
      await super.addThread(thread);
  }

  getGroupName(thread: Thread) {
    let priority = thread.getPrioritySync();
    if (priority)
      return Labels.removePriorityPrefix(priority);
    // This can happen when we rename or remove a priority from make-time.
    return Labels.MUST_DO;
  }

  protected compareThreads(a: Thread, b: Thread) {
    let aPriority = this.getGroupName(a);
    let bPriority = this.getGroupName(b);

    // Sort by priority, then by date.
    if (aPriority == bPriority)
      return this.compareDates(a, b);
    return this.comparePriorities_(aPriority, bPriority);
  }

  comparePriorities_(a: string, b: string) {
    let aOrder =
        Labels.SORTED_PRIORITIES.indexOf(Labels.removePriorityPrefix(a));
    let bOrder =
        Labels.SORTED_PRIORITIES.indexOf(Labels.removePriorityPrefix(b));
    return aOrder - bOrder;
  }

  protected async fetch() {
    let labelsToFetch = this.vacation_ ? [Labels.MUST_DO_LABEL] :
                                         this.labels.getPriorityLabelNames();

    // Fetch the list of threads, and then only populate the ones that are in
    // the disk storage so as to show the user an update as soon as possible.
    // Then process all the threads that need network of some sort one at a
    // time, showing the user an update after each of the network-bound threads
    // is processed.
    if (labelsToFetch.length) {
      let skipNetwork = true;
      await fetchThreads((thread: ThreadBase) => {
        if (thread instanceof Thread)
          this.pendingThreads_.push(thread);
        else if (thread instanceof ThreadData)
          this.needsMessageDetailsThreads_.push(thread);
        else
          assert(false);
      }, `in:${labelsToFetch.join(' OR in:')}`, skipNetwork);
    }

    this.setThreads(this.pendingThreads_);
    this.pendingThreads_ = [];

    let needsMessageDetailsThreads = this.needsMessageDetailsThreads_.concat();
    this.needsMessageDetailsThreads_ = [];
    await this.doFetches_(needsMessageDetailsThreads);
  }

  private async doFetches_(threads: ThreadData[]) {
    if (!threads.length)
      return;

    let progress = this.updateTitle(
        'TodoModel.doFetches_', threads.length, 'Updating thread list...');

    for (let i = 0; i < threads.length; i++) {
      progress.incrementProgress();
      let thread = await getCachedThread(threads[i]);
      assert(thread instanceof Thread);
      await this.addThread(<Thread>thread);
    }
  }
}
