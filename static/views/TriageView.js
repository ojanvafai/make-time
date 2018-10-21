class TriageView extends AbstractThreadListView {
  constructor(threads, queueSettings, updateTitleDelegate, setSubject, allowedReplyLength, contacts, autoStartTimer, timerDuration) {
    super(updateTitleDelegate, setSubject, allowedReplyLength, contacts, autoStartTimer, timerDuration, TriageView.ACTIONS_, TriageView.RENDER_ONE_ACTIONS_, TriageView.OVERFLOW_ACTIONS_);
    this.style.display = 'block';
    this.threads_ = threads;
    this.queueSettings_ = queueSettings;
    this.init_();
  }

  async finishedInitialLoad() {
    await this.handleNoThreadsLeft();
  }

  async init_() {
    for (let thread of this.threads_.getNeedsTriage()) {
      await this.addThread(thread);
    }
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
