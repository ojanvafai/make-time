class ViewAll extends AbstractVueue {
  constructor(threads, updateTitleDelegate) {
    super(ViewAll.ACTIONS_, updateTitleDelegate);
    this.style.display = 'block';
    this.threads_ = threads;
  }

  async finishedInitialLoad() {
    if (!this.rowGroupCount())
      await router.run('/triaged');
  }

  async connectedCallback() {
    for (let thread of this.threads_) {
      await this.push(thread);
    }
  }

  async tearDown() {
    this.isTearingDown_ = true;
    // Intentionally don't await this so we show the new view without waiting for the
    // threads to all be triaged.
    this.markTriaged_(Actions.BEGIN_TRIAGE_ACTION.destination);
    return this.getThreads().unselectedThreads;
  }

  async takeAction(action) {
    if (action == Actions.BEGIN_TRIAGE_ACTION) {
      await router.run('/viewone');
      return;
    }
    await this.markTriaged_(action.destination);
  }

  async getDisplayableQueue(thread) {
    return await thread.getDisplayableQueue();
  }

  async getQueue(thread) {
    return thread.getQueue();
  }

  async markTriaged_(destination) {
    // Update the UI first and then archive one at a time.
    await this.queueTriageActions(this.getThreads().selectedRows, destination);

    // If nothing left to triage, move to the triaged view and then triage the
    // threads async.
    // TODO: Make sure triaged view gets the threads triaged in processQueuedActions_ below.
    if (!this.isTearingDown_ && !threads.unselectedThreads.length)
      await router.run('/triaged');

    await this.processQueuedActions();
  }
}
window.customElements.define('mt-view-all', ViewAll);

ViewAll.ACTIONS_ = [
  Actions.DONE_ACTION,
  Actions.MUTE_ACTION,
  Actions.SPAM_ACTION,
  Actions.BEGIN_TRIAGE_ACTION,
];
