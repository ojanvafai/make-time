import { AbstractThreadListView } from './AbstractThreadListView.js';
import { Actions } from '../Actions.js';
import { addThread, fetchThreads } from '../main.js';
import { Labels } from '../Labels.js';

export class TriageView extends AbstractThreadListView {
  constructor(threads, mailProcessor, scrollContainer, allLabels, vacationSubject, updateTitleDelegate, setSubject, showBackArrow, allowedReplyLength, contacts, autoStartTimer, timerDuration, queueSettings) {
    let countDown = true;
    super(threads, scrollContainer, updateTitleDelegate, setSubject, showBackArrow, allowedReplyLength, contacts, autoStartTimer, countDown, timerDuration, TriageView.ACTIONS_, TriageView.RENDER_ONE_ACTIONS_, TriageView.OVERFLOW_ACTIONS_);

    this.mailProcessor_ = mailProcessor;
    this.allLabels_ = allLabels;
    this.vacationSubject_ = vacationSubject;
    this.queueSettings_ = queueSettings;

    this.fetch_();
    this.appendButton_('/make-time', `It's make-time!`);
  }

  // TODO: Store the list of threads in localStorage and update asynchronously.
  async fetch_() {
    let labels = await this.allLabels_.getTheadCountForLabels(Labels.isNeedsTriageLabel);
    let labelsToFetch = labels.filter(data => data.count).map(data => data.name);
    let queuesToFetch = this.queueSettings_.getSorted(labelsToFetch);

    let vacationQuery = '';
    if (this.vacationSubject_) {
      vacationQuery = `subject:${this.vacationSubject_}`;
      updateTitle('vacation', `Vacation ${vacationQuery}`);
    }

    this.clearBestEffort();

    let baseQuery = `newer_than:1m ${vacationQuery}`;

    // Put threads that are in the inbox with no make-time labels first. That way they always show up before
    // daily/weekly/monthly bundles for folks that don't want to filter 100% of their mail with make-time.
    await fetchThreads(this.processThread.bind(this), {
      query: `${baseQuery} -(in:${this.allLabels_.getMakeTimeLabelNames().join(' OR in:')})`,
      queue: 'inbox',
    });

    for (let queueData of queuesToFetch) {
      await fetchThreads(this.processThread.bind(this), {
        query: baseQuery,
        queue: queueData[0],
      });
    }
  }

  async processThread(thread) {
    let processedId = await this.allLabels_.getId(Labels.PROCESSED_LABEL);
    let messages = await thread.getMessages();
    let lastMessage = messages[messages.length - 1];
    if (!lastMessage.getLabelIds().includes(processedId)) {
      await this.mailProcessor_.processThread(thread);
    } else {
      // TODO: Don't use the global addThread.
      await addThread(thread);
    }
  }

  compareRowGroups(a, b) {
    return this.queueSettings_.queueNameComparator(a.queue, b.queue);
  }

  async getDisplayableQueue(thread) {
    return await thread.getDisplayableQueue();
  }

  async getQueue(thread) {
    return thread.getQueue();
  }
}
window.customElements.define('mt-triage-view', TriageView);

TriageView.ACTIONS_ = [
  Actions.ARCHIVE_ACTION,
  Actions.BLOCKED_ACTION,
  Actions.MUTE_ACTION,
  Actions.MUST_DO_ACTION,
  Actions.URGENT_ACTION,
  Actions.NOT_URGENT_ACTION,
  Actions.DELEGATE_ACTION,
  Actions.UNDO_ACTION,
];

TriageView.RENDER_ONE_ACTIONS_ = [Actions.QUICK_REPLY_ACTION].concat(TriageView.ACTIONS_);

TriageView.OVERFLOW_ACTIONS_ = [
  Actions.SPAM_ACTION,
];
