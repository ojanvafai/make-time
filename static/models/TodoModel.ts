import {Labels} from '../Labels.js';
import {Thread} from '../Thread.js';

import {PlainThreadData, ThreadListModel} from './ThreadListModel.js';

let serializationKey = 'todo-view';

export class TodoModel extends ThreadListModel {
  constructor(updateTitle: any, private vacation_: string, labels: Labels) {
    super(updateTitle, labels, serializationKey);
  }

  async handleUndo(thread: Thread) {
    if (thread)
      await this.removeThread(thread);
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
      super.addThread(thread);
  }

  async getDisplayableQueue(thread: Thread) {
    let priority = await thread.getPriority();
    if (priority)
      return Labels.removePriorityPrefix(priority);
    return Labels.MUST_DO_LABEL;
  }

  compareRowGroups(a: any, b: any) {
    return this.comparePriorities_(a.queue, b.queue);
  }

  comparePriorities_(a: any, b: any) {
    let aOrder = Labels.SORTED_PRIORITIES.indexOf(a);
    let bOrder = Labels.SORTED_PRIORITIES.indexOf(b);
    return aOrder - bOrder;
  }

  async fetch() {
    this.updateTitle('fetch', ' ');

    let labels = await this.labels.getThreadCountForLabels((label: string) => {
      return this.vacation_ ? label == Labels.MUST_DO_LABEL :
                              Labels.isPriorityLabel(label);
    });
    let labelsToFetch =
        labels.filter(data => data.count).map(data => data.name);
    labelsToFetch.sort(
        (a, b) => this.comparePriorities_(
            Labels.removePriorityPrefix(a), Labels.removePriorityPrefix(b)));

    let threadsToSerialize: PlainThreadData[] = [];
    let processThread = (thread: Thread) => {
      threadsToSerialize.push(new PlainThreadData(thread.id, thread.historyId));
      this.addThread(thread);
    };

    await this.fetchLabels(processThread, labelsToFetch);
    await this.serializeThreads(threadsToSerialize);

    this.updateTitle('fetch');
  }
}
