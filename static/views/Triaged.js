class Triaged extends AbstractVueue {
  constructor(allLabels, vacation, threads, bestEffortCount, bestEffortCallback, updateTitleDelegate) {
    super(Triaged.ACTIONS_, updateTitleDelegate);
    this.allLabels_ = allLabels;
    this.bestEffortCount_ = bestEffortCount;
    this.updateTitle_ = updateTitleDelegate;

    // TODO: Handle these two.
    this.vacation_ = vacation;
    this.needsTriageThreads_ = threads;

    this.groupByQueue_ = {};
    this.queuedTriageActions_ = [];

    this.fetch_();

    // TODO: Move this to a toolbar and make a real button that greys out when there's no best effort threads.
    this.bestEffortButton_ = document.createElement('a');
    this.bestEffortButton_.className = 'label-button';
    this.bestEffortButton_.onclick = bestEffortCallback;
    this.append(this.bestEffortButton_);
    this.updateBestEffort_();

    let footer = document.createElement('div');
    footer.className = 'footer';
    this.actions_ = new Actions(this, Triaged.ACTIONS_);
    footer.append(this.actions_);
    this.append(footer);
  }

  tearDown() {
    return this.needsTriageThreads_;
  }

  async takeAction(action) {
    await this.markTriaged_(action.destination);
  }

  async push(thread) {
    this.needsTriageThreads_.push(thread);
    // TODO: Update the UI.
  }

  async fetch_() {
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

  async markTriaged_(destination) {
    // Update the UI first and then archive one at a time.
    await this.queueTriageActions(this.getThreads().selectedRows, destination);
    await this.processQueuedActions();
  }

  updateBestEffort_() {
    if (this.bestEffortCount_) {
      this.bestEffortButton_.textContent = `Triage ${this.bestEffortCount_} best effort threads`;
      this.bestEffortButton_.style.display = '';
    } else {
      this.bestEffortButton_.style.display = 'none';
    }
  }

  // TODO: Just pass in the count instead of the array.
  setBestEffortCount(bestEffortCount) {
    this.bestEffortCount_ = bestEffortCount;
    this.updateBestEffort_();
  }
}
window.customElements.define('mt-triaged', Triaged);

Triaged.ACTIONS_ = [
  Actions.DONE_ACTION,
];
