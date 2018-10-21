class Triaged extends AbstractVueue {
  constructor(threads, allLabels, vacation, updateTitleDelegate, setSubject, allowedReplyLength, contacts, autoStartTimer, timerDuration) {
    super(updateTitleDelegate, setSubject, allowedReplyLength, contacts, autoStartTimer, timerDuration, Triaged.ACTIONS_, Triaged.RENDER_ONE_ACTIONS_);

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

  async handleTriageAction(action) {
    let isSetPriority = action != Actions.ARCHIVE_ACTION;
    await this.markTriaged(action.destination, isSetPriority);
  }

  compareRowGroups(a, b) {
    let aOrder = Triaged.PRIORITY_SORT_ORDER[a.queue];
    let bOrder = Triaged.PRIORITY_SORT_ORDER[b.queue];
    return aOrder - bOrder;
  }

  async fetch_() {
    let labels = await this.allLabels_.getTheadCountForLabels((labelName) => {
      return labelName.startsWith(Labels.PRIORITY_LABEL + '/');
    });
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
  Actions.ARCHIVE_ACTION,
  Actions.MUST_DO_ACTION,
  Actions.URGENT_ACTION,
  Actions.NOT_URGENT_ACTION,
  Actions.DELEGATE_ACTION,
];

Triaged.RENDER_ONE_ACTIONS_ = [Actions.QUICK_REPLY_ACTION].concat(Triaged.ACTIONS_);

Triaged.UNPRIORITIZED = 'Unpriortized';

Triaged.PRIORITY_SORT_ORDER = {};
Triaged.PRIORITY_SORT_ORDER[Triaged.UNPRIORITIZED] = 0;
Triaged.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.MUST_DO_LABEL)] = 1;
Triaged.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.URGENT_LABEL)] = 2;
Triaged.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.NOT_URGENT_LABEL)] = 3;
Triaged.PRIORITY_SORT_ORDER[Labels.removePriorityPrefix(Labels.DELEGATE_LABEL)] = 4;

