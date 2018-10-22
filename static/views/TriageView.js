class TriageView extends AbstractThreadListView {
  constructor(threads, allLabels, vacationSubject, queueSettings, updateTitleDelegate, setSubject, allowedReplyLength, contacts, autoStartTimer, timerDuration) {
    super(updateTitleDelegate, setSubject, allowedReplyLength, contacts, autoStartTimer, timerDuration, TriageView.ACTIONS_, TriageView.RENDER_ONE_ACTIONS_, TriageView.OVERFLOW_ACTIONS_);

    this.style.display = 'block';

    this.threads_ = threads;
    this.allLabels_ = allLabels;
    this.vacationSubject_ = vacationSubject;
    this.queueSettings_ = queueSettings;

    this.fetch_();
  }

  // TODO: Store the list of threads in localStorage and update asynchronously.
  async fetch_() {
    let labels = await this.allLabels_.getTheadCountForLabels((labelName) => labelName.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/'));
    let labelsToFetch = labels.filter(data => data.count).map(data => data.name);
    let queuesToFetch = getQueuedLabelMap().getSorted(labelsToFetch);

    let vacationQuery = '';
    if (this.vacationSubject_) {
      vacationQuery = `subject:${this.vacationSubject_}`;
      updateTitle('vacation', `Vacation ${vacationQuery}`);
    }

    // TODO: Don't use the global addThread.

    // Put first threads that are in the inbox with no make-time labels. That way they always show up before
    // daily/weekly/monthly bundles for folks that don't want to filter 100% of their mail with make-time.
    await fetchThreads(addThread, {
      query: `-(in:${this.allLabels_.getMakeTimeLabelNames().join(' OR in:')}) ${vacationQuery}`,
      queue: 'inbox',
    });

    for (let queueData of queuesToFetch) {
      await fetchThreads(addThread, {
        query: vacationQuery,
        queue: queueData[0],
      });
    }

    await this.handleNoThreadsLeft();
  }

  tearDown() {
    this.threads_.setNeedsTriage(this.getThreads().allThreads);
    super.tearDown();
  }

  pushNeedsTriage(thread) {
    this.addThread(thread);
  }

  async handleTriageAction(action) {
    await this.markTriaged(action.destination);
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

  async handleNoThreadsLeft() {
    if (!this.rowGroupCount())
      await router.run('/make-time');
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
