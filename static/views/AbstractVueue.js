class AbstractVueue extends HTMLElement {
  constructor(actions, updateTitleDelegate) {
    super();
    this.updateTitle_ = updateTitleDelegate;

    this.groupByQueue_ = {};
    this.queuedTriageActions_ = [];

    this.rowGroupContainer_ = document.createElement('div');
    this.append(this.rowGroupContainer_);

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

  sortGroups(comparator) {
    let rowGroups = Array.prototype.slice.call(this.rowGroupContainer_.children);
    rowGroups.sort(comparator);

    for (var i = 0; i < rowGroups.length; i++) {
      let child = this.rowGroupContainer_.children[i];
      let rowGroup = rowGroups[i];
      if (rowGroup != child)
        child.before(rowGroup);
    }
  }

  async addThread(thread) {
    let queue = await this.getDisplayableQueue(thread);
    let rowGroup = this.groupByQueue_[queue];
    if (!rowGroup) {
      rowGroup = new ThreadRowGroup(queue);
      this.groupByQueue_[queue] = rowGroup;
      this.rowGroupContainer_.append(rowGroup);
    }

    let row = new ThreadRow(thread);
    rowGroup.push(row);
    return row;
  }

  getThreads() {
    let selected = [];
    let unselected = [];
    for (let child of this.rowGroupContainer_.querySelectorAll('mt-thread-row')) {
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
    return this.rowGroupContainer_.children.length;
  }

  parentRowGroup(row) {
    let parent = row.parentNode;
    while (!(parent instanceof ThreadRowGroup)) {
      parent = parent.parentNode;
    }
    return parent;
  }

  getNextRow(row) {
    let nextRow = row.nextSibling;
    if (!nextRow) {
      let rowGroup = this.parentRowGroup(row);
      let nextRowGroup = rowGroup.nextSibling;
      if (nextRowGroup)
        nextRow = nextRowGroup.querySelector('mt-thread-row');
    }
    return nextRow;
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

  async queueTriageActions(rows, destination, opt_isSetPriority) {
    for (let row of rows) {
      if (opt_isSetPriority)
        row.checked = false;
      else
        await this.removeRow_(row);

      this.queuedTriageActions_.push({
        destination: destination,
        row: row,
        isSetPriority: opt_isSetPriority,
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
      let thread = item.row.thread;
      if (item.isSetPriority) {
        await thread.setPriority(item.destination);
        await item.row.showPriority();
      } else {
        let queue = await this.getQueue(thread);
        await thread.markTriaged(item.destination, queue);
      }
    }
    this.updateTitle_('archiving');
  }
}
