import { AbstractThreadListView } from './AbstractThreadListView.js';
import { Actions } from '../Actions.js';
import { fetchThreads } from '../main.js';
import { Labels } from '../Labels.js';

export class TriageView extends AbstractThreadListView {
  constructor(threads, mailProcessor, scrollContainer, allLabels, vacationSubject, updateTitleDelegate, setSubject, showBackArrow, allowedReplyLength, contacts, autoStartTimer, timerDuration, queueSettings) {
    let countDown = true;
    super(threads, mailProcessor, scrollContainer, updateTitleDelegate, setSubject, showBackArrow, allowedReplyLength, contacts, autoStartTimer, countDown, timerDuration, TriageView.OVERFLOW_ACTIONS_);

    this.allLabels_ = allLabels;
    this.vacationSubject_ = vacationSubject;
    this.queueSettings_ = queueSettings;

    this.appendButton_('/make-time', `It's make-time!`);
  }

  async addThread(thread) {
    let priority = await thread.getPriority();
    // Threads with a priority have already been triaged, so don't add them.
    if (priority)
      return;

    // Threads that have triage labels but aren't in the inbox were archived outside
    // of maketime and should have their triage labels removed.
    if (!thread.isInInbox()) {
      await thread.markTriaged(null);
      return;
    }

    super.addThread(thread);
  }

  // TODO: Store the list of threads in localStorage and update asynchronously.
  async fetch(shouldBatch) {
    this.updateTitle_('fetch', ' ');

    let labels = await this.allLabels_.getThreadCountForLabels(Labels.isNeedsTriageLabel);
    let labelsToFetch = labels.filter(data => data.count).map(data => data.name);
    labelsToFetch = this.queueSettings_.getSorted(labelsToFetch).map((item) => item[0]);

    let vacationQuery = '';
    if (this.vacationSubject_) {
      vacationQuery = `subject:${this.vacationSubject_}`;
      updateTitle('vacation', `Vacation ${vacationQuery}`);
    }

    this.clearBestEffort();

    let makeTimeLabels = this.allLabels_.getMakeTimeLabelNames().filter((item) => item != Labels.PROCESSED_LABEL);

    // Put threads that are in the inbox with no make-time labels first. That way they always show up before
    // daily/weekly/monthly bundles for folks that don't want to filter 100% of their mail with make-time.
    await fetchThreads(this.processThread.bind(this), {
      query: `${vacationQuery} in:inbox -(in:${makeTimeLabels.join(' OR in:')})`,
    });

    await this.fetchLabels(vacationQuery, labelsToFetch, shouldBatch);
    this.updateTitle_('fetch');
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

TriageView.OVERFLOW_ACTIONS_ = [
  Actions.SPAM_ACTION,
];
