import { AbstractThreadListView } from './AbstractThreadListView.js';
import { Actions } from '../Actions.js';
import { fetchThread, fetchThreads } from '../main.js';
import { Labels } from '../Labels.js';

export class MakeTimeView extends AbstractThreadListView {
  constructor(threads, mailProcessor, scrollContainer, allLabels, vacation, updateTitleDelegate, setSubject, showBackArrow, allowedReplyLength, contacts, autoStartTimer, timerDuration) {
    let countDown = false;
    super(threads, mailProcessor, scrollContainer, updateTitleDelegate, setSubject, showBackArrow, allowedReplyLength, contacts, autoStartTimer, countDown, timerDuration, MakeTimeView.ACTIONS_, MakeTimeView.RENDER_ONE_ACTIONS_);

    this.allLabels_ = allLabels;
    this.updateTitle_ = updateTitleDelegate;

    this.fetch(this.processThread.bind(this));
    this.appendButton_('/triage', 'Back to Triaging');
  }

  compareRowGroups(a, b) {
    return this.comparePriorities_(a.queue, b.queue);
  }

  comparePriorities_(a, b) {
    let aOrder = Labels.SORTED_PRIORITIES.indexOf(a);
    let bOrder = Labels.SORTED_PRIORITIES.indexOf(b);
    return aOrder - bOrder;
  }

  async addThread(thread) {
    let priority = await thread.getPriority();
    // Only threads with a priority should be added.
    if (priority)
      super.addThread(thread);
  }

  async fetch(forEachThread) {
    let labels = await this.allLabels_.getTheadCountForLabels(Labels.isPriorityLabel);
    let labelsToFetch = labels.filter(data => data.count).map(data => data.name);
    labelsToFetch.sort((a, b) => this.comparePriorities_(Labels.removePriorityPrefix(a), Labels.removePriorityPrefix(b)));

    // TODO: Sort labelsToFetch so higher priority labesl are fetched first.
    for (let label of labelsToFetch) {
      this.currentGroup_ = label;
      await fetchThreads(forEachThread, {
        query: `in:${label}`,
        includeTriaged: true,
      });
    }

    // Fetch latent unprioritized actionitem threads.
    // TODO: Remove this once we've fully removed actionitem as a concept.
    await fetchThreads(forEachThread, {
      query: `in:${Labels.ACTION_ITEM_LABEL} -(in:${this.allLabels_.getPriorityLabelNames().join(' OR in:')})`,
      includeTriaged: true,
    });
  }

  async handleTriaged(destination, triageResult, thread) {
    // Setting priority adds the thread back into the triaged list at it's new priority.
    if (!destination || !Labels.isPriorityLabel(destination))
      return;
    // Don't need to do a fetch if the markTriaged call didn't do anything.
    if (triageResult)
      thread = await fetchThread(thread.id);
    await this.addThread(thread);
  }

  async getDisplayableQueue(thread) {
    let priority = await thread.getPriority();
    if (priority)
      return Labels.removePriorityPrefix(priority);
    return Labels.MUST_DO_LABEL;
  }

  async getQueue(thread) {
    return await thread.getPriority();
  }
}
window.customElements.define('mt-make-time-view', MakeTimeView);

MakeTimeView.ACTIONS_ = [
  Actions.ARCHIVE_ACTION,
  Actions.BLOCKED_ACTION,
  Actions.MUTE_ACTION,
  Actions.MUST_DO_ACTION,
  Actions.URGENT_ACTION,
  Actions.NOT_URGENT_ACTION,
  Actions.DELEGATE_ACTION,
];

MakeTimeView.RENDER_ONE_ACTIONS_ = [Actions.QUICK_REPLY_ACTION].concat(MakeTimeView.ACTIONS_);
