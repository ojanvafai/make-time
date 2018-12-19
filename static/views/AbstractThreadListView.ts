import { Actions } from '../Actions.js';
import { addThread, fetchThread, fetchThreads } from '../BaseMain.js';
import { Labels } from '../Labels.js';
import { ThreadRow } from './ThreadRow.js';
import { Timer } from '../Timer.js';
import { ViewInGmailButton } from '../ViewInGmailButton.js';
import { MailProcessor } from '../MailProcessor.js';
import { RowGroup } from '../RowGroup.js';
import { Thread } from '../Thread.js';
import { ThreadGroups } from '../ThreadGroups.js';
import { View } from './View.js';
import { EmailCompose } from '../EmailCompose.js';

interface TriageResult {
  newThread: Thread;
  thread: Thread;
  removed: string[];
  added: string[];
}

export abstract class AbstractThreadListView extends View {
  updateTitle: any;
  allLabels: Labels;
  private threads_: ThreadGroups;
  private mailProcessor_: MailProcessor;
  private scrollContainer_: HTMLElement;
  private setSubject_: any;
  private showBackArrow_: any;
  private allowedReplyLength_: number;
  private contacts_: any;
  private autoStartTimer_: boolean;
  private countDown_: boolean;
  private timerDuration_: number;
  private overflowActions_: any[] | undefined;
    // TODO: Rename this to groupedRows_?
  private groupedThreads_: RowGroup[];
  private needsProcessingThreads_: Thread[];
  private focusedEmail_: any;
  private rowGroupContainer_: HTMLElement;
  private singleThreadContainer_: HTMLElement;
  private bestEffortButton_: HTMLElement;
  private actions_: Actions | null = null;
  private tornDown_: boolean | undefined;
  private renderedRow_: ThreadRow | undefined;
  private undoableActions_!: TriageResult[];
  private scrollOffset_: number | undefined;
  private isSending_: boolean | undefined;

  static ACTIONS_ = [
    Actions.ARCHIVE_ACTION,
    Actions.BLOCKED_ACTION,
    Actions.MUTE_ACTION,
    Actions.MUST_DO_ACTION,
    Actions.URGENT_ACTION,
    Actions.NOT_URGENT_ACTION,
    Actions.NEEDS_FILTER_ACTION,
    Actions.UNDO_ACTION,
  ];

  static RENDER_ALL_ACTIONS_ = [
    Actions.PREVIOUS_EMAIL_ACTION,
    Actions.NEXT_EMAIL_ACTION,
    Actions.TOGGLE_FOCUSED_ACTION,
    Actions.VIEW_FOCUSED_ACTION,
  ].concat(AbstractThreadListView.ACTIONS_);

  static RENDER_ONE_ACTIONS_ = [
    Actions.QUICK_REPLY_ACTION,
    Actions.VIEW_TRIAGE_ACTION,
  ].concat(AbstractThreadListView.ACTIONS_);

  constructor(threads: ThreadGroups, allLabels: Labels, mailProcessor: MailProcessor, scrollContainer: HTMLElement, updateTitleDelegate: any, setSubject: any, showBackArrow: any, allowedReplyLength: number, contacts: any, autoStartTimer: boolean, countDown: boolean, timerDuration: number, opt_overflowActions?: any[]) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    this.threads_ = threads;
    this.allLabels = allLabels;
    this.mailProcessor_ = mailProcessor;
    this.scrollContainer_ = scrollContainer;
    this.updateTitle = updateTitleDelegate;
    this.setSubject_ = setSubject;
    this.showBackArrow_ = showBackArrow;
    this.allowedReplyLength_ = allowedReplyLength;
    this.contacts_ = contacts;
    this.autoStartTimer_ = autoStartTimer;
    this.countDown_ = countDown;
    this.timerDuration_ = timerDuration;
    this.overflowActions_ = opt_overflowActions;

    // TODO: Rename this to groupedRows_?
    this.groupedThreads_ = [];
    this.needsProcessingThreads_ = [];

    this.focusedEmail_ = null;

    this.rowGroupContainer_ = document.createElement('div');
    this.rowGroupContainer_.style.cssText = `
      display: flex;
      flex-direction: column;
    `;
    this.append(this.rowGroupContainer_);

    this.rowGroupContainer_.addEventListener('renderThread', (e: Event) => {
      this.renderOne_(<ThreadRow> e.target);
    })

    this.singleThreadContainer_ = document.createElement('div');
    this.singleThreadContainer_.style.cssText = `
      position: relative;
    `;
    this.append(this.singleThreadContainer_);

    this.bestEffortButton_ = this.appendButton('/best-effort');
    this.bestEffortButton_.style.display = 'none';
    this.updateBestEffort_();

    this.updateActions_();

    this.resetUndoableActions_();
  }

  abstract async fetch(shouldBatch?: boolean): Promise<void>;
  abstract async getDisplayableQueue(thread: Thread): Promise<string>;
  abstract compareRowGroups(a: any, b: any): number;
  abstract handleUndo(thread: Thread): void;
  abstract handleTriaged(destination: string | null, triageResult: any, thread: Thread): void;

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

    for (let group of this.groupedThreads_) {
      group.mark();
    }

    await this.fetch(true);
    await this.renderThreadList_();

    for (let group of this.groupedThreads_) {
      let rows = group.getMarked();
      for (let row of rows) {
        await this.removeRow_(row);
      }
    }
  }

  async fetchLabels(labels: string[], shouldBatch?: boolean) {
    if (!labels.length)
      return;

    if (shouldBatch) {
      await fetchThreads(this.processThread.bind(this), {
        query: `in:${labels.join(' OR in:')}`,
      });
    } else {
      for (let label of labels) {
        await fetchThreads(this.processThread.bind(this), {
          query: `in:${label}`,
        });
      }
    }

    await this.processThreads_();
  }

  async findRow_(thread: Thread) {
    let queue = await this.getDisplayableQueue(thread);
    let group = this.getRowGroup_(queue);
    if (group)
      return group.getRow(thread);
    return null;
  }

  updateActions_() {
    let footer = <HTMLElement>document.getElementById('footer');
    footer.textContent = '';
    let actions = this.renderedRow_ ? AbstractThreadListView.RENDER_ONE_ACTIONS_ : AbstractThreadListView.RENDER_ALL_ACTIONS_;
    this.actions_ = new Actions(this, actions, this.overflowActions_);
    footer.append(this.actions_);
    if (this.renderedRow_) {
      let timer = new Timer(this.autoStartTimer_, this.countDown_, this.timerDuration_, this.singleThreadContainer_);
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

  async processThread(thread: Thread) {
    let processedId = await this.allLabels.getId(Labels.PROCESSED_LABEL);
    let messages = await thread.getMessages();
    let lastMessage = messages[messages.length - 1];

    // Since processing threads is destructive (e.g. it removes priority labels),
    // only process threads in the inbox or with the unprocessed label. Otherwise,
    // they might be threads that are prioritized, but lack the processed label for some reason.
    if (!lastMessage.getLabelIds().includes(processedId) &&
        (thread.isInInbox() || (await thread.getLabelNames()).has(Labels.UNPROCESSED_LABEL))) {
      this.needsProcessingThreads_.push(thread);
      return;
    }

    // TODO: Don't use the global addThread.
    await addThread(thread);
  }

  async processThreads_() {
    let threads = this.needsProcessingThreads_.concat();
    this.needsProcessingThreads_ = [];
    await this.mailProcessor_.processThreads(threads);
  }

  getRowGroup_(queue: string) {
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

    // Ensure the row group nodes are in sorted order.
    let groups = Array.prototype.slice.call(this.groupedThreads_);
    for (var i = 0; i < groups.length; i++) {
      let newNode = groups[i].node;
      let oldNode = this.rowGroupContainer_.children[i];
      if (!oldNode) {
        this.rowGroupContainer_.append(newNode);
      } else if (newNode != oldNode) {
        oldNode.before(newNode);
      }
    }

    for (let group of this.groupedThreads_) {
      let newIdToRow: any = {};
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
      let newRowsLeft: ThreadRow[] = Object.values(newIdToRow);
      for (let row of newRowsLeft) {
        group.node.push(row);
      }
    }
  }

  async addThread(thread: Thread) {
    if (this.tornDown_)
      return;

    let queue = await this.getDisplayableQueue(thread);
    let group = this.getRowGroup_(queue);
    if (!group) {
      group = RowGroup.create(queue);
      this.groupedThreads_.push(group);
      this.groupedThreads_.sort(this.compareRowGroups.bind(this));
    }
    group.push(thread);

    // TODO: debounce this or something.
    await this.renderThreadList_();
  }

  clearBestEffort() {
    this.threads_.setBestEffort([]);
  }

  pushBestEffort() {
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
    let selected: ThreadRow[] = [];
    let all: Thread[] = [];
    let rows = <NodeListOf<ThreadRow>> this.rowGroupContainer_.querySelectorAll('mt-thread-row');
    for (let child of rows) {
      if (child.checked)
        selected.push(child);
      all.push(child.thread);
    }
    return {
      selectedRows: selected,
      allThreads: all,
    }
  }

  getRowFromRelativeOffset(row: ThreadRow, offset: number) {
    if (offset != -1 && offset != 1)
      throw `getRowFromRelativeOffset called with offset of ${offset}`

    let nextRow = row.group.getRowFromRelativeOffset(row, offset);
    if (nextRow)
      return nextRow;

    let groupIndex = this.groupedThreads_.indexOf(row.group);
    if (groupIndex == -1)
      throw `Tried to get row via relative offset on a group that's not in the tree.`;

    if (0 <= groupIndex + offset && groupIndex + offset < this.groupedThreads_.length) {
      const rows = this.groupedThreads_[groupIndex + offset].getRows();
      if (offset > 0) {
        return rows[0];
      } else {
        return rows[rows.length - 1];
      }
    }

    // Satisfy TypeScript that returning undefined here is intentional.
    return;
  }

  getNextRow(row: ThreadRow) {
    return this.getRowFromRelativeOffset(row, 1);
  }

  getPreviousRow(row: ThreadRow) {
    return this.getRowFromRelativeOffset(row, -1);
  }

  async removeThread(thread: Thread) {
    let row = await this.findRow_(thread);
    if (row)
      await this.removeRow_(row);
  }

  async removeRow_(row: ThreadRow) {
    if (this.focusedEmail_ == row) {
      let nextRow = this.getNextRow(row);
      if (nextRow)
        this.setFocus(nextRow);
    }

    let shouldTransitionToThreadList = false;
    if (this.renderedRow_ == row) {
      let nextRow = this.getNextRow(row);
      if (nextRow)
        await this.renderOne_(nextRow);
      else
        shouldTransitionToThreadList = true;
    }

    row.group.delete(row);

    // This has to happen after the delete call since it will render the updated
    // threadlist and the deleted row needs to not be there.
    if (shouldTransitionToThreadList)
      await this.transitionToThreadList_();
  }

  setFocus(email: HTMLElement) {
    if(this.focusedEmail_) {
      this.focusedEmail_.focused = false;
      this.focusedEmail_.updateHighlight_();
    }
    this.focusedEmail_ = email;
    if(!this.focusedEmail_)
      return;
    this.focusedEmail_.focused = true;
    this.focusedEmail_.updateHighlight_();
    this.focusedEmail_.scrollIntoView({"block":"nearest"});
  }

  moveFocus(action: any) {
    if (this.focusedEmail_ == null) {
      if (action == Actions.NEXT_EMAIL_ACTION) {
        this.setFocus(this.groupedThreads_[0].getRows()[0])
      } else {
        const lastThreadGroupRows =
          this.groupedThreads_[this.groupedThreads_.length - 1].getRows();
        this.setFocus(lastThreadGroupRows[lastThreadGroupRows.length - 1]);
      }
      return;
    }
    if (action == Actions.NEXT_EMAIL_ACTION) {
      let nextRow = this.getNextRow(this.focusedEmail_);
      if (nextRow)
        this.setFocus(nextRow);
    } else {
      let previousRow = this.getPreviousRow(this.focusedEmail_);
      if (previousRow)
        this.setFocus(previousRow);
    }
  }

  async takeAction(action: any) {
    if (action == Actions.UNDO_ACTION) {
      this.undoLastAction_();
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
      if(!this.focusedEmail_)
        this.moveFocus(Actions.NEXT_EMAIL_ACTION);
      this.focusedEmail_.checkBox_.checked = !this.focusedEmail_.checkBox_.checked;
      this.focusedEmail_.updateHighlight_();
      this.moveFocus(Actions.NEXT_EMAIL_ACTION);
      return;
    }
    if (action == Actions.VIEW_TRIAGE_ACTION) {
      this.transitionToThreadList_();
      return;
    }
    if (action == Actions.VIEW_FOCUSED_ACTION) {
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

    this.resetUndoableActions_();
    this.setRenderedRow_();
    this.setSubject_('');
    this.updateActions_();

    await this.renderThreadList_();
  }

  transitionToSingleThread_() {
    this.showBackArrow_(true);

    this.scrollOffset_ = this.scrollContainer_.scrollTop;
    this.rowGroupContainer_.style.display = 'none';

    this.resetUndoableActions_();
  }

  async markTriaged(destination: string | null) {
    this.resetUndoableActions_();

    if (this.renderedRow_) {
      // Save this off since removeRow_ changes this.renderedRow_.
      let row = this.renderedRow_;
      await this.removeRow_(row);
      this.markSingleThreadTriaged(row.thread, destination);
    } else {
      // Update the UI first and then archive one at a time.
      let threads = this.getThreads();
      this.updateTitle('archiving', `Archiving ${threads.selectedRows.length} threads...`);

      // Move focus to the first unselected email.
      // TODO - this could easily be faster.
      if (threads.selectedRows.indexOf(this.focusedEmail_) != -1) {
        for (let row of threads.selectedRows) {
          const nextRow = this.getNextRow(row);
          if (nextRow && threads.selectedRows.indexOf(nextRow) == -1) {
            this.setFocus(nextRow);
            break;
          }
        }
      }

      for (let row of threads.selectedRows) {
        await this.removeRow_(row);
      }
      await this.renderThreadList_();

      for (let i = 0; i < threads.selectedRows.length; i++) {
        this.updateTitle('archiving', `Archiving ${i + 1}/${threads.selectedRows.length} threads...`);
        let row = threads.selectedRows[i];
        await this.markSingleThreadTriaged(row.thread, destination);
      }
      this.updateTitle('archiving');
    }
  }

  resetUndoableActions_() {
    this.undoableActions_ = [];
  }

  async markSingleThreadTriaged(thread: Thread, destination: string | null) {
    let triageResult = <TriageResult>(await thread.markTriaged(destination));
    if (triageResult) {
      this.undoableActions_.push(triageResult);
    }
    await this.handleTriaged(destination, triageResult, thread);
  }

  async undoLastAction_() {
    if (!this.undoableActions_ || !this.undoableActions_.length) {
      alert('Nothing left to undo.');
      return;
    }

    let actions = this.undoableActions_;
    this.resetUndoableActions_();

    for (let i = 0; i < actions.length; i++) {
      this.updateTitle('undoLastAction_', `Undoing ${i + 1}/${actions.length}...`);

      let action = actions[i];
      await this.handleUndo(action.newThread);

      await action.thread.modify(action.removed, action.added, true);
      let newThread = await fetchThread(action.thread.id);
      await this.addThread(newThread);

      if (this.renderedRow_) {
        let queue = await this.getDisplayableQueue(newThread);
        let group = <RowGroup>this.getRowGroup_(queue);
        this.renderOne_(group.getRow(newThread));
      }
    }

    this.updateTitle('undoLastAction_');
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

    let queue = await this.getDisplayableQueue(row.thread);
    this.setSubject_(subjectText, queue);

    if (!this.renderedRow_)
      throw 'Something went wrong. This should never happen.'

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
    // Make sure that there's at least 50px of space above for showing that there's a
    // previous message.
    let y = elementToScrollTo.getBoundingClientRect().top;
    if (y < 70)
      document.documentElement!.scrollTop -= 70 - y;

    // Check if new messages have come in since we last fetched from the network.
    await this.renderedRow_.update();

    // Intentionally don't await this so other work can proceed.
    this.prerenderNext();
  }

  async prerenderNext() {
    // Since the call to prerender is async, the page can go back to the threadlist
    // before this is called.
    if (!this.renderedRow_)
      return;

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
        alert(`Email is longer than the allowed length of ${this.allowedReplyLength_} characters. Allowed length is configurable in the settings spreadsheet as the allowed_reply_length setting.`);
        return;
      }

      if (this.isSending_)
        return;
      this.isSending_ = true;
      this.updateTitle('sendReply', 'Sending reply...');

      if (!this.renderedRow_)
        throw 'Something went wrong. This should never happen.';

      // TODO: Handle if sending fails in such a way that the user can at least save their message text.
      await this.renderedRow_.thread.sendReply(compose.value, compose.getEmails(), replyAll.checked);
      this.updateActions_();
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
