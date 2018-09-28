class MakeTime extends AbstractSingleThreadView {
  constructor(threads, allowedReplyLength, contacts, setSubject, updateTitle) {
    // Since we pop off the end of the thread queue, reverse to get the right order.
    let sortedThreads = threads.getTriaged().reverse();
    super(sortedThreads, allowedReplyLength, contacts, setSubject, updateTitle);

    this.style.display = 'block';

    this.threads_ = threads;

    // TODO: Move this to a toolbar and make a real button that greys out when
    // there's no best effort threads.
    this.bestEffortButton_ = document.createElement('a');
    this.bestEffortButton_.className = 'label-button';
    this.bestEffortButton_.href = '/besteffort';
    this.append(this.bestEffortButton_);
    this.updateBestEffort_();

    this.renderNext();
  }

  onSend_(opt_archive) {
    // Hackity hack. Check that it's actually true and not truthy because
    // sometimes opt_archive is a click event and we don't want to archive there.
    if (opt_archive === true)
      this.actions_.takeAction(Actions.ARCHIVE_ACTION);
  }

  async onRenderNext() {
    let toolbar = document.createElement('div');
    toolbar.style.cssText = `
      background-color: white;
      display: flex;
      width: 100%;
    `;
    let footer = document.getElementById('footer');
    footer.textContent = '';
    footer.append(toolbar);

    this.showQuickReply(toolbar, this.onSend_.bind(this));

    this.actions_ = new Actions(this, MakeTime.ACTIONS_);
    toolbar.append(this.actions_);
  }

  async pushTriaged(thread) {
    // TODO: This needs to respect priority orders.
    await this.threadList.push(thread);

    if (!this.currentThread) {
      await this.renderNext();
    } else {
      this.prerenderNext();
    }
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

MakeTime.ACTIONS_ = [
  Actions.ARCHIVE_ACTION,
];
