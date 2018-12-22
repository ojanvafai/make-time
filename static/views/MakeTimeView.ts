import { AbstractThreadListView } from './AbstractThreadListView.js';
import { Labels } from '../Labels.js';
import { ThreadGroups } from '../ThreadGroups.js';
import { MailProcessor } from '../MailProcessor.js';
import { Thread } from '../Thread.js';

export class MakeTimeView extends AbstractThreadListView {
  private vacation_: string;

  constructor(threads: ThreadGroups, mailProcessor: MailProcessor, scrollContainer: HTMLElement, allLabels: Labels, vacation: string, updateTitleDelegate: any, setSubject: any, showBackArrow: any, allowedReplyLength: number, contacts: any, autoStartTimer: boolean, timerDuration: number) {
    let countDown = false;
    super(threads, allLabels, mailProcessor, scrollContainer, updateTitleDelegate, setSubject, showBackArrow, allowedReplyLength, contacts, autoStartTimer, countDown, timerDuration);
    this.vacation_ = vacation;
    this.appendButton('/triage', 'Back to Triaging');
  }

  compareRowGroups(a: any, b: any) {
    return this.comparePriorities_(a.queue, b.queue);
  }

  comparePriorities_(a: any, b: any) {
    let aOrder = Labels.SORTED_PRIORITIES.indexOf(a);
    let bOrder = Labels.SORTED_PRIORITIES.indexOf(b);
    return aOrder - bOrder;
  }

  async addThread(thread: Thread) {
    let priority = await thread.getPriority();
    // Only threads with a priority should be added and
    // only show MUST_DO_LABEL when on vacation.
    if (priority && (!this.vacation_ || priority == Labels.MUST_DO_LABEL))
      super.addThread(thread);
  }

  async fetch(shouldBatch?: boolean) {
    this.updateTitle('fetch', ' ');

    let labels = await this.allLabels.getThreadCountForLabels((label: string) => {
      return this.vacation_ ? label == Labels.MUST_DO_LABEL : Labels.isPriorityLabel(label);
    });
    let labelsToFetch = labels.filter(data => data.count).map(data => data.name);
    labelsToFetch.sort((a, b) => this.comparePriorities_(Labels.removePriorityPrefix(a), Labels.removePriorityPrefix(b)));

    await this.fetchLabels(labelsToFetch, shouldBatch);
    this.updateTitle('fetch');
  }

  async handleUndo(thread: Thread) {
    if (thread)
      await this.removeThread(thread);
  }

  async handleTriaged(destination: string, thread: Thread) {
    // Setting priority adds the thread back into the triaged list at it's new priority.
    if (!destination || !Labels.isPriorityLabel(destination))
      return;
    await thread.update();
    await this.addThread(thread);
  }

  async getDisplayableQueue(thread: Thread) {
    let priority = await thread.getPriority();
    if (priority)
      return Labels.removePriorityPrefix(priority);
    return Labels.MUST_DO_LABEL;
  }

  async getQueue(thread: Thread) {
    return await thread.getPriority();
  }
}
window.customElements.define('mt-make-time-view', MakeTimeView);
