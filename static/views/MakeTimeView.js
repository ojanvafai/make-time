class MakeTimeView extends AbstractThreadListView {
  constructor(threads, allLabels, vacation, updateTitleDelegate, setSubject, allowedReplyLength, contacts, autoStartTimer, timerDuration) {
    let countDown = false;
    super(threads, updateTitleDelegate, setSubject, allowedReplyLength, contacts, autoStartTimer, countDown, timerDuration, MakeTimeView.ACTIONS_, MakeTimeView.RENDER_ONE_ACTIONS_);

    this.style.display = 'flex';
    this.style.flexDirection = 'column';

    this.allLabels_ = allLabels;
    this.updateTitle_ = updateTitleDelegate;

    this.fetch_();
    this.appendButton_('/triage', 'Back to Triaging');
  }

  compareRowGroups(a, b) {
    let aOrder = MakeTimeView.PRIORITY_SORT_ORDER[a.queue];
    let bOrder = MakeTimeView.PRIORITY_SORT_ORDER[b.queue];
    return aOrder - bOrder;
  }

  async fetch_() {
    let labels = await this.allLabels_.getTheadCountForLabels(Labels.isPriorityLabel);
    let labelsToFetch = labels.filter(data => data.count).map(data => data.name);

    // TODO: Sort labelsToFetch so higher priority labesl are fetched first.
    for (let label of labelsToFetch) {
      this.currentGroup_ = label;
      await fetchThreads(this.addThread.bind(this), {
        query: `in:${label}`,
        includeTriaged: true,
      });
    }

    // Fetch latent unprioritized actionitem threads.
    // TODO: Remove this once we've fully removed actionitem as a concept.
    await fetchThreads(this.addThread.bind(this), {
      query: `in:${Labels.ACTION_ITEM_LABEL} -(in:${labels_.getPriorityLabelNames().join(' OR in:')})`,
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
  Actions.MUST_DO_ACTION,
  Actions.URGENT_ACTION,
  Actions.NOT_URGENT_ACTION,
  Actions.DELEGATE_ACTION,
];

MakeTimeView.RENDER_ONE_ACTIONS_ = [Actions.QUICK_REPLY_ACTION].concat(MakeTimeView.ACTIONS_);

MakeTimeView.PRIORITY_SORT_ORDER = {};
MakeTimeView.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.MUST_DO_LABEL)] = 1;
MakeTimeView.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.URGENT_LABEL)] = 2;
MakeTimeView.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.NOT_URGENT_LABEL)] = 3;
MakeTimeView.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.DELEGATE_LABEL)] = 4;
