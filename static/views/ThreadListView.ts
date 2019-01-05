import {Action} from '../Actions.js';
import {login} from '../BaseMain.js';
import {EmailCompose} from '../EmailCompose.js';
import {Labels} from '../Labels.js';
import {ThreadListModel, UndoEvent} from '../models/ThreadListModel.js';
import {Thread} from '../Thread.js';
import {Timer} from '../Timer.js';
import {ViewInGmailButton} from '../ViewInGmailButton.js';

import {ThreadRow} from './ThreadRow.js';
import {ThreadRowGroup} from './ThreadRowGroup.js';
import {View} from './View.js';

let threadToRow: WeakMap<Thread, ThreadRow> = new WeakMap();
let getThreadRow = (thread: Thread) => {
  let row = threadToRow.get(thread);
  if (!row) {
    row = new ThreadRow(thread);
    threadToRow.set(thread, row);
  }
  return row;
};

let rowAtOffset = (rows: ThreadRow[], thread: ThreadRow, offset: number):
    ThreadRow|null => {
      if (offset != -1 && offset != 1)
        throw `getRowFromRelativeOffset called with offset of ${offset}`;

      let index = rows.indexOf(thread);
      if (index == -1)
        throw `Tried to get row via relative offset on a row that's not in the model.`;
      if (0 <= index + offset && index + offset < rows.length)
        return rows[index + offset];
      return null;
    }

interface ListenerData {
  name: string, handler: (e: Event) => void,
}

let ARCHIVE_ACTION = {
  name: `Archive`,
  description: `Archive and remove from the current queue.`,
  // Done is removing all labels. Use null as a sentinel for that.
  destination: null,
};

let QUICK_REPLY_ACTION = {
  name: `Quick Reply`,
  description:
      `Give a short reply. Hit enter to send, escape to cancel. Allowed length is the allowed_reply_length setting.`,
};

let BLOCKED_ACTION = {
  name: `Blocked`,
  description:
      `Block on action from someone else. Gets queued to be shown once a week on a day of your choosing via Settings.`,
  destination: Labels.BLOCKED_LABEL,
};

let SPAM_ACTION = {
  name: `Spam`,
  description: `Report spam. Same beavhior as reporting spam in gmail.`,
  destination: 'SPAM',
};

let MUTE_ACTION = {
  name: `Mute`,
  description:
      `Like gmail mute, but more aggressive. Will never appear in your inbox again. Goes in triaged/supermuted label.`,
  destination: Labels.MUTED_LABEL,
};

let NEXT_EMAIL_ACTION = {
  name: `NextEmail`,
  description: `Focus the next email.`,
  key: 'j',
  hidden: true,
  repeatable: true,
};

let PREVIOUS_EMAIL_ACTION = {
  name: `PreviousEmail`,
  description: `Focus the previous email.`,
  key: 'k',
  hidden: true,
  repeatable: true,
};

let TOGGLE_FOCUSED_ACTION = {
  name: `ToggleFocused`,
  description: `Toggle whether or not the focused element is selected.`,
  key: ' ',
  hidden: true,
};

let VIEW_FOCUSED_ACTION = {
  name: `ViewFocused`,
  description: `View the focused email.`,
  key: 'Enter',
  hidden: true,
};

let NEXT_QUEUE_ACTION = {
  name: `NextQueue`,
  description: `Focus the first email of the next queue.`,
  key: 'n',
  hidden: true,
  repeatable: true,
};

let PREVIOUS_QUEUE_ACTION = {
  name: `PreviousQueue`,
  description: `Focus the first email of the previous queue.`,
  key: 'p',
  hidden: true,
  repeatable: true,
};

let TOGGLE_QUEUE_ACTION = {
  name: `ToggleQueue`,
  description: `Toggle all items in the current queue.`,
  key: 'g',
  hidden: true,
};

let VIEW_TRIAGE_ACTION = {
  name: `ViewTriage`,
  description: `Go to the triage view.`,
  key: 'Escape',
  hidden: true,
};

let UNDO_ACTION = {
  name: `Undo`,
  description: `Undoes the last action taken.`,
};

let MUST_DO_ACTION = {
  name: `1: Must Do`,
  description: `Must do today. Literally won't go home till it's done.`,
  destination: Labels.MUST_DO_LABEL,
};

let URGENT_ACTION = {
  name: `2: Urgent`,
  description: `Needs to happen ASAP.`,
  destination: Labels.URGENT_LABEL,
};

let BACKLOG_ACTION = {
  name: `3: Backlog`,
  description:
      `Important for achieving my mission, but can be done at leisure. Aim to spend >60% of your time here.`,
  destination: Labels.BACKLOG_LABEL,
};

let NEEDS_FILTER_ACTION = {
  name: `4: Needs Filter`,
  description:
      `Needs a new/different filter, but don't want to interrupt triaging to do that now.`,
  destination: Labels.NEEDS_FILTER_LABEL,
};

let ACTIONS = [
  ARCHIVE_ACTION,
  BLOCKED_ACTION,
  MUTE_ACTION,
  MUST_DO_ACTION,
  URGENT_ACTION,
  BACKLOG_ACTION,
  NEEDS_FILTER_ACTION,
  SPAM_ACTION,
  UNDO_ACTION,
];

let RENDER_ALL_ACTIONS = [
  PREVIOUS_EMAIL_ACTION,
  NEXT_EMAIL_ACTION,
  PREVIOUS_QUEUE_ACTION,
  NEXT_QUEUE_ACTION,
  TOGGLE_FOCUSED_ACTION,
  TOGGLE_QUEUE_ACTION,
  VIEW_FOCUSED_ACTION,
  ...ACTIONS,
];

let RENDER_ONE_ACTIONS = [
  QUICK_REPLY_ACTION,
  VIEW_TRIAGE_ACTION,
  ...ACTIONS,
];

export class ThreadListView extends View {
  private modelListeners_: ListenerData[];
  private focusedRow_: ThreadRow|null;
  private rowGroupContainer_: HTMLElement;
  private singleThreadContainer_: HTMLElement;
  private bestEffortButton_: HTMLElement;
  private renderedRow_: ThreadRow|null;
  private scrollOffset_: number|undefined;
  private isSending_: boolean|undefined;
  private hasQueuedFrame_: boolean;

  constructor(
      private model_: ThreadListModel, public allLabels: Labels,
      private scrollContainer_: HTMLElement, public updateTitle: any,
      private setSubject_: (...subject: (Node|string)[]) => void,
      private showBackArrow_: any, private allowedReplyLength_: number,
      private contacts_: any, private autoStartTimer_: boolean,
      private countDown_: boolean, private timerDuration_: number,
      bottomButtonUrl: string, bottomButtonText: string) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    this.modelListeners_ = [];
    this.focusedRow_ = null;
    this.renderedRow_ = null;
    this.hasQueuedFrame_ = false;

    this.rowGroupContainer_ = document.createElement('div');
    this.rowGroupContainer_.style.cssText = `
      display: flex;
      flex-direction: column;
    `;
    this.append(this.rowGroupContainer_);

    this.rowGroupContainer_.addEventListener('renderThread', (e: Event) => {
      this.renderOne_(<ThreadRow>e.target);
    });

    this.singleThreadContainer_ = document.createElement('div');
    this.singleThreadContainer_.style.cssText = `
      position: relative;
    `;
    this.append(this.singleThreadContainer_);

    this.bestEffortButton_ = this.appendButton('/best-effort');
    this.bestEffortButton_.style.display = 'none';
    this.handleBestEffortChanged_();

    this.appendButton(bottomButtonUrl, bottomButtonText);
    this.updateActions_();

    this.addListenerToModel(
        'thread-list-changed', this.renderThreadList_.bind(this));
    this.addListenerToModel(
        'best-effort-changed', this.handleBestEffortChanged_.bind(this));
    this.addListenerToModel('undo', (e: Event) => {
      let undoEvent = <UndoEvent>e;
      this.handleUndo_(undoEvent.thread);
    });
  }

  addListenerToModel(eventName: string, handler: (e: Event) => void) {
    this.modelListeners_.push({
      name: eventName,
      handler: handler,
    });
    this.model_.addEventListener(eventName, handler);
  }

  private handleUndo_(thread: Thread) {
    if (this.renderedRow_)
      this.renderOne_(getThreadRow(thread));
  }

  appendButton(href: string, textContent = '') {
    let button = document.createElement('a');
    button.className = 'label-button';
    button.href = href;
    button.textContent = textContent;
    this.append(button);
    return button;
  }

  tearDown() {
    super.tearDown();

    for (let listener of this.modelListeners_) {
      this.model_.removeEventListener(listener.name, listener.handler);
    }
    this.setSubject_('');
    this.showBackArrow_(false);
  }

  async init() {
    await login();
    await this.model_.loadFromDisk();
    await this.model_.update();
  }

  async goBack() {
    this.transitionToThreadList_(this.renderedRow_);
  }

  async update() {
    if (this.renderedRow_)
      await this.renderedRow_.update();
  }

  updateActions_() {
    if (this.renderedRow_) {
      this.setActions(RENDER_ONE_ACTIONS);
      this.addToFooter(new Timer(
          this.autoStartTimer_, this.countDown_, this.timerDuration_,
          this.singleThreadContainer_));
    } else {
      this.setActions(RENDER_ALL_ACTIONS);
    }
  }

  shouldSuppressActions() {
    return false;
  }

  private renderThreadList_() {
    if (this.hasQueuedFrame_)
      return;
    this.hasQueuedFrame_ = true;
    requestAnimationFrame(this.renderThreadListDebounced_.bind(this));
  }

  getRows_() {
    return <ThreadRow[]>Array.from(
        this.rowGroupContainer_.querySelectorAll('mt-thread-row'));
  }

  private renderThreadListDebounced_() {
    this.hasQueuedFrame_ = false;
    let threads = this.model_.getThreads();
    let oldRows = this.getRows_();

    this.rowGroupContainer_.textContent = '';
    let currentGroup = null;
    // Threads should be in sorted order already and all threads in the
    // same queue should be adjacent to each other.
    for (let thread of threads) {
      let groupName = this.model_.getGroupName(thread);
      if (!currentGroup || currentGroup.name != groupName) {
        currentGroup = new ThreadRowGroup(groupName);
        this.rowGroupContainer_.append(currentGroup);
      }
      currentGroup.push(getThreadRow(thread));
    }

    let newRows = this.getRows_();
    let removedRows = oldRows.filter(x => !newRows.includes(x));

    let focused = this.renderedRow_ || this.focusedRow_;
    if (focused && removedRows.find(x => x == focused)) {
      // Find the next row in oldRows that isn't also removed.
      let nextRow = null;
      let index = oldRows.findIndex(x => x == focused);
      for (var i = index + 1; i < oldRows.length; i++) {
        let row = oldRows[i];
        if (!removedRows.find(x => x == row)) {
          nextRow = row;
          break;
        }
      }

      if (this.renderedRow_) {
        if (nextRow)
          this.renderOne_(nextRow);
        else
          this.transitionToThreadList_(null);
      } else {
        // Intentionally call even if nextRow is null to clear out the focused
        // row if there's nothing left to focus.
        this.setFocus(nextRow);
      }
    }

    // Always prerender the row that would get rendered if the user hits enter.
    let rowToPrerender = this.focusedRow_ || newRows[0];
    if (rowToPrerender && rowToPrerender != this.renderedRow_)
      this.prerenderRow_(rowToPrerender);
  }

  handleBestEffortChanged_() {
    if (this.model_.hasBestEffortThreads()) {
      this.bestEffortButton_.textContent = `Triage best effort threads`;
      this.bestEffortButton_.style.display = '';
    } else {
      this.bestEffortButton_.style.display = 'none';
    }
  }

  private getSelectedThreads_() {
    let selected: Thread[] = [];
    let rows = this.getRows_();
    let firstUnselectedRowAfterSelected = null;
    for (let child of rows) {
      if (child.checked) {
        selected.push(child.thread);
      } else if (!firstUnselectedRowAfterSelected && selected.length) {
        firstUnselectedRowAfterSelected = child;
      }
    }
    return {
      selected: selected,
          firstUnselectedRowAfterSelected: firstUnselectedRowAfterSelected,
    }
  }

  setFocus(row: ThreadRow|null) {
    if (this.focusedRow_) {
      this.focusedRow_.focused = false;
      this.focusedRow_.updateHighlight_();
    }

    this.focusedRow_ = row;
    if (!this.focusedRow_)
      return;

    this.focusedRow_.focused = true;
    this.focusedRow_.updateHighlight_();
    this.focusedRow_.scrollIntoView({'block': 'nearest'});
  }

  moveFocus(action: any) {
    let rows = this.getRows_();
    if (!rows.length)
      return;

    if (this.focusedRow_ == null) {
      switch (action) {
        case NEXT_EMAIL_ACTION:
        case NEXT_QUEUE_ACTION: {
          this.setFocus(rows[0]);
          break;
        }
        case PREVIOUS_EMAIL_ACTION: {
          this.setFocus(rows[rows.length - 1]);
          break;
        }
        case PREVIOUS_QUEUE_ACTION: {
          let lastGroup = rows[rows.length - 1].getGroup();
          this.focusFirstRowOfGroup_(lastGroup);
          break;
        }
      }
      return;
    }
    switch (action) {
      case NEXT_EMAIL_ACTION: {
        const nextRow = rowAtOffset(rows, this.focusedRow_, 1);
        if (nextRow)
          this.setFocus(nextRow);
        break;
      }
      case PREVIOUS_EMAIL_ACTION: {
        const previousRow = rowAtOffset(rows, this.focusedRow_, -1);
        if (previousRow)
          this.setFocus(previousRow);
        break;
      }
      case NEXT_QUEUE_ACTION: {
        let currentGroup = this.focusedRow_.getGroup();
        this.focusFirstRowOfGroup_(
            <ThreadRowGroup>currentGroup.nextElementSibling);
        break;
      }
      case PREVIOUS_QUEUE_ACTION: {
        let currentGroup = this.focusedRow_.getGroup();
        this.focusFirstRowOfGroup_(
            <ThreadRowGroup>currentGroup.previousElementSibling);
        break;
      }
    }
  }

  focusFirstRowOfGroup_(group: ThreadRowGroup) {
    if (!group)
      return;
    let firstRow = <ThreadRow>group.querySelector('mt-thread-row');
    this.setFocus(firstRow);
  }

  async takeAction(action: Action) {
    if (action == UNDO_ACTION) {
      this.model_.undoLastAction_();
      return;
    }
    if (action == QUICK_REPLY_ACTION) {
      await this.showQuickReply();
      return;
    }
    if (action == NEXT_EMAIL_ACTION || action == PREVIOUS_EMAIL_ACTION) {
      this.moveFocus(action);
      return;
    }
    if (action == TOGGLE_FOCUSED_ACTION) {
      // If nothing is focused, pretend the first email was focused.
      if (!this.focusedRow_)
        this.moveFocus(NEXT_EMAIL_ACTION);
      if (!this.focusedRow_)
        return;

      this.focusedRow_.checked = !this.focusedRow_.checked;
      this.focusedRow_.updateHighlight_();
      this.moveFocus(NEXT_EMAIL_ACTION);
      return;
    }
    if (action == TOGGLE_QUEUE_ACTION) {
      // If nothing is focused, pretend the first email was focused.
      if (!this.focusedRow_)
        this.moveFocus(NEXT_EMAIL_ACTION);
      if (!this.focusedRow_)
        return;
      const checking = !this.focusedRow_.checked;

      let rows = this.focusedRow_.getGroup().getRows();
      for (let row of rows) {
        row.checked = checking;
        row.updateHighlight_();
      }
    }
    if (action == NEXT_QUEUE_ACTION) {
      this.moveFocus(action);
      return;
    }
    if (action == PREVIOUS_QUEUE_ACTION) {
      this.moveFocus(action);
      return;
    }
    if (action == TOGGLE_QUEUE_ACTION) {
      return;
    }
    if (action == VIEW_TRIAGE_ACTION) {
      this.transitionToThreadList_(this.renderedRow_);
      return;
    }
    if (action == VIEW_FOCUSED_ACTION) {
      if (!this.focusedRow_)
        this.moveFocus(NEXT_EMAIL_ACTION);
      if (!this.focusedRow_)
        return;
      this.renderOne_(this.focusedRow_);
      return;
    }

    if (action.destination === undefined)
      throw 'This should never happen.';
    await this.markTriaged(action.destination);
  }

  transitionToThreadList_(focusedEmail: ThreadRow|null) {
    this.showBackArrow_(false);

    this.rowGroupContainer_.style.display = 'flex';
    this.singleThreadContainer_.textContent = '';
    this.scrollContainer_.scrollTop = this.scrollOffset_ || 0;

    this.setFocus(focusedEmail);
    this.setRenderedRow_(null);
    this.setSubject_('');
    this.updateActions_();

    this.renderThreadList_();
  }

  transitionToSingleThread_() {
    this.showBackArrow_(true);

    this.scrollOffset_ = this.scrollContainer_.scrollTop;
    this.rowGroupContainer_.style.display = 'none';
  }

  async markTriaged(
      destination: string|null, expectedNewMessageCount?: number) {
    if (this.renderedRow_) {
      this.model_.markSingleThreadTriaged(
          this.renderedRow_.thread, destination, expectedNewMessageCount);
    } else {
      // Update the UI first and then archive one at a time.
      let threads = this.getSelectedThreads_();
      this.updateTitle(
          'archiving', `Archiving ${threads.selected.length} threads...`);

      // Move focus to the first unselected email.
      // If we aren't able to find an unselected email,
      // focusedEmail_ should end up null.
      if (this.focusedRow_ &&
          threads.selected.includes(this.focusedRow_.thread))
        this.setFocus(threads.firstUnselectedRowAfterSelected);
      this.model_.markThreadsTriaged(
          threads.selected, destination, expectedNewMessageCount);
    }
  }

  setRenderedRow_(row: ThreadRow|null) {
    if (this.renderedRow_)
      this.renderedRow_.removeRendered();
    this.renderedRow_ = row;
  }

  renderOne_(row: ThreadRow) {
    if (this.rowGroupContainer_.style.display != 'none')
      this.transitionToSingleThread_();

    this.setRenderedRow_(row);

    let thread = row.thread;
    let messages = thread.getMessagesSync();
    let viewInGmailButton = new ViewInGmailButton();
    viewInGmailButton.setMessageId(messages[messages.length - 1].id);
    viewInGmailButton.style.display = 'inline-flex';

    let subject = thread.getSubjectSync();
    let subjectText = document.createElement('div');
    subjectText.style.flex = '1';
    subjectText.append(subject, viewInGmailButton);
    this.setSubject_(subjectText, this.model_.getGroupName(thread));

    if (!this.renderedRow_)
      throw 'Something went wrong. This should never happen.';

    let dom = row.render(this.singleThreadContainer_);
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
    // Make sure that there's at least 50px of space above for showing that
    // there's a previous message.
    let y = elementToScrollTo.getBoundingClientRect().top;
    if (y < 70)
      document.documentElement!.scrollTop -= 70 - y;

    // Check if new messages have come in since we last fetched from the
    // network. Intentionally don't await this since we don't want to
    // make renderOne_ async and it's not important that we prevent the
    // prerenderNext from starting till this is done.
    this.renderedRow_.update();

    // Intentionally don't await this so other work can proceed.
    this.prerenderNext();
  }

  prerenderNext() {
    // Since the call to prerender is async, the page can go back to the
    // threadlist before this is called.
    if (!this.renderedRow_)
      return;

    let rows = this.getRows_();
    const nextRow = rowAtOffset(rows, this.renderedRow_, 1);
    if (nextRow)
      this.prerenderRow_(nextRow);
  }

  private prerenderRow_(row: ThreadRow) {
    if (row == this.renderedRow_)
      throw 'Cannot prerender the currently rendered row.';
    let dom = row.render(this.singleThreadContainer_);
    dom.style.bottom = '0';
    dom.style.visibility = 'hidden';
  }

  showQuickReply() {
    let container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
    `;

    let compose = new EmailCompose(this.contacts_, true, true);
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

    compose.addEventListener('submit', async () => {
      let textLength = compose.plainText.length;
      if (!textLength)
        return;

      if (textLength > this.allowedReplyLength_) {
        alert(`Email is longer than the allowed length of ${
            this.allowedReplyLength_} characters. Allowed length is configurable in the settings spreadsheet as the allowed_reply_length setting.`);
        return;
      }

      if (this.isSending_)
        return;
      this.isSending_ = true;
      this.updateTitle('sendReply', 'Sending reply...');

      if (!this.renderedRow_)
        throw 'Something went wrong. This should never happen.';

      // TODO: Handle if sending fails in such a way that the user can at least
      // save their message text.
      await this.renderedRow_.thread.sendReply(
          compose.value, compose.getEmails(), replyAll.checked);
      this.updateActions_();

      if (ARCHIVE_ACTION.destination !== null)
        throw 'This should never happen.';
      let expectedNewMessageCount = 1;
      await this.markTriaged(
          ARCHIVE_ACTION.destination, expectedNewMessageCount);

      this.updateTitle('sendReply');
      this.isSending_ = false;
    })

    compose.addEventListener('input', () => {
      let textLength = compose.plainText.length;
      progress.value = textLength;
      let lengthDiff = this.allowedReplyLength_ - textLength;
      count.textContent = (lengthDiff < 10) ? String(lengthDiff) : '';
    });

    this.setActions([]);
    this.setFooter(container);

    compose.focus();
  }
}
window.customElements.define('mt-thread-list-view', ThreadListView);
