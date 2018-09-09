class Triaged extends AbstractVueue {
  constructor(threads, allLabels, vacation, updateTitleDelegate) {
    super(Triaged.ACTIONS_, updateTitleDelegate);

    this.style.display = 'flex';
    this.style.flexDirection = 'column';

    this.threads_ = threads;
    this.allLabels_ = allLabels;
    this.updateTitle_ = updateTitleDelegate;

    // TODO: Only show vacation threads when in vacation mode.
    this.vacation_ = vacation;

    this.fetch_();

    // TODO: Move this to a toolbar and make a real button that greys out when
    // there's no best effort threads.
    this.bestEffortButton_ = document.createElement('a');
    this.bestEffortButton_.className = 'label-button';
    this.bestEffortButton_.href = '/besteffort';
    this.append(this.bestEffortButton_);
    this.updateBestEffort_();
  }

  tearDown() {
    this.tearDown_ = true;
  }

  selectRow_(row) {
    row.checked = true;
    row.scrollIntoView({block: "center", behavior: "smooth"});
  }

  async takeAction(action) {
    let rows = this.getThreads().selectedRows;
    if (!rows.length)
      return;

    let lastRow = rows[rows.length - 1];
    let nextRow = this.getNextRow(lastRow);
    if (nextRow)
      this.selectRow_(nextRow);

    // Update the UI first and then archive one at a time.
    let isSetPriority = action != Actions.DONE_ACTION;
    await this.queueTriageActions(rows, action.destination, isSetPriority);
    await this.processQueuedActions();
  }

  async addTriagedThread_(thread) {
    this.threads_.pushTriaged(thread);

    // Make sure to add all the threads even after teardown so that all the threads
    // show up in the MakeTime view.
    // TODO: Extract out the thread fetching so that both Triaged and MakeTime can fetch
    // the threads without restarting the process if it's already in progress.
    if (this.tearDown_)
      return;

    let row = await this.addThread(thread);
    await row.showPriority();

    if (this.threads_.getTriaged().length == 1)
      this.selectRow_(row);
  }

  async fetch_() {
    this.threads_.setTriaged([]);

    let labels = await this.allLabels_.getTheadCountForLabels((labelName) => {
      return labelName != Labels.MUTED_LABEL && labelName.startsWith(Labels.TRIAGED_LABEL + '/');
    });
    let labelsToFetch = labels.filter(data => data.count).map(data => data.name);

    for (let label of labelsToFetch) {
      this.currentGroup_ = label;
      await fetchThreads(this.addTriagedThread_.bind(this), {
        query: `in:${label}`,
        includeTriaged: true,
      });
    }
  }

  async getDisplayableQueue(thread) {
    return await thread.getDisplayableTriagedQueue();
  }

  async getQueue(thread) {
    return await thread.getTriagedQueue();
  }

  pushBestEffort(thread) {
    this.updateBestEffort_();
  }

  updateBestEffort_() {
    let bestEffort = this.threads_.getBestEffort();
    if (bestEffort && bestEffort.length) {
      this.bestEffortButton_.textContent = `Triage ${bestEffort.length} best effort threads`;
      this.bestEffortButton_.style.display = '';
    } else {
      this.bestEffortButton_.style.display = 'none';
    }
  }
}
window.customElements.define('mt-triaged', Triaged);

Triaged.ACTIONS_ = [
  Actions.MUST_DO_ACTION,
  Actions.IMPORTANT_AND_URGENT_ACTION,
  Actions.URGENT_AND_NOT_IMPORTANT_ACTION,
  Actions.IMPORTANT_AND_NOT_URGENT_ACTION,
  Actions.DONE_ACTION,
];
