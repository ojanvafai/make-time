class ViewAll extends AbstractVueue {
  constructor(threads, updateTitleDelegate) {
    super(ViewAll.ACTIONS_, updateTitleDelegate, ViewAll.OVERFLOW_ACTIONS_);
    this.style.display = 'block';
    this.threads_ = threads;
    this.init_();
  }

  async finishedInitialLoad() {
    if (!this.rowGroupCount())
      await router.run('/triaged');
  }

  async init_() {
    for (let thread of this.threads_.getNeedsTriage()) {
      await this.addThread(thread);
    }
  }

  pushNeedsTriage(thread) {
    this.addThread(thread);
  }

  async tearDown() {
    // This can get called twice during teardown if /viewone redirects to
    // /triaged since the setView call won't have finished at that point because
    // promises run at microtask time. Blargh.
    if (this.isTearingDown_)
      return;

    this.isTearingDown_ = true;
    this.threads_.setNeedsTriage(this.getThreads().unselectedThreads);
    // Intentionaly don't await this since we want to archive threads in parallel
    // with showing the next triage phase.
    this.markTriaged_(Actions.VIEW_ALL_DONE_ACTION.destination);
  }

  async takeAction(action) {
    if (action == Actions.VIEW_ALL_DONE_ACTION) {
      await router.run('/viewone');
      return;
    }
    if (action == Actions.UNDO_ACTION) {
      this.undoLastAction_();
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
    let threads = this.getThreads();
    // Update the UI first and then archive one at a time.
    await this.queueTriageActions(threads.selectedRows, destination);

    // If nothing left to triage, move to the triaged view and then triage the
    // threads async.
    // TODO: Make sure triaged view gets the threads triaged in processQueuedActions_ below.
    if (!this.isTearingDown_ && !threads.unselectedThreads.length)
      await router.run('/triaged');

    await this.processQueuedActions();
  }

  async undoLastAction_() {
    if (!this.undoableActions_ || !this.undoableActions_.length) {
      new ErrorDialog('Nothing left to undo.');
      return;
    }

    let actions = this.undoableActions_;
    this.undoableActions_ = null;

    for (let i = 0; i < actions.length; i++) {
      let action = actions[i];
      this.updateTitle_('undoLastAction_', `Undoing ${i+1}/${actions.length}...`);
      await this.threads_.pushNeedsTriage(action.thread);
      await action.thread.modify(action.removed, action.added);
    }

    this.updateTitle_('undoLastAction_');
  }

}
window.customElements.define('mt-view-all', ViewAll);

ViewAll.ACTIONS_ = [
  Actions.ARCHIVE_ACTION,
  Actions.BLOCKED_ACTION,
  Actions.MUTE_ACTION,
  Actions.MUST_DO_ACTION,
  Actions.URGENT_ACTION,
  Actions.NOT_URGENT_ACTION,
  Actions.DELEGATE_ACTION,
  Actions.UNDO_ACTION,
  Actions.VIEW_ALL_DONE_ACTION,
];

ViewAll.OVERFLOW_ACTIONS_ = [
  Actions.SPAM_ACTION,
];
