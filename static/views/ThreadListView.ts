import {Actions} from '../Actions.js';
import {EmailCompose} from '../EmailCompose.js';
import {Labels} from '../Labels.js';
import {ThreadListModel, ThreadRemovedEvent, UndoEvent} from '../models/ThreadListModel.js';
import {Thread} from '../Thread.js';
import {Timer} from '../Timer.js';
import {ViewInGmailButton} from '../ViewInGmailButton.js';

import {ThreadRow} from './ThreadRow.js';
import {View} from './View.js';

export class ThreadListView extends View {
  private focusedEmail_: ThreadRow|null;
  private rowGroupContainer_: HTMLElement;
  private singleThreadContainer_: HTMLElement;
  private bestEffortButton_: HTMLElement;
  private actions_: Actions|null = null;
  private tornDown_: boolean|undefined;
  private renderedRow_: ThreadRow|undefined;
  private scrollOffset_: number|undefined;
  private isSending_: boolean|undefined;

  static ACTIONS_ = [
    Actions.ARCHIVE_ACTION,
    Actions.BLOCKED_ACTION,
    Actions.MUTE_ACTION,
    Actions.MUST_DO_ACTION,
    Actions.URGENT_ACTION,
    Actions.BACKLOG_ACTION,
    Actions.NEEDS_FILTER_ACTION,
    Actions.SPAM_ACTION,
    Actions.UNDO_ACTION,
  ];

  static RENDER_ALL_ACTIONS_ = [
    Actions.PREVIOUS_EMAIL_ACTION,
    Actions.NEXT_EMAIL_ACTION,
    Actions.PREVIOUS_QUEUE_ACTION,
    Actions.NEXT_QUEUE_ACTION,
    Actions.TOGGLE_FOCUSED_ACTION,
    Actions.TOGGLE_QUEUE_ACTION,
    Actions.VIEW_FOCUSED_ACTION,
  ].concat(ThreadListView.ACTIONS_);

  static RENDER_ONE_ACTIONS_ = [
    Actions.QUICK_REPLY_ACTION,
    Actions.VIEW_TRIAGE_ACTION,
  ].concat(ThreadListView.ACTIONS_);

  constructor(
      private model_: ThreadListModel, public allLabels: Labels,
      private scrollContainer_: HTMLElement, public updateTitle: any,
      private setSubject_: any, private showBackArrow_: any,
      private allowedReplyLength_: number, private contacts_: any,
      private autoStartTimer_: boolean, private countDown_: boolean,
      private timerDuration_: number, bottomButtonUrl: string,
      bottomButtonText: string) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    this.focusedEmail_ = null;

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

    this.model_.addEventListener(
        'thread-list-changed', this.handleThreadListChanged_.bind(this));
    this.model_.addEventListener(
        'best-effort-changed', this.handleBestEffortChanged_.bind(this));
    this.model_.addEventListener('thread-removed', (e: Event) => {
      let threadRemovedEvent = <ThreadRemovedEvent>e;
      this.handleThreadRemoved_(
          threadRemovedEvent.row, threadRemovedEvent.nextRow);
    });
    this.model_.addEventListener('undo', (e: Event) => {
      let undoEvent = <UndoEvent>e;
      this.handleUndo_(undoEvent.thread);
    });
  }

  getModel() {
    return this.model_;
  }

  private async handleThreadListChanged_() {
    if (this.tornDown_)
      return;
    // TODO: debounce this or something.
    await this.renderThreadList_();
  }

  private async handleThreadRemoved_(row: ThreadRow, nextRow: ThreadRow|null) {
    if (this.focusedEmail_ == row) {
      // Intentionally call even if nextRow is null to clear out the focused
      // row if there's nothing left to focus.
      this.setFocus(nextRow);
    }

    if (this.renderedRow_ == row) {
      if (nextRow)
        await this.renderOne_(nextRow);
      else
        await this.transitionToThreadList_();
    } else {
      await this.renderThreadList_();
    }
  }

  private async handleUndo_(thread: Thread) {
    if (this.renderedRow_) {
      let row = await this.model_.getRow(thread);
      if (!row)
        throw 'Undo did not create a row for the new thread.';
      this.renderOne_(row);
    }
  }

  appendButton(href: string, textContent = '') {
    let button = document.createElement('a');
    button.className = 'label-button';
    button.href = href;
    button.textContent = textContent;
    this.append(button);
    return button;
  }

  setFooter_(dom: HTMLElement) {
    let footer = <HTMLElement>document.getElementById('footer');
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
      await this.renderedRow_.update();
  }

  async renderFromDisk() {
    await this.model_.loadFromDisk();
  }

  updateActions_() {
    let footer = <HTMLElement>document.getElementById('footer');
    footer.textContent = '';
    let actions = this.renderedRow_ ? ThreadListView.RENDER_ONE_ACTIONS_ :
                                      ThreadListView.RENDER_ALL_ACTIONS_;
    this.actions_ = new Actions(this, actions);
    footer.append(this.actions_);
    if (this.renderedRow_) {
      let timer = new Timer(
          this.autoStartTimer_, this.countDown_, this.timerDuration_,
          this.singleThreadContainer_);
      footer.append(timer);
    }
  }

  async dispatchShortcut(e: KeyboardEvent) {
    if (this.actions_)
      this.actions_.dispatchShortcut(e);
  };

  shouldSuppressActions() {
    return false;
  }

  async renderThreadList_() {
    let rowGroups = this.model_.getRowGroups();

    // Delete empty row groups.
    rowGroups = rowGroups.filter((group) => {
      let hasRows = group.hasRows();
      if (!hasRows) {
        group.node.remove();
        // Clear out the child rows so they don't reappear if the group
        // is shown again, e.g. in the case of archive+undo the last thread
        // in a group.
        group.node.removeChildren();
      }
      return hasRows;
    });

    // Ensure the row group nodes are in sorted order.
    let groups = Array.prototype.slice.call(rowGroups);
    for (var i = 0; i < groups.length; i++) {
      let newNode = groups[i].node;
      let oldNode = this.rowGroupContainer_.children[i];
      if (!oldNode) {
        this.rowGroupContainer_.append(newNode);
      } else if (newNode != oldNode) {
        oldNode.before(newNode);
      }
    }

    for (let group of rowGroups) {
      let rows = await group.getSortedRows();

      let existingRows = group.node.rows();
      let rowsToRemove = existingRows.filter((item) => !rows.includes(item));
      for (let row of rowsToRemove) {
        row.remove();
      }
      group.node.setRows(rows);
    }
  }

  handleBestEffortChanged_() {
    if (this.model_.hasBestEffortThreads()) {
      this.bestEffortButton_.textContent = `Triage best effort threads`;
      this.bestEffortButton_.style.display = '';
    } else {
      this.bestEffortButton_.style.display = 'none';
    }
  }

  getThreads() {
    let selected: ThreadRow[] = [];
    let all: Thread[] = [];
    let rows = <NodeListOf<ThreadRow>>this.rowGroupContainer_.querySelectorAll(
        'mt-thread-row');
    for (let child of rows) {
      if (child.checked)
        selected.push(child);
      all.push(child.thread);
    }
    return {
      selectedRows: selected, allThreads: all,
    }
  }

  setFocus(email: ThreadRow|null) {
    if (this.focusedEmail_) {
      this.focusedEmail_.focused = false;
      this.focusedEmail_.updateHighlight_();
    }

    this.focusedEmail_ = email;
    if (!this.focusedEmail_)
      return;

    this.focusedEmail_.focused = true;
    this.focusedEmail_.updateHighlight_();
    this.focusedEmail_.scrollIntoView({'block': 'nearest'});
  }

  async moveFocus(action: any) {
    let firstGroup = this.model_.getFirstGroup();
    if (!firstGroup)
      return;

    if (this.focusedEmail_ == null) {
      switch (action) {
        case Actions.NEXT_EMAIL_ACTION:
        case Actions.NEXT_QUEUE_ACTION: {
          let rows = await firstGroup.getSortedRows();
          this.setFocus(rows[0]);
          break;
        }
        case Actions.PREVIOUS_EMAIL_ACTION: {
          const lastThreadGroupRows =
              await this.model_.getLastGroup().getSortedRows();
          this.setFocus(lastThreadGroupRows[lastThreadGroupRows.length - 1]);
          break;
        }
        case Actions.PREVIOUS_QUEUE_ACTION: {
          const lastThreadGroupRows =
              await this.model_.getLastGroup().getSortedRows();
          this.setFocus(lastThreadGroupRows[0]);
          break;
        }
      }
      return;
    }
    switch (action) {
      case Actions.NEXT_EMAIL_ACTION: {
        const nextRow = await this.model_.getNextRow(this.focusedEmail_);
        if (nextRow)
          this.setFocus(nextRow);
        break;
      }
      case Actions.PREVIOUS_EMAIL_ACTION: {
        const previousRow =
            await this.model_.getPreviousRow(this.focusedEmail_);
        if (previousRow)
          this.setFocus(previousRow);
        break;
      }
      case Actions.NEXT_QUEUE_ACTION: {
        const nextGroup = this.model_.getNextGroup(this.focusedEmail_.group);
        if (nextGroup)
          this.setFocus(await nextGroup.getFirstRow());
        break;
      }
      case Actions.PREVIOUS_QUEUE_ACTION: {
        const previousGroup =
            this.model_.getPreviousGroup(this.focusedEmail_.group);
        if (previousGroup)
          this.setFocus(await previousGroup.getFirstRow());
        break;
      }
    }
  }

  async takeAction(action: any) {
    if (action == Actions.UNDO_ACTION) {
      this.model_.undoLastAction_();
      return;
    }
    if (action == Actions.QUICK_REPLY_ACTION) {
      await this.showQuickReply();
      return;
    }
    if (action == Actions.NEXT_EMAIL_ACTION ||
        action == Actions.PREVIOUS_EMAIL_ACTION) {
      this.moveFocus(action);
      return;
    }
    if (action == Actions.TOGGLE_FOCUSED_ACTION) {
      // If nothing is focused, pretend the first email was focused.
      if (!this.focusedEmail_)
        this.moveFocus(Actions.NEXT_EMAIL_ACTION);
      if (!this.focusedEmail_)
        return;
      this.focusedEmail_.checked = !this.focusedEmail_.checked;
      this.focusedEmail_.updateHighlight_();
      this.moveFocus(Actions.NEXT_EMAIL_ACTION);
      return;
    }
    if (action == Actions.TOGGLE_QUEUE_ACTION) {
      // If nothing is focused, pretend the first email was focused.
      if (!this.focusedEmail_)
        this.moveFocus(Actions.NEXT_EMAIL_ACTION);
      if (!this.focusedEmail_)
        return;
      const checking = !this.focusedEmail_.checked;

      let rows = await this.focusedEmail_.group.getSortedRows();
      for (let row of rows) {
        row.checked = checking;
        row.updateHighlight_();
      }
    }
    if (action == Actions.NEXT_QUEUE_ACTION) {
      this.moveFocus(action);
      return;
    }
    if (action == Actions.PREVIOUS_QUEUE_ACTION) {
      this.moveFocus(action);
      return;
    }
    if (action == Actions.TOGGLE_QUEUE_ACTION) {
      return;
    }
    if (action == Actions.VIEW_TRIAGE_ACTION) {
      this.transitionToThreadList_();
      return;
    }
    if (action == Actions.VIEW_FOCUSED_ACTION) {
      if (!this.focusedEmail_)
        this.moveFocus(Actions.NEXT_EMAIL_ACTION);
      if (!this.focusedEmail_)
        return;
      this.renderOne_(this.focusedEmail_);
      return;
    }
    await this.markTriaged(action.destination);
  }

  async transitionToThreadList_() {
    this.showBackArrow_(false);

    this.rowGroupContainer_.style.display = 'flex';
    this.singleThreadContainer_.textContent = '';
    this.scrollContainer_.scrollTop = this.scrollOffset_ || 0;

    this.setRenderedRow_();
    this.setSubject_('');
    this.updateActions_();

    await this.renderThreadList_();
  }

  transitionToSingleThread_() {
    this.showBackArrow_(true);

    this.scrollOffset_ = this.scrollContainer_.scrollTop;
    this.rowGroupContainer_.style.display = 'none';
  }

  async markTriaged(destination: string|null) {
    if (this.renderedRow_) {
      this.model_.markSingleThreadTriaged(this.renderedRow_, destination);
    } else {
      // Update the UI first and then archive one at a time.
      let threads = this.getThreads();
      this.updateTitle(
          'archiving', `Archiving ${threads.selectedRows.length} threads...`);

      // Move focus to the first unselected email.
      // If we aren't able to find an unselected email,
      // focusedEmail_ should end up null.
      const previouslyFocused = this.focusedEmail_;
      this.setFocus(null);

      // TODO: Should this throw if previouslyFocused is null? Are there
      // cases where it can be null if a row is being triaged?
      if (previouslyFocused) {
        // TODO - this could easily be faster.
        if (threads.selectedRows.indexOf(previouslyFocused) != -1) {
          for (let row of threads.selectedRows) {
            const nextRow = await this.model_.getNextRow(row);
            if (nextRow && threads.selectedRows.indexOf(nextRow) == -1) {
              this.setFocus(nextRow);
              break;
            }
          }
        }
      }

      this.model_.markThreadsTriaged(threads.selectedRows, destination);
    }
  }

  setRenderedRow_(row?: ThreadRow) {
    if (this.renderedRow_)
      this.renderedRow_.removeRendered();
    this.renderedRow_ = row;
  }

  async renderOne_(row: ThreadRow) {
    if (this.rowGroupContainer_.style.display != 'none')
      this.transitionToSingleThread_();

    this.setRenderedRow_(row);

    let messages = await row.thread.getMessages();
    let viewInGmailButton = new ViewInGmailButton();
    viewInGmailButton.setMessageId(messages[messages.length - 1].id);
    viewInGmailButton.style.display = 'inline-flex';

    let subject = await row.thread.getSubject();
    let subjectText = document.createElement('div');
    subjectText.style.flex = '1';
    subjectText.append(subject, viewInGmailButton);

    let queue = await this.model_.getDisplayableQueue(row.thread);
    this.setSubject_(subjectText, queue);

    if (!this.renderedRow_)
      throw 'Something went wrong. This should never happen.';

    let dom = await this.renderedRow_.render(this.singleThreadContainer_);
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
    // network.
    await this.renderedRow_.update();

    // Intentionally don't await this so other work can proceed.
    this.prerenderNext();
  }

  async prerenderNext() {
    // Since the call to prerender is async, the page can go back to the
    // threadlist before this is called.
    if (!this.renderedRow_)
      return;

    let nextRow = await this.model_.getNextRow(this.renderedRow_);
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

    let compose = new EmailCompose(this.contacts_);
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

      if (Actions.ARCHIVE_ACTION.destination !== null)
        throw 'This should never happen.';
      await this.markTriaged(Actions.ARCHIVE_ACTION.destination);

      this.updateTitle('sendReply');
      this.isSending_ = false;
    })

    compose.addEventListener('input', () => {
      let textLength = compose.plainText.length;
      progress.value = textLength;
      let lengthDiff = this.allowedReplyLength_ - textLength;
      count.textContent = (lengthDiff < 10) ? String(lengthDiff) : '';
    });

    this.setFooter_(container);

    compose.focus();
  }
}

window.customElements.define('mt-thread-list-view', ThreadListView);
