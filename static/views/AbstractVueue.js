class AbstractVueue extends HTMLElement {
  constructor(actions, updateTitleDelegate) {
    super();
    this.updateTitle_ = updateTitleDelegate;

    this.groupByQueue_ = {};
    this.queuedTriageActions_ = [];

    this.rowGroupContainer = document.createElement('div');
    this.append(this.rowGroupContainer);

    let footer = document.createElement('div');
    footer.className = 'footer';
    this.actions_ = new Actions(this, actions);
    footer.append(this.actions_);
    this.append(footer);
  }

  async dispatchShortcut(e) {
    this.actions_.dispatchShortcut(e);
  };

  shouldSuppressActions() {
    return false;
  }

  async push(thread) {
    let queue = await this.getDisplayableQueue(thread);
    let rowGroup = this.groupByQueue_[queue];
    if (!rowGroup) {
      rowGroup = new ThreadRowGroup(queue);
      this.groupByQueue_[queue] = rowGroup;
      this.rowGroupContainer.append(rowGroup);
    }
    rowGroup.push(thread);
  }

  async addTriagedThread_(thread) {
    let queue = await this.getDisplayableQueue(thread);
    let rowGroup = this.groupByQueue_[queue];
    if (!rowGroup) {
      rowGroup = new ThreadRowGroup(queue);
      this.groupByQueue_[queue] = rowGroup;
      this.rowGroupContainer.append(rowGroup);
    }
    rowGroup.push(thread);
  }

  getThreads() {
    let selected = [];
    let unselected = [];
    for (let child of this.rowGroupContainer.querySelectorAll('mt-thread-row')) {
      if (child.checked) {
        selected.push(child);
      } else {
        unselected.push(child.thread);
      }
    }
    return {
      selectedRows: selected,
      unselectedThreads: unselected,
    }
  }

  rowGroupCount() {
    return this.rowGroupContainer.children.length;
  }

  async removeRow_(row) {
    row.remove();
    let queue = await this.getDisplayableQueue(row.thread);
    let rowGroup = this.groupByQueue_[queue];
    if (!rowGroup.hasRows()) {
      rowGroup.remove();
      delete this.groupByQueue_[queue];
    }
  }

  async queueTriageActions(rows, destination) {
    for (let row of rows) {
      await this.removeRow_(row);
      this.queuedTriageActions_.push({
        destination: destination,
        thread: row.thread,
      })
    }
  }

  async processQueuedActions() {
    if (!this.queuedTriageActions_.length)
      return;

    this.updateTitle_('archiving', `Archiving ${this.queuedTriageActions_.length} threads...`);
    let item;
    while (item = this.queuedTriageActions_.pop()) {
      this.updateTitle_('archiving', `Archiving ${this.queuedTriageActions_.length + 1} threads...`);
      let queue = await this.getQueue(item.thread);
      await item.thread.markTriaged(item.destination, queue);
    }
    this.updateTitle_('archiving');
  }
}
