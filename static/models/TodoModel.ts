import {fetchThreads} from '../BaseMain.js';
import {Labels} from '../Labels.js';
import {Thread} from '../Thread.js';

import {ThreadListModel} from './ThreadListModel.js';

let serializationKey = 'todo-view';

export class TodoModel extends ThreadListModel {
  private pendingThreads_: Thread[];
  private needsMessageDetailsThreads_: Thread[];

  constructor(private vacation_: string, labels: Labels) {
    super(labels, serializationKey);
    this.pendingThreads_ = [];
    this.needsMessageDetailsThreads_ = [];
  }

  handleUndo(thread: Thread) {
    if (thread)
      this.removeThread(thread);
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
    this.updateTitle('fetch', ' ');

    let labels = await this.labels.getThreadCountForLabels((label: string) => {
      return this.vacation_ ? label == Labels.MUST_DO_LABEL :
                              Labels.isPriorityLabel(label);
    });
    let labelsToFetch =
        labels.filter(data => data.count).map(data => data.name);
    labelsToFetch.sort(this.comparePriorities_);

    // Fetch the list of threads, and then only populate the ones that are in
    // the disk storage so as to show the user an update as soon as possible.
    // Then process all the threads that need network of some sort one at a
    // time, showing the user an update after each of the network-bound threads
    // is processed.
    let hasPriorityLabel =
        labelsToFetch.length ? `in:${labelsToFetch.join(' OR in:')}` : '';
    let skipNetwork = true;
    await fetchThreads((thread: Thread) => {
      if (thread.hasMessageDetails)
        this.pendingThreads_.push(thread);
      else
        this.needsMessageDetailsThreads_.push(thread);
    }, hasPriorityLabel, skipNetwork);

    this.setThreads(this.pendingThreads_);
    this.pendingThreads_ = [];

    let needsMessageDetailsThreads = this.needsMessageDetailsThreads_.concat();
    this.needsMessageDetailsThreads_ = [];
    for (let thread of needsMessageDetailsThreads) {
      await thread.fetch();
      await this.addThread(thread);
    }

    this.updateTitle('fetch');
  }
}
