import {Action, registerActions} from '../Actions.js';
import {login} from '../BaseMain.js';
import {EmailCompose} from '../EmailCompose.js';
import {Labels} from '../Labels.js';
import {ThreadListModel, UndoEvent} from '../models/ThreadListModel.js';
import {RadialProgress} from '../RadialProgress.js';
import {Thread} from '../Thread.js';
import {Timer} from '../Timer.js';
import {ViewInGmailButton} from '../ViewInGmailButton.js';

import {ThreadRow} from './ThreadRow.js';
import {ThreadRowGroup} from './ThreadRowGroup.js';
import {View} from './View.js';

let rowAtOffset = (rows: ThreadRow[], anchorRow: ThreadRow, offset: number): (
    ThreadRow|null) => {
  if (offset != -1 && offset != 1)
    throw `getRowFromRelativeOffset called with offset of ${offset}`;

  let index = rows.indexOf(anchorRow);
  if (index == -1)
    throw `Tried to get row via relative offset on a row that's not in the dom.`;
  if (0 <= index + offset && index + offset < rows.length)
    return rows[index + offset];
  return null;
};

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
  name: `Quick reply`,
  description: `Give a short reply.`,
};

let BLOCKED_ACTION = {
  name: `Blocked`,
  description:
      `Block on action from someone else. Gets queued to be shown once a week on a day of your choosing via Settings.`,
  destination: Labels.BLOCKED_LABEL,
};

let SPAM_ACTION = {
  name: `Spam`,
  description: `Report spam. Same as reporting spam in gmail.`,
  destination: 'SPAM',
};

let MUTE_ACTION = {
  name: `Mute`,
  description:
      `Like gmail mute, but more aggressive. Will never appear in your inbox again.`,
  destination: Labels.MUTED_LABEL,
};

let NEXT_ROW_ACTION = {
  name: `Next row`,
  description: `Focus the next row.`,
  key: 'j',
  hidden: true,
  repeatable: true,
};

let PREVIOUS_ROW_ACTION = {
  name: `Previous row`,
  description: `Focus the previous row.`,
  key: 'k',
  hidden: true,
  repeatable: true,
};

let TOGGLE_FOCUSED_ACTION = {
  name: `Toggle focused`,
  description: `Toggle whether or not the focused element is selected.`,
  key: ' ',
  hidden: true,
};

let VIEW_FOCUSED_ACTION = {
  name: `View focused`,
  description: `View the focused email.`,
  key: 'Enter',
  hidden: true,
};

let NEXT_QUEUE_ACTION = {
  name: `Next queue`,
  description: `Focus the first email of the next queue.`,
  key: 'n',
  hidden: true,
  repeatable: true,
};

let PREVIOUS_QUEUE_ACTION = {
  name: `Previous queue`,
  description: `Focus the first email of the previous queue.`,
  key: 'p',
  hidden: true,
  repeatable: true,
};

let TOGGLE_QUEUE_ACTION = {
  name: `Toggle queue`,
  description: `Toggle all items in the current queue.`,
  key: 'g',
  hidden: true,
};

let VIEW_THREADLIST_ACTION = {
  name: `View thread list`,
  description: `Go back to the thread list.`,
  key: 'Escape',
  hidden: true,
};

let UNDO_ACTION = {
  name: `Undo`,
  description: `Undoes the last action taken.`,
};

let MUST_DO_ACTION = {
  name: `1: Must do`,
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
  name: `4: Needs filter`,
  description:
      `Needs a new/different filter, but don't want to interrupt triaging to do that now.`,
  destination: Labels.NEEDS_FILTER_LABEL,
};

let BASE_ACTIONS = [
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
  PREVIOUS_ROW_ACTION,
  NEXT_ROW_ACTION,
  PREVIOUS_QUEUE_ACTION,
  NEXT_QUEUE_ACTION,
  TOGGLE_FOCUSED_ACTION,
  TOGGLE_QUEUE_ACTION,
  VIEW_FOCUSED_ACTION,
];

let RENDER_ONE_ACTIONS = [
  QUICK_REPLY_ACTION,
  VIEW_THREADLIST_ACTION,
];

registerActions('Triage or Todo', [
  ...BASE_ACTIONS,
  ...RENDER_ALL_ACTIONS,
  ...RENDER_ONE_ACTIONS,
]);

export class ThreadListView extends View {
  private modelListeners_: ListenerData[];
  private threadToRow_: WeakMap<Thread, ThreadRow>;
  private focusedRow_: ThreadRow|null;
  private rowGroupContainer_: HTMLElement;
  private singleThreadContainer_: HTMLElement;
  private bestEffortButton_: HTMLElement;
  private renderedRow_: ThreadRow|null;
  private scrollOffset_: number|undefined;
  private isSending_: boolean|undefined;
  private hasQueuedFrame_: boolean;
  private hasNewRenderedRow_: boolean;
  private isAutoFocusFirstRow_: boolean;

  constructor(
      private model_: ThreadListModel, public allLabels: Labels,
      private scrollContainer_: HTMLElement,
      public updateTitle:
          (key: string, count: number,
           ...title: (HTMLElement|string)[]) => RadialProgress,
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
    this.threadToRow_ = new WeakMap();
    this.focusedRow_ = null;
    this.renderedRow_ = null;
    this.hasQueuedFrame_ = false;
    this.hasNewRenderedRow_ = false;
    this.isAutoFocusFirstRow_ = false;

    this.rowGroupContainer_ = document.createElement('div');
    this.rowGroupContainer_.style.cssText = `
      display: flex;
      flex-direction: column;
    `;
    this.append(this.rowGroupContainer_);

    this.rowGroupContainer_.addEventListener('renderThread', (e: Event) => {
      this.setRenderedRow_(<ThreadRow>e.target);
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

    this.addListenerToModel('thread-list-changed', this.render_.bind(this));
    this.addListenerToModel(
        'best-effort-changed', this.handleBestEffortChanged_.bind(this));
    this.addListenerToModel('undo', (e: Event) => {
      let undoEvent = <UndoEvent>e;
      this.handleUndo_(undoEvent.thread);
    });
  }

  private getThreadRow_(thread: Thread) {
    let row = this.threadToRow_.get(thread);
    if (!row) {
      row = new ThreadRow(thread);
      this.threadToRow_.set(thread, row);
    }
    return row;
  };

  addListenerToModel(eventName: string, handler: (e: Event) => void) {
    this.modelListeners_.push({
      name: eventName,
      handler: handler,
    });
    this.model_.addEventListener(eventName, handler);
  }

  private handleUndo_(thread: Thread) {
    if (this.renderedRow_)
      this.setRenderedRow_(this.getThreadRow_(thread));
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
      await this.renderedRow_.rendered.update();
  }

  updateActions_() {
    if (this.renderedRow_) {
      this.setActions([...RENDER_ONE_ACTIONS, ...BASE_ACTIONS]);
      this.addToFooter(new Timer(
          this.autoStartTimer_, this.countDown_, this.timerDuration_,
          this.singleThreadContainer_));
    } else {
      this.setActions([...RENDER_ALL_ACTIONS, ...BASE_ACTIONS]);
    }
  }

  shouldSuppressActions() {
    return false;
  }

  private render_() {
    if (this.hasQueuedFrame_)
      return;
    this.hasQueuedFrame_ = true;
    requestAnimationFrame(this.renderFrame_.bind(this));
  }

  getRows_() {
    return <ThreadRow[]>Array.from(
        this.rowGroupContainer_.querySelectorAll('mt-thread-row'));
  }

  getFirstRow_() {
    return <ThreadRow>this.rowGroupContainer_.querySelector('mt-thread-row');
  }

  private renderFrame_() {
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
      currentGroup.push(this.getThreadRow_(thread));
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
          this.setRenderedRowInternal_(nextRow);
        else
          this.transitionToThreadList_(null);
      } else {
        // Intentionally call even if nextRow is null to clear out the focused
        // row if there's nothing left to focus.
        this.setFocus(nextRow);
      }
    }

    if (!this.renderedRow_ && (!this.focusedRow_ || this.isAutoFocusFirstRow_))
      this.setFocus(newRows[0], true);

    if (this.hasNewRenderedRow_)
      this.renderOne_();
    this.prerender_();
  }

  private prerender_() {
    let row;
    if (this.renderedRow_) {
      row = rowAtOffset(this.getRows_(), this.renderedRow_, 1);
      if (row == this.renderedRow_)
        throw 'This should never happen.';
    } else {
      row = this.focusedRow_;
    }

    if (!row)
      return;

    let rendered = row.rendered;
    rendered.render();
    rendered.style.bottom = '0';
    rendered.style.visibility = 'hidden';
    this.singleThreadContainer_.append(rendered);
  }

  handleBestEffortChanged_() {
    if (this.model_.hasBestEffortThreads()) {
      this.bestEffortButton_.textContent = `Triage best effort threads`;
      this.bestEffortButton_.style.display = '';
    } else {
      this.bestEffortButton_.style.display = 'none';
    }
  }

  setFocus(row: ThreadRow|null, isAutoFocusFirstRow?: boolean) {
    this.isAutoFocusFirstRow_ = !!isAutoFocusFirstRow;

    if (this.focusedRow_)
      this.focusedRow_.focused = false;

    this.focusedRow_ = row;
    if (!this.focusedRow_)
      return;

    this.focusedRow_.focused = true;

    // Don't want autofocusing to scroll the view.
    if (!isAutoFocusFirstRow)
      this.focusedRow_.scrollIntoView({'block': 'nearest'});
  }

  moveFocus(action: any) {
    let rows = this.getRows_();
    if (!rows.length)
      return;

    if (this.focusedRow_ == null) {
      switch (action) {
        case NEXT_ROW_ACTION:
        case NEXT_QUEUE_ACTION: {
          this.setFocus(rows[0]);
          break;
        }
        case PREVIOUS_ROW_ACTION: {
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
      case NEXT_ROW_ACTION: {
        const nextRow = rowAtOffset(rows, this.focusedRow_, 1);
        if (nextRow)
          this.setFocus(nextRow);
        break;
      }
      case PREVIOUS_ROW_ACTION: {
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
    if (action == NEXT_ROW_ACTION || action == PREVIOUS_ROW_ACTION) {
      this.moveFocus(action);
      return;
    }
    if (action == TOGGLE_FOCUSED_ACTION) {
      // If nothing is focused, pretend the first email was focused.
      if (!this.focusedRow_)
        this.moveFocus(NEXT_ROW_ACTION);
      if (!this.focusedRow_)
        return;

      this.focusedRow_.checked = !this.focusedRow_.checked;
      this.moveFocus(NEXT_ROW_ACTION);
      return;
    }
    if (action == TOGGLE_QUEUE_ACTION) {
      // If nothing is focused, pretend the first email was focused.
      if (!this.focusedRow_)
        this.moveFocus(NEXT_ROW_ACTION);
      if (!this.focusedRow_)
        return;
      const checking = !this.focusedRow_.checked;

      let rows = this.focusedRow_.getGroup().getRows();
      for (let row of rows) {
        row.checked = checking;
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
    if (action == VIEW_THREADLIST_ACTION) {
      this.transitionToThreadList_(this.renderedRow_);
      return;
    }
    if (action == VIEW_FOCUSED_ACTION) {
      if (!this.focusedRow_)
        this.moveFocus(NEXT_ROW_ACTION);
      if (!this.focusedRow_)
        return;
      this.setRenderedRow_(this.focusedRow_);
      return;
    }

    if (action.destination === undefined)
      throw 'This should never happen.';
    await this.markTriaged_(action.destination);
  }

  transitionToThreadList_(focusedRow: ThreadRow|null) {
    this.showBackArrow_(false);

    this.rowGroupContainer_.style.display = 'flex';
    this.singleThreadContainer_.textContent = '';
    this.scrollContainer_.scrollTop = this.scrollOffset_ || 0;

    this.setFocus(focusedRow);
    this.setRenderedRow_(null);
    this.setSubject_('');
    this.updateActions_();

    this.render_();
  }

  transitionToSingleThread_() {
    this.showBackArrow_(true);

    this.scrollOffset_ = this.scrollContainer_.scrollTop;
    this.rowGroupContainer_.style.display = 'none';
  }

  private async markTriaged_(
      destination: string|null, expectedNewMessageCount?: number) {
    if (this.renderedRow_) {
      await this.model_.markSingleThreadTriaged(
          this.renderedRow_.thread, destination, expectedNewMessageCount);
    } else {
      let threads: Thread[] = [];
      let firstUnselectedRowAfterFocused = null;
      let focusedRowIsSelected = false;

      let rows = this.getRows_();
      for (let child of rows) {
        if (child.checked) {
          if (child == this.focusedRow_)
            focusedRowIsSelected = true;
          threads.push(child.thread);
          // ThreadRows get recycled, so clear the checked and focused state for
          // future use.
          child.resetState();
        } else if (focusedRowIsSelected && !firstUnselectedRowAfterFocused) {
          firstUnselectedRowAfterFocused = child;
        }
      }

      // Move focus to the first unselected email. If we aren't able to find an
      // unselected email, focusedEmail_ should end up null, so set it even if
      // firstUnselectedRowAfterSelected is null.
      if (focusedRowIsSelected)
        this.setFocus(firstUnselectedRowAfterFocused);

      await this.model_.markThreadsTriaged(
          threads, destination, expectedNewMessageCount);
    }
  }

  setRenderedRowInternal_(row: ThreadRow|null) {
    this.hasNewRenderedRow_ = !!row;
    if (this.renderedRow_)
      this.renderedRow_.rendered.remove();
    this.renderedRow_ = row;
  }

  setRenderedRow_(row: ThreadRow|null) {
    this.setRenderedRowInternal_(row);
    if (row)
      this.render_();
  }

  renderOne_() {
    if (this.renderedRow_ === null)
      throw 'This should never happen.';

    if (this.rowGroupContainer_.style.display != 'none')
      this.transitionToSingleThread_();

    let thread = this.renderedRow_.thread;
    let messages = thread.getMessagesSync();
    let viewInGmailButton = new ViewInGmailButton();
    viewInGmailButton.setMessageId(messages[messages.length - 1].id);
    viewInGmailButton.style.display = 'inline-flex';

    let subject = thread.getSubjectSync();
    let subjectText = document.createElement('div');
    subjectText.style.flex = '1';
    subjectText.append(subject, viewInGmailButton);
    this.setSubject_(subjectText, this.model_.getGroupName(thread));

    let rendered = this.renderedRow_.rendered;
    if (rendered.isRendered() &&
        rendered.parentNode != this.singleThreadContainer_)
      throw 'Tried to rerender already rendered thread. This should never happen.';

    if (rendered.isRendered()) {
      rendered.style.bottom = '';
      rendered.style.visibility = 'visible';
    } else {
      this.renderedRow_.rendered.render();
      this.singleThreadContainer_.append(rendered);
    }

    this.updateActions_();

    var elementToScrollTo = rendered.querySelector('.unread');
    if (!elementToScrollTo) {
      let messageNodes = rendered.querySelectorAll('.message');
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
    // make renderOne_ async.
    this.renderedRow_.rendered.update();
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
    compose.placeholder =
        'Hit <enter> to send, <esc> to cancel. Allowed length is configurable in Settings.';
    container.append(compose);

    let onClose = this.updateActions_.bind(this);

    let cancel = document.createElement('button');
    cancel.textContent = 'cancel';
    cancel.onclick = onClose;
    container.append(cancel);

    compose.addEventListener('cancel', onClose);

    let sideBar = document.createElement('div');
    sideBar.style.cssText = `margin: 4px;`;

    let topBar = document.createElement('div');
    topBar.style.cssText = 'display: flex';

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

    let progress = new RadialProgress(true);
    progress.addToTotal(this.allowedReplyLength_);

    let count = document.createElement('div');
    count.style.cssText = `
      margin: 4px;
      color: red;
    `;

    progressContainer.append(count, progress);
    topBar.append(replyAllLabel, progressContainer);

    let postSendActions = document.createElement('select');
    let actionList = [
      ARCHIVE_ACTION, BLOCKED_ACTION, MUST_DO_ACTION, URGENT_ACTION,
      BACKLOG_ACTION, NEEDS_FILTER_ACTION
    ];
    for (let action of actionList) {
      let option = document.createElement('option');
      option.textContent = action.name;
      // Convert to string since the archive action is null.
      option.value = String(action.destination);
      postSendActions.append(option);
    }

    sideBar.append(topBar, postSendActions);
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
      let progress =
          this.updateTitle('ThreadListView.sendReply', 1, 'Sending reply...');

      if (!this.renderedRow_)
        throw 'Something went wrong. This should never happen.';

      let destination: string|null = postSendActions.selectedOptions[0].value;
      // Sigh. HTMLOptionElement.value returns the text content of the option if
      // there's no value set on the option. So we need to set "null" as a
      // string and then convert it back to proper null here.
      if (destination === 'null')
        destination = null;

      // TODO: Handle if sending fails in such a way that the user can at least
      // save their message text.
      await this.renderedRow_.thread.sendReply(
          compose.value, compose.getEmails(), replyAll.checked);
      this.updateActions_();

      let expectedNewMessageCount = 1;
      await this.markTriaged_(destination, expectedNewMessageCount);

      progress.incrementProgress();
      this.isSending_ = false;
    })

    compose.addEventListener('input', () => {
      let textLength = compose.plainText.length;
      progress.setProgress(textLength);
      let lengthDiff = this.allowedReplyLength_ - textLength;
      count.textContent = (lengthDiff < 10) ? String(lengthDiff) : '';
    });

    this.setActions([]);
    this.setFooter(container);

    compose.focus();
  }
}
window.customElements.define('mt-thread-list-view', ThreadListView);
