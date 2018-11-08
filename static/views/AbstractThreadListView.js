import { Actions } from '../Actions.js';
import { addThread, fetchThread } from '../main.js';
import { Labels } from '../Labels.js';
import { ThreadRow } from './ThreadRow.js';
import { ThreadRowGroup } from './ThreadRowGroup.js';
import { Timer } from '../Timer.js';
import { ViewInGmailButton } from '../ViewInGmailButton.js';

// TODO: Mvoe this to it's own file? Deal with the name overlap with ThreadRowGroup?
class RowGroup {
  constructor(queue) {
    this.queue = queue;
    this.node = new ThreadRowGroup(queue);
    this.rows_ = {};
  }

  push(thread) {
    let currentRow = this.rows_[thread.id];
    if (currentRow) {
      currentRow.mark = false;
      currentRow.setThread(thread);
      return;
    }
    this.rows_[thread.id] = new ThreadRow(thread, this);
  }

  delete(row) {
    delete this.rows_[row.thread.id];
  }

  getRow(thread) {
    return this.rows_[thread.id];
  }

  getRows() {
    return Object.values(this.rows_);
  }

  hasRows() {
    return !!this.getRows().length;
  }

  getFirstRow() {
    return Object.values(this.rows_)[0];
  }

  getNextRow(row) {
    let rows = Object.values(this.rows_);
    let index = rows.indexOf(row);
    if (index == -1)
      throw `Tried to get next row on a row that's not in the group.`;
    if (index + 1 < rows.length)
      return rows[index + 1];
  }

  mark() {
    for (let id in this.rows_) {
      let row = this.rows_[id];
      row.mark = true;
    }
  }

  getMarked() {
    return Object.values(this.rows_).filter((row) => row.mark);
  }
}

RowGroup.groups_ = {};

RowGroup.create = (queue) => {
  if (!RowGroup.groups_[queue])
    RowGroup.groups_[queue] = new RowGroup(queue);
  return RowGroup.groups_[queue];
}

export class AbstractThreadListView extends HTMLElement {
  constructor(threads, mailProcessor, scrollContainer, updateTitleDelegate, setSubject, showBackArrow, allowedReplyLength, contacts, autoStartTimer, countDown, timerDuration, viewAllActions, viewOneActions, opt_overflowActions) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    this.threads_ = threads;
    this.mailProcessor_ = mailProcessor;
    this.scrollContainer_ = scrollContainer;
    this.updateTitle_ = updateTitleDelegate;
    this.setSubject_ = setSubject;
    this.showBackArrow_ = showBackArrow;
    this.allowedReplyLength_ = allowedReplyLength;
    this.contacts_ = contacts;
    this.autoStartTimer_ = autoStartTimer;
    this.countDown_ = countDown;
    this.timerDuration_ = timerDuration;
    this.viewAllActions_ = viewAllActions;
    this.viewOneActions_ = viewOneActions;
    this.overflowActions_ = opt_overflowActions;

    // TODO: Rename this to groupedRows_?
    this.groupedThreads_ = [];

    this.rowGroupContainer_ = document.createElement('div');
    this.rowGroupContainer_.style.cssText = `
      display: flex;
      flex-direction: column;
    `;
    this.append(this.rowGroupContainer_);

    this.rowGroupContainer_.addEventListener('renderThread', (e) => {
      this.renderOne_(e.target);
    })

    this.singleThreadContainer_ = document.createElement('div');
    this.singleThreadContainer_.style.cssText = `
      position: relative;
    `;
    this.append(this.singleThreadContainer_);

    this.bestEffortButton_ = this.appendButton_('/best-effort');
    this.bestEffortButton_.style.display = 'none';
    this.updateBestEffort_();

    this.updateActions_();
  }

  appendButton_(href, textContent = '') {
    let button = document.createElement('a');
    button.className = 'label-button';
    button.href = href;
    button.textContent = textContent;
    this.append(button);
    return button;
  }

  setFooter_(dom) {
    let footer = document.getElementById('footer');
    footer.textContent = '';
    this.actions_ = null;
    footer.append(dom);
  }

  tearDown() {
    this.tornDown_ = true;
    this.setSubject_('');
    this.showBackArrow_(false);
  }

  async goBack() {
    await this.transitionToThreadList_();
  }

  async update() {
    if (this.renderedRow_)
      await this.renderedThread_().update();

    for (let group of this.groupedThreads_) {
      group.mark();
    }

    await this.fetch(async (thread) => {
      await this.processThread(thread);
    });
    await this.renderThreadList_();

    for (let group of this.groupedThreads_) {
      let rows = group.getMarked();
      for (let row of rows) {
        this.removeRow_(row);
      }
    }
  }

  async findRow_(thread) {
    let queue = await this.getDisplayableQueue(thread);
    let group = this.getRowGroup_(queue);
    if (group)
      return group.getRow(thread);
  }

  updateActions_() {
    let footer = document.getElementById('footer');
    footer.textContent = '';
    let actions = this.renderedRow_ ? this.viewOneActions_ : this.viewAllActions_;
    this.actions_ = new Actions(this, actions, this.overflowActions_);
    footer.append(this.actions_);
    if (this.renderedRow_) {
      let timer = new Timer(this.autoStartTimer_, this.countDown_, this.timerDuration_, this.singleThreadContainer_);
      footer.append(timer);
    }
  }

  async dispatchShortcut(e) {
    if (this.actions_)
      this.actions_.dispatchShortcut(e);
  };

  shouldSuppressActions() {
    return false;
  }

  async processThread(thread) {
    let processedId = await this.allLabels_.getId(Labels.PROCESSED_LABEL);
    let messages = await thread.getMessages();
    let lastMessage = messages[messages.length - 1];
    if (!lastMessage.getLabelIds().includes(processedId)) {
      // TODO: Remove this hack once all clients have upgraded to having processed
      // labels on all processed threads. For now, don't reprocess threads that
      // have already been triaged and have had no new messages since that would
      // remove their priorities.
      let unprocessedId = await this.allLabels_.getId(Labels.UNPROCESSED_LABEL);
      if (await thread.getPriority() &&
        !messages[0].getLabelIds().includes(processedId) &&
        !thread.isInInbox() &&
        !lastMessage.getLabelIds().includes(unprocessedId)) {
        let addLabelIds = [processedId];
        let removeLabelIds = [];
        await thread.modify(addLabelIds, removeLabelIds);
      } else {
        await this.mailProcessor_.processThread(thread);
        return;
      }
    }

    // TODO: Don't use the global addThread.
    await addThread(thread);
  }

  getRowGroup_(queue) {
    return this.groupedThreads_.find((item) => item.queue == queue);
  }

  async renderThreadList_() {
    // Delete empty row groups.
    this.groupedThreads_ = this.groupedThreads_.filter((group) => {
      let hasRows = group.hasRows();
      if (!hasRows)
        group.node.remove();
      return hasRows;
    });

    // Ensure the row groups are sorted.
    let sorted = Array.prototype.slice.call(this.groupedThreads_);
    sorted.sort(this.compareRowGroups.bind(this));
    for (var i = 0; i < sorted.length; i++) {
      let newNode = sorted[i].node;
      let oldNode = this.rowGroupContainer_.children[i];
      if (!oldNode) {
        this.rowGroupContainer_.append(newNode);
      } else if (newNode != oldNode) {
        oldNode.before(newNode);
      }
    }

    for (let group of this.groupedThreads_) {
      let newIdToRow = {};
      for (let row of group.getRows()) {
        newIdToRow[row.thread.id] = row;
      }

      let existingRows = group.node.rows();
      for (let row of existingRows) {
        let threadId = row.thread.id;
        let newRow = newIdToRow[threadId];
        delete newIdToRow[threadId];
        if (!newRow)
          row.remove();
      }

      // Everything left in newIdToRow is now new threads.
      let newRowsLeft = Object.values(newIdToRow);
      for (let row of newRowsLeft) {
        group.node.push(row);
      }
    }
  }

  async addThread(thread, opt_nextSibling) {
    if (this.tornDown_)
      return;

    let queue = await this.getDisplayableQueue(thread);
    let group = this.getRowGroup_(queue);
    if (!group) {
      group = RowGroup.create(queue);
      this.groupedThreads_.push(group);
    }
    group.push(thread);

    // TODO: debounce this or something.
    await this.renderThreadList_(this.groupedThreads_);
  }

  clearBestEffort() {
    this.threads_.setBestEffort([]);
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

  getThreads() {
    let selected = [];
    let all = [];
    for (let child of this.rowGroupContainer_.querySelectorAll('mt-thread-row')) {
      if (child.checked)
        selected.push(child);
      all.push(child.thread);
    }
    return {
      selectedRows: selected,
      allThreads: all,
    }
  }

  getNextRow(row) {
    let nextRow = row.group.getNextRow(row);
    if (nextRow)
      return nextRow;

    let groupIndex = this.groupedThreads_.indexOf(row.group);
    if (groupIndex == -1)
      throw `Tried to get next row on a group that's not in the tree.`;
    if (groupIndex + 1 < this.groupedThreads_.length)
      return this.groupedThreads_[groupIndex + 1].getFirstRow();
  }

  removeRow_(row) {
    row.group.delete(row);
  }

  async takeAction(action) {
    if (action == Actions.UNDO_ACTION) {
      this.undoLastAction_();
      return;
    }
    if (action == Actions.QUICK_REPLY_ACTION) {
      await this.showQuickReply();
      return;
    }
    await this.markTriaged(action.destination);
  }

  async transitionToThreadList_() {
    this.showBackArrow_(false);

    this.rowGroupContainer_.style.display = 'flex';
    this.singleThreadContainer_.textContent = '';
    this.scrollContainer_.scrollTop = this.scrollOffset_;

    this.undoableActions_ = [];
    this.setRenderedRow_(null);
    this.setSubject_('');
    this.updateActions_();

    await this.renderThreadList_();
  }

  transitionToSingleThread_() {
    this.showBackArrow_(true);

    this.scrollOffset_ = this.scrollContainer_.scrollTop;
    this.rowGroupContainer_.style.display = 'none';

    this.undoableActions_ = [];
  }

  async removeCurrentAndRenderNext_() {
    let nextRow = this.getNextRow(this.renderedRow_);
    await this.removeRow_(this.renderedRow_);
    if (nextRow)
      await this.renderOne_(nextRow);
    else
      await this.transitionToThreadList_();
  }

  async markTriaged(destination) {
    this.undoableActions_ = [];

    let threads;
    if (this.renderedRow_) {
      // Save this off since removeCurrentAndRenderNext_ changes this.renderedRow_.
      let row = this.renderedRow_;
      await this.removeCurrentAndRenderNext_();
      this.markSingleThreadTriaged(row.thread, destination);
    } else {
      // Update the UI first and then archive one at a time.
      let threads = this.getThreads();
      this.updateTitle_('archiving', `Archiving ${threads.selectedRows.length} threads...`);

      for (let row of threads.selectedRows) {
        await this.removeRow_(row);
      }
      await this.renderThreadList_(this.groupedThreads_);

      for (let i = 0; i < threads.selectedRows.length; i++) {
        this.updateTitle_('archiving', `Archiving ${i + 1}/${threads.selectedRows.length} threads...`);
        let row = threads.selectedRows[i];
        await this.markSingleThreadTriaged(row.thread, destination);
      }
      this.updateTitle_('archiving');
    }
  }

  async markSingleThreadTriaged(thread, destination) {
    let triageResult = await thread.markTriaged(destination);
    if (triageResult)
      this.undoableActions_.push(triageResult);
    if (this.handleTriaged)
      await this.handleTriaged(destination, triageResult, thread);
  }

  async undoLastAction_() {
    if (!this.undoableActions_ || !this.undoableActions_.length) {
      alert('Nothing left to undo.');
      return;
    }

    let actions = this.undoableActions_;
    this.undoableActions_ = null;

    for (let i = 0; i < actions.length; i++) {
      this.updateTitle_('undoLastAction_', `Undoing ${i + 1}/${actions.length}...`);

      let action = actions[i];
      await action.thread.modify(action.removed, action.added);
      let newThread = await fetchThread(action.thread.id);
      await this.addThread(newThread, this.renderedRow_);

      if (this.renderedRow_) {
        let queue = await this.getDisplayableQueue(newThread);
        let group = this.getRowGroup_(queue);
        this.renderOne_(group.getRow(newThread));
      }
    }

    this.updateTitle_('undoLastAction_');
  }

  renderedThread_() {
    return this.renderedRow_.rendered;
  }

  setRenderedRow_(row) {
    if (this.renderedRow_)
      this.renderedThread_().remove();
    this.renderedRow_ = row;
  }

  async renderOne_(row) {
    if (this.rowGroupContainer_.style.display != 'none')
      this.transitionToSingleThread_();

    this.setRenderedRow_(row);

    let messages = await row.thread.getMessages();
    let viewInGmailButton = new ViewInGmailButton();
    viewInGmailButton.setMessageId(messages[messages.length - 1].id);
    viewInGmailButton.style.display = 'inline-flex';

    let subject = await row.thread.getSubject();
    let subjectText = document.createElement('div');
    subjectText.style.flex = 1;
    subjectText.append(subject, viewInGmailButton);

    let queue = await this.getDisplayableQueue(row.thread);
    this.setSubject_(subjectText, queue);

    let dom = await this.renderedThread_().render(this.singleThreadContainer_);
    // If previously prerendered offscreen, move it on screen.
    dom.style.bottom = '';
    dom.style.visibility = 'visible';

    this.updateActions_();

    var elementToScrollTo = dom.querySelector('.unread');
    if (!elementToScrollTo) {
      let messageNodes = dom.querySelectorAll('.message');
      elementToScrollTo = messageNodes[messageNodes.length - 1];
    }

    elementToScrollTo.scrollIntoView();
    // Make sure that there's at least 50px of space above for showing that there's a
    // previous message.
    let y = elementToScrollTo.getBoundingClientRect().y;
    if (y < 70)
      document.documentElement.scrollTop -= 70 - y;

    // Check if new messages have come in since we last fetched from the network.
    await this.renderedThread_().update();

    // Intentionally don't await this so other work can proceed.
    this.prerenderNext();
  }

  async prerenderNext() {
    let nextRow = this.getNextRow(this.renderedRow_);
    if (!nextRow)
      return;

    let dom = await nextRow.rendered.render(this.singleThreadContainer_);
    dom.style.bottom = '0';
    dom.style.visibility = 'hidden';
  }

  async showQuickReply() {
    let container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
    `;

    let Compose = (await import('../Compose.js')).Compose;
    let compose = new Compose(this.contacts_);
    compose.style.cssText = `
      flex: 1;
      margin: 4px;
      display: flex;
      background-color: white;
    `;
    compose.placeholder = 'Hit enter to send.';
    container.append(compose);

    let onClose = this.updateActions_.bind(this);

    let cancel = document.createElement('button');
    cancel.textContent = 'cancel';
    cancel.onclick = onClose;
    container.append(cancel);

    compose.addEventListener('cancel', onClose);

    let sideBar = document.createElement('div');
    sideBar.style.cssText = `margin: 4px;`;

    let replyAllLabel = document.createElement('label');
    let replyAll = document.createElement('input');
    replyAll.type = 'checkbox';
    replyAll.checked = true;
    replyAllLabel.append(replyAll, 'reply all');

    let progressContainer = document.createElement('div');
    progressContainer.style.cssText = `
      display: flex;
      align-items: center;
    `;

    let progress = document.createElement('progress');
    progress.style.cssText = `
      flex: 1;
      width: 0;
    `;
    progress.max = this.allowedReplyLength_;
    progress.value = 0;

    let count = document.createElement('div');
    count.style.cssText = `
      margin: 4px;
      color: red;
    `;

    progressContainer.append(count, progress);

    sideBar.append(replyAllLabel, progressContainer);
    container.append(sideBar);

    compose.addEventListener('submit', async (e) => {
      if (!compose.value.length)
        return;

      if (compose.value.length > this.allowedReplyLength_) {
        alert(`Email is longer than the allowed length of ${this.allowedReplyLength_} characters. Allowed length is configurable in the settings spreadsheet as the allowed_reply_length setting.`);
        return;
      }

      if (this.isSending_)
        return;
      this.isSending_ = true;
      this.updateTitle_('sendReply', 'Sending reply...');

      // TODO: Handle if sending fails in such a way that the user can at least save their message text.
      await this.renderedRow_.thread.sendReply(compose.value, compose.getEmails(), replyAll.checked);
      this.updateActions_();
      await this.markTriaged(Actions.ARCHIVE_ACTION.destination);

      this.updateTitle_('sendReply');
      this.isSending_ = false;
    })

    compose.addEventListener('input', (e) => {
      progress.value = compose.value.length;
      let lengthDiff = this.allowedReplyLength_ - compose.value.length;
      let exceedsLength = compose.value.length >= (this.allowedReplyLength_ - 10);
      count.textContent = (lengthDiff < 10) ? lengthDiff : '';
    });

    this.setFooter_(container);

    compose.focus();
  }
}
