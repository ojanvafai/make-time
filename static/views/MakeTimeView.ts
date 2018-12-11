import { AbstractThreadListView } from './AbstractThreadListView.js';
import { Actions } from '../Actions.js';
import { fetchThread } from '../main.js';
import { Labels } from '../Labels.js';

export class MakeTimeView extends AbstractThreadListView {
  private vacation_: string;

  static ACTIONS_ = [
    Actions.ARCHIVE_ACTION,
    Actions.BLOCKED_ACTION,
    Actions.MUTE_ACTION,
    Actions.MUST_DO_ACTION,
    Actions.URGENT_ACTION,
    Actions.NOT_URGENT_ACTION,
    Actions.DELEGATE_ACTION,
    Actions.UNDO_ACTION,
  ];

  static RENDER_ALL_ACTIONS_ = [
    Actions.PREVIOUS_EMAIL_ACTION,
    Actions.NEXT_EMAIL_ACTION,
    Actions.TOGGLE_FOCUSED_ACTION,
    Actions.VIEW_FOCUSED_ACTION,
  ].concat(MakeTimeView.ACTIONS_);

  static RENDER_ONE_ACTIONS_ = [
    Actions.QUICK_REPLY_ACTION,
    Actions.VIEW_TRIAGE_ACTION,
  ].concat(MakeTimeView.ACTIONS_);

  constructor(threads, mailProcessor, scrollContainer, allLabels, vacation, updateTitleDelegate, setSubject, showBackArrow, allowedReplyLength, contacts, autoStartTimer, timerDuration) {
    let countDown = false;
    super(threads, allLabels, mailProcessor, scrollContainer, updateTitleDelegate, setSubject, showBackArrow, allowedReplyLength, contacts, autoStartTimer, countDown, timerDuration);
    this.vacation_ = vacation;
    // TODO: Why doesn't TypeScript realize MakeTimeView is a AbstractThreadListView?
    (<AbstractThreadListView>this).appendButton('/triage', 'Back to Triaging');
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
    // Only threads with a priority should be added and
    // only show MUST_DO_LABEL when on vacation.
    if (priority && (!this.vacation_ || priority == Labels.MUST_DO_LABEL))
      super.addThread(thread);
  }

  async fetch(shouldBatch) {
    // TODO: Why doesn't TypeScript realize MakeTimeView is a AbstractThreadListView?
    (<AbstractThreadListView>this).updateTitle('fetch', ' ');

    // TODO: Why doesn't TypeScript realize MakeTimeView is a AbstractThreadListView?
    let labels = await (<AbstractThreadListView>this).allLabels.getThreadCountForLabels((label) => {
      return this.vacation_ ? label == Labels.MUST_DO_LABEL : Labels.isPriorityLabel(label);
    });
    let labelsToFetch = labels.filter(data => data.count).map(data => data.name);
    labelsToFetch.sort((a, b) => this.comparePriorities_(Labels.removePriorityPrefix(a), Labels.removePriorityPrefix(b)));

    // TODO: Why doesn't TypeScript realize MakeTimeView is a AbstractThreadListView?
    await (<AbstractThreadListView>this).fetchLabels(labelsToFetch, shouldBatch);
    // TODO: Why doesn't TypeScript realize MakeTimeView is a AbstractThreadListView?
    (<AbstractThreadListView>this).updateTitle('fetch');
  }

  async handleUndo(thread) {
    // TODO: Why doesn't TypeScript realize MakeTimeView is a AbstractThreadListView?
    if (thread)
      await (<AbstractThreadListView>this).removeThread(thread);
  }

  async handleTriaged(destination, triageResult, thread) {
    // Setting priority adds the thread back into the triaged list at it's new priority.
    if (!destination || !Labels.isPriorityLabel(destination))
      return;
    // Don't need to do a fetch if the markTriaged call didn't do anything.
    if (triageResult) {
      thread = await fetchThread(thread.id);
      // Store this away so undo can grab the right thread.
      triageResult.newThread = thread;
    }
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
