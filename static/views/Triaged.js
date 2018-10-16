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
    this.threads_.setTriaged(this.getThreads().allThreads);
    this.tearDown_ = true;
  }

  selectRow_(row) {
    row.checked = true;
    row.scrollIntoView({block: "center", behavior: "smooth"});
  }

  async takeAction(action) {
    if (action == Actions.DONE_ACTION) {
      await router.run('/maketime');
      return;
    }

    let rows = this.getThreads().selectedRows;
    if (!rows.length)
      return;

    let lastRow = rows[rows.length - 1];
    let nextRow = this.getNextRow(lastRow);
    if (nextRow) {
      let priority = await nextRow.thread.getPriority();
      if (!priority)
        this.selectRow_(nextRow);
    }

    // Update the UI first and then archive one at a time.
    let isSetPriority = action != Actions.ARCHIVE_ACTION;
    await this.queueTriageActions(rows, action.destination, isSetPriority);
    await this.processQueuedActions();
  }

  async addThreads_() {
    for (let thread of this.threads_.getTriaged()) {
      this.addAndSort_(thread);
    }
  }

  compareRowGroups(a, b) {
    let aOrder = Triaged.PRIORITY_SORT_ORDER[a.queue];
    let bOrder = Triaged.PRIORITY_SORT_ORDER[b.queue];
    return aOrder - bOrder;
  }

  async addThread(thread) {
    this.threads_.pushTriaged(thread);

    // Make sure to add all the threads even after teardown so that all the threads
    // show up in the MakeTime view.
    // TODO: Extract out the thread fetching so that both Triaged and MakeTime can fetch
    // the threads without restarting the process if it's already in progress.
    if (this.tearDown_)
      return;

    let row = await super.addThread(thread, Triaged.UNPRIORITIZED);

    // TODO: Don't reach into implementation details of the parent class by crawling
    // through parentNode in the DOM.
    if (row.parentNode.children.length == 1 && !(await thread.getPriority())) {
      // Can't just call selectRow_ here because the scrollIntoView call closes the drawer
      // if it's open. crbug.com/884518.
      row.checked = true;
    }
  }

  async fetch_() {
    this.threads_.setTriaged([]);

    let labels = await this.allLabels_.getTheadCountForLabels((labelName) => {
      return labelName.startsWith(Labels.PRIORITY_LABEL + '/');
    });
    let labelsToFetch = labels.filter(data => data.count).map(data => data.name);

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

  async getDisplayableQueue(thread) {
    let priority = await thread.getPriority();
    if (priority)
      return Labels.removePriorityPrefix(priority);
    return Triaged.UNPRIORITIZED;
  }

  async getQueue(thread) {
    return await thread.getPriority();
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
  Actions.URGENT_ACTION,
  Actions.NOT_URGENT_ACTION,
  Actions.DELEGATE_ACTION,
  Actions.ARCHIVE_ACTION,
  Actions.DONE_ACTION,
];

Triaged.UNPRIORITIZED = 'Unpriortized';

Triaged.PRIORITY_SORT_ORDER = {};
Triaged.PRIORITY_SORT_ORDER[Triaged.UNPRIORITIZED] = 0;
Triaged.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.MUST_DO_LABEL)] = 1;
Triaged.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.URGENT_LABEL)] = 2;
Triaged.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.NOT_URGENT_LABEL)] = 3;
Triaged.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.DELEGATE_LABEL)] = 4;

