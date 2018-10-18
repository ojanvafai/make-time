class AbstractVueue extends HTMLElement {
  constructor(actions, updateTitleDelegate, opt_overflowActions) {
    super();
    this.updateTitle_ = updateTitleDelegate;

    this.groupByQueue_ = {};
    this.queuedTriageActions_ = [];

    this.rowGroupContainer_ = document.createElement('div');
    this.rowGroupContainer_.style.cssText = `
      display: flex;
      flex-direction: column;
    `;
    this.append(this.rowGroupContainer_);

    let footer = document.getElementById('footer');
    footer.textContent = '';
    this.actions_ = new Actions(this, actions, opt_overflowActions);
    footer.append(this.actions_);
  }

  async dispatchShortcut(e) {
    this.actions_.dispatchShortcut(e);
  };

  shouldSuppressActions() {
    return false;
  }

  sortGroups_() {
    let rowGroups = Array.prototype.slice.call(this.rowGroupContainer_.children);
    rowGroups.sort(this.compareRowGroups);

    for (var i = 0; i < rowGroups.length; i++) {
      let child = this.rowGroupContainer_.children[i];
      let rowGroup = rowGroups[i];
      if (rowGroup != child)
        child.before(rowGroup);
    }
  }

  async addThread(thread, opt_extraPaddingQueue) {
    let queue = await this.getDisplayableQueue(thread);
    let rowGroup = this.groupByQueue_[queue];
    if (!rowGroup) {
      rowGroup = new ThreadRowGroup(queue);

      if (queue == opt_extraPaddingQueue)
        rowGroup.style.cssText = `padding-bottom: 50px;`;

      this.groupByQueue_[queue] = rowGroup;
      this.rowGroupContainer_.append(rowGroup);
      this.sortGroups_();
    }

    let row = new ThreadRow(thread);
    rowGroup.push(row);
    return row;
  }

  getThreads() {
    let selected = [];
    let unselected = [];
    let all = [];
    for (let child of this.rowGroupContainer_.querySelectorAll('mt-thread-row')) {
      if (child.checked) {
        selected.push(child);
      } else {
        unselected.push(child.thread);
      }
      all.push(child.thread);
    }
    return {
      selectedRows: selected,
      unselectedThreads: unselected,
      allThreads: all,
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

    this.undoableActions_ = [];

    this.updateTitle_('archiving', `Archiving ${this.queuedTriageActions_.length} threads...`);
    let item;
    while (item = this.queuedTriageActions_.pop()) {
      this.updateTitle_('archiving', `Archiving ${this.queuedTriageActions_.length + 1} threads...`);
      let thread = item.row.thread;
      if (item.isSetPriority) {
        this.undoableActions_.push(await thread.setPriority(item.destination));
        await this.addThread(thread);
      } else {
        let queue = await this.getQueue(thread);
        this.undoableActions_.push(await thread.markTriaged(item.destination, queue));
      }
    }
    this.updateTitle_('archiving');
  }
}
