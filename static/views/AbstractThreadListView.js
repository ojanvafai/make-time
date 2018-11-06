import { Actions } from '../Actions.js';
import { addThread, fetchThread } from '../main.js';
import { Labels } from '../Labels.js';
import { RenderedThread } from '../RenderedThread.js';
import { ThreadRow } from './ThreadRow.js';
import { ThreadRowGroup } from './ThreadRowGroup.js';
import { Timer } from '../Timer.js';
import { ViewInGmailButton } from '../ViewInGmailButton.js';

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

    this.groupByQueue_ = {};
    this.threadIdToRow_ = new Map();

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

  goBack() {
    this.transitionToThreadList_();
  }

  async update() {
    if (this.renderedRow_)
      await this.renderedThread_().update();

    // Save out the rows for this whole update to avoid race conditions
    // when threadIdToRow_ is modified.
    let rows = this.threadIdToRow_.values();

    // Mark
    for (let row of rows) {
      row.mark = true;
    }

    await this.fetch(async (thread) => {
      let oldRow = this.threadIdToRow_.get(thread.id);
      if (!oldRow || oldRow.thread.historyId != thread.historyId)
        await this.processThread(thread);
      else
        oldRow.mark = false;
    })

    // Sweep
    for (let row of rows) {
      // The row could have gotten removed while this update was processing,
      // so check that it's still in the tree.
      if (row.mark && row.parentNode)
        this.removeRow_(row);
    }
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

  sortGroups_() {
    let rowGroups = Array.prototype.slice.call(this.rowGroupContainer_.children);
    rowGroups.sort(this.compareRowGroups.bind(this));

    for (var i = 0; i < rowGroups.length; i++) {
      let child = this.rowGroupContainer_.children[i];
      let rowGroup = rowGroups[i];
      if (rowGroup != child)
        child.before(rowGroup);
    }
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

  async addThread(thread, opt_nextSibling) {
    if (this.tornDown_)
      return;

    let queue = await this.getDisplayableQueue(thread);
    let rowGroup = this.groupByQueue_[queue];
    if (!rowGroup) {
      rowGroup = new ThreadRowGroup(queue);
      this.groupByQueue_[queue] = rowGroup;
      this.rowGroupContainer_.append(rowGroup);
      this.sortGroups_();
    }

    let row = new ThreadRow(thread);

    let oldRow = this.threadIdToRow_.get(thread.id);
    this.threadIdToRow_.set(thread.id, row);

    if (!oldRow) {
      rowGroup.push(row, opt_nextSibling);
      return row;
    }

    // If the thread changed queues, then remove it from the old one so
    // it doesn't show up twice. But if it's in the same rowGroup, let
    // replace the row to keep the thread in the same position.
    let oldRowGroup = this.getParentRowGroup_(oldRow);
    if (rowGroup == oldRowGroup) {
      oldRow.replaceWith(row);
      row.checked = oldRow.checked;
    } else {
      this.removeFromRowGroup_(oldRow);
      rowGroup.push(row, opt_nextSibling);
    }

    return row;
  }

  getParentRowGroup_(row) {
    let parent = row.parentNode;
    while (parent) {
      if (parent instanceof ThreadRowGroup)
        return parent;
      parent = parent.parentNode;
    }
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

  rowGroupCount() {
    return this.rowGroupContainer_.children.length;
  }

  getNextRow(row) {
    let nextRow = row.nextSibling;
    if (!nextRow) {
      let rowGroup = this.getParentRowGroup_(row);
      let nextRowGroup = rowGroup.nextSibling;
      if (nextRowGroup)
        nextRow = nextRowGroup.querySelector('mt-thread-row');
    }
    return nextRow;
  }

  async removeRow_(row) {
    this.threadIdToRow_.delete(row.thread.id);
    await this.removeFromRowGroup_(row);
  }

  async removeFromRowGroup_(row) {
    // TODO: If the currently rendered row is removed, render the next row or go back to threadlist?
    row.remove();
    if (row.thread.rendered)
      row.thread.rendered.remove();

    let queue = await this.getDisplayableQueue(row.thread);
    let rowGroup = this.groupByQueue_[queue];
    if (!rowGroup.hasRows()) {
      rowGroup.remove();
      delete this.groupByQueue_[queue];
    }
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

  transitionToThreadList_() {
    this.showBackArrow_(false);

    this.rowGroupContainer_.style.display = 'flex';
    this.singleThreadContainer_.textContent = '';
    this.scrollContainer_.scrollTop = this.scrollOffset_;

    this.undoableActions_ = [];
    this.setRenderedRow_(null);
    this.setSubject_('');
    this.updateActions_();
  }

  transitionToSingleThread_() {
    this.showBackArrow_(true);

    this.scrollOffset_ = this.scrollContainer_.scrollTop;
    this.rowGroupContainer_.style.display = 'none';

    this.undoableActions_ = [];
  }

  async markTriaged(destination) {
    this.undoableActions_ = [];

    let threads;
    if (this.renderedRow_) {
      let row = this.renderedRow_;

      let nextRow = this.getNextRow(row);
      await this.removeRow_(row);

      if (nextRow)
        await this.renderOne_(nextRow);
      else
        this.transitionToThreadList_();

      this.markSingleThreadTriaged(row.thread, destination);
    } else {
      // Update the UI first and then archive one at a time.
      let threads = this.getThreads();
      for (let row of threads.selectedRows) {
        await this.removeRow_(row);
      }

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
      let row = await this.addThread(newThread, this.renderedRow_);

      if (this.renderedRow_)
        this.renderOne_(row);
    }

    this.updateTitle_('undoLastAction_');
  }

  renderedThread_() {
    return this.renderedRow_.thread.rendered;
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
    if (!row.thread.rendered)
      new RenderedThread(row.thread);

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

    let rendered = nextRow.thread.rendered || new RenderedThread(nextRow.thread);
    let dom = await rendered.render(this.singleThreadContainer_);
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
