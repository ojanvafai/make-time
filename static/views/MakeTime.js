class MakeTime extends AbstractVueue {
  constructor(threads, allLabels, updateTitleDelegate) {
    super(MakeTime.ACTIONS_, updateTitleDelegate);

    this.style.display = 'flex';
    this.style.flexDirection = 'column';

    this.threads_ = threads;
    this.allLabels_ = allLabels;
    this.updateTitle_ = updateTitleDelegate;

    this.addThreads_(threads);

    // TODO: Move this to a toolbar and make a real button that greys out when
    // there's no best effort threads.
    this.bestEffortButton_ = document.createElement('a');
    this.bestEffortButton_.className = 'label-button';
    this.bestEffortButton_.href = '/besteffort';
    this.append(this.bestEffortButton_);
    this.updateBestEffort_();
  }

  tearDown() {}

  async addThreads_() {
    for (let thread of this.threads_.getTriaged()) {
      this.addAndSort_(thread);
    }
  }

  async addAndSort_(thread) {
    await this.addThread(thread);
    this.sortGroups(this.comparePriorities_);
  }

  comparePriorities_(a, b) {
    let aOrder = MakeTime.PRIORITY_SORT_ORDER[a.queue];
    let bOrder = MakeTime.PRIORITY_SORT_ORDER[b.queue];
    return aOrder - bOrder;
  }

  async takeAction(action) {
    let rows = this.getThreads().selectedRows;
    // Update the UI first and then archive one at a time.
    let isSetPriority = action != Actions.DONE_ACTION;
    await this.queueTriageActions(rows, action.destination, false);
    await this.processQueuedActions();
  }

  async getDisplayableQueue(thread) {
    let priority = await thread.getPriority();
    if (priority)
      return Labels.removePriorityPrefix(priority);
    return MakeTime.UNPRIORITIZED;
  }

  async getQueue(thread) {
    return await thread.getPriority();
  }

  pushTriaged(thread) {
    this.addAndSort_(thread);
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
window.customElements.define('mt-make-time', MakeTime);

MakeTime.UNPRIORITIZED = 'Unpriortized';

MakeTime.PRIORITY_SORT_ORDER = {};
MakeTime.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.MUST_DO_LABEL)] = 0;
MakeTime.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.IMPORTANT_AND_URGENT_LABEL)] = 1;
MakeTime.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.URGENT_AND_NOT_IMPORTANT_LABEL)] = 2;
MakeTime.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.IMPORTANT_AND_NOT_URGENT_LABEL)] = 3;
MakeTime.PRIORITY_SORT_ORDER[MakeTime.UNPRIORITIZED] = 4;

MakeTime.ACTIONS_ = [
  Actions.DONE_ACTION,
];
