import {assert} from '../Base.js';
import {fetchThreads} from '../BaseMain.js';
import {Labels} from '../Labels.js';
import {Thread} from '../Thread.js';
import {ThreadFetcher} from '../ThreadFetcher.js';

import {ThreadListModel} from './ThreadListModel.js';

let serializationKey = 'todo-view';

export class TodoModel extends ThreadListModel {
  private pendingThreads_: Thread[];
  private needsFetchThreads_: ThreadFetcher[];

  constructor(private vacation_: string, labels: Labels) {
    super(labels, serializationKey);
    this.pendingThreads_ = [];
    this.needsFetchThreads_ = [];
  }

  async handleTriaged(destination: string, thread: Thread) {
    // Setting priority adds the thread back into the triaged list at it's new
    // priority.
    if (!destination || !Labels.isPriorityLabel(destination))
      return;
    await thread.update();
    await this.addThread(thread);
  }

  shouldShowThread(thread: Thread) {
    let priority = thread.getPriority();
    // Only threads with a priority should be added and only show MUST_DO_LABEL
    // when on vacation.
    return !!(
        priority && (!this.vacation_ || priority == Labels.MUST_DO_LABEL));
  }

  getGroupName(thread: Thread) {
    let priority = thread.getPriority();
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
      await fetchThreads(async (fetcher: ThreadFetcher) => {
        let thread = await fetcher.fetch(skipNetwork);
        if (thread !== null)
          this.pendingThreads_.push(thread);
        else
          this.needsFetchThreads_.push(fetcher);
      }, `in:${labelsToFetch.join(' OR in:')}`);
    }

    this.setThreads(this.pendingThreads_);
    this.pendingThreads_ = [];

    let needsFetchThreads = this.needsFetchThreads_.concat();
    this.needsFetchThreads_ = [];
    await this.doFetches_(needsFetchThreads);
  }

  private async doFetches_(threads: ThreadFetcher[]) {
    if (!threads.length)
      return;

    let progress = this.updateTitle(
        'TodoModel.doFetches_', threads.length, 'Updating thread list...');

    for (let i = 0; i < threads.length; i++) {
      progress.incrementProgress();
      let thread = await threads[i].fetch();
      assert(thread instanceof Thread);
      await this.addThread(<Thread>thread);
    }
  }
}
