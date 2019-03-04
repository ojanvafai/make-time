import {Action, registerActions} from '../Actions.js';
import {assert, defined, notNull} from '../Base.js';
import {getSendAs, login} from '../BaseMain.js';
import {EmailCompose, SubmitEvent} from '../EmailCompose.js';
import {Labels} from '../Labels.js';
import {ThreadListModel, UndoEvent} from '../models/ThreadListModel.js';
import {RadialProgress} from '../RadialProgress.js';
import {SendAs} from '../SendAs.js';
import {BACKLOG_PRIORITY_NAME, BLOCKED_LABEL_NAME, MUST_DO_PRIORITY_NAME, NEEDS_FILTER_PRIORITY_NAME, ReplyType, URGENT_PRIORITY_NAME} from '../Thread.js';
import {Thread} from '../Thread.js';
import {Timer} from '../Timer.js';
import {ViewInGmailButton} from '../ViewInGmailButton.js';

import {FOCUS_THREAD_ROW_EVENT_NAME, ThreadRow} from './ThreadRow.js';
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
  // TODO: Make this use Labels.ARCHIVE.
  destination: null,
};

let QUICK_REPLY_ACTION = {
  name: `Quick reply`,
  shortName: `Reply`,
  description: `Give a short reply.`,
  key: 'r',
};

let BLOCKED_ACTION = {
  name: BLOCKED_LABEL_NAME,
  description:
      `Block on action from someone else. Shows up once a day to retriage.`,
  destination: Labels.Blocked,
};

let MUTE_ACTION = {
  name: `Mute`,
  description:
      `Like gmail mute, but more aggressive. Will never appear in your inbox again.`,
  destination: Labels.Muted,
};

let NEXT_ROW_ACTION = {
  name: `Next row`,
  description: `Go to the next row/thread.`,
  key: 'j',
  hidden: true,
  repeatable: true,
};

let PREVIOUS_ROW_ACTION = {
  name: `Previous row`,
  description: `Go to the previous row.`,
  key: 'k',
  hidden: true,
  repeatable: true,
};

let TOGGLE_FOCUSED_ACTION = {
  name: `Toggle focused`,
  description: `Toggle whether or not the focused element is selected.`,
  key: ' ',
  hidden: true,
  repeatable: true,
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
  name: MUST_DO_PRIORITY_NAME,
  description: `Must do today. Literally won't go home till it's done.`,
  destination: Labels.MustDo,
  key: '1',
};

let URGENT_ACTION = {
  name: URGENT_PRIORITY_NAME,
  description: `Needs to happen ASAP.`,
  destination: Labels.Urgent,
  key: '2',
};

let BACKLOG_ACTION = {
  name: BACKLOG_PRIORITY_NAME,
  description:
      `Important for achieving my mission, but can be done at leisure.`,
  destination: Labels.Backlog,
  key: '3',
};

let NEEDS_FILTER_ACTION = {
  name: NEEDS_FILTER_PRIORITY_NAME,
  shortName: 'Filter',
  description:
      `Needs a new/different filter, but don't want to interrupt triaging to do that now.`,
  destination: Labels.NeedsFilter,
  key: 'f',
};

let BASE_ACTIONS = [
  ARCHIVE_ACTION,
  BLOCKED_ACTION,
  MUTE_ACTION,
  MUST_DO_ACTION,
  URGENT_ACTION,
  BACKLOG_ACTION,
  NEEDS_FILTER_ACTION,
  UNDO_ACTION,
];

let RENDER_ALL_ACTIONS = [
  PREVIOUS_ROW_ACTION,
  PREVIOUS_QUEUE_ACTION,
  NEXT_ROW_ACTION,
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
  private renderedRow_: ThreadRow|null;
  private autoFocusedRow_: ThreadRow|null;
  private renderedGroupName_: string|null;
  private scrollOffset_: number|undefined;
  private isSending_: boolean|undefined;
  private hasQueuedFrame_: boolean;
  private hasNewRenderedRow_: boolean;
  private sendAs_?: SendAs;

  constructor(
      private model_: ThreadListModel, private scrollContainer_: HTMLElement,
      public updateTitle:
          (key: string, count: number,
           ...title: (HTMLElement|string)[]) => RadialProgress,
      private setSubject_: (...subject: (Node|string)[]) => void,
      private showBackArrow_: (show: boolean) => void,
      private allowedReplyLength_: number, private autoStartTimer_: boolean,
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
    this.autoFocusedRow_ = null;
    this.renderedGroupName_ = null;
    this.hasQueuedFrame_ = false;
    this.hasNewRenderedRow_ = false;

    this.rowGroupContainer_ = document.createElement('div');
    this.rowGroupContainer_.style.cssText = `
      display: flex;
      flex-direction: column;
    `;
    this.append(this.rowGroupContainer_);

    this.rowGroupContainer_.addEventListener('renderThread', (e: Event) => {
      this.setRenderedRow_(<ThreadRow>e.target);
    });

    this.rowGroupContainer_.addEventListener(
        FOCUS_THREAD_ROW_EVENT_NAME, (e: Event) => {
          this.handleFocusRow_(<ThreadRow>e.target);
        });

    this.singleThreadContainer_ = document.createElement('div');
    this.singleThreadContainer_.style.cssText = `
      position: relative;
    `;
    this.append(this.singleThreadContainer_);

    this.appendButton(bottomButtonUrl, bottomButtonText);
    this.updateActions_();

    this.addListenerToModel('thread-list-changed', this.render_.bind(this));
    this.addListenerToModel('undo', (e: Event) => {
      let undoEvent = <UndoEvent>e;
      this.handleUndo_(undoEvent.thread);
    });

    this.render_();
  }

  private getThreadRow_(thread: Thread) {
    let row = this.threadToRow_.get(thread);
    if (!row) {
      row = new ThreadRow(thread, this.model_.showPriorityLabel());
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
    let row = this.getThreadRow_(thread);
    if (this.renderedRow_)
      this.setRenderedRow_(row);
    else
      this.setFocus_(row);
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
    for (let listener of this.modelListeners_) {
      this.model_.removeEventListener(listener.name, listener.handler);
    }
    this.setSubject_('');
    this.showBackArrow_(false);
  }

  async init() {
    await login();
    this.sendAs_ = await getSendAs();
    await this.model_.loadFromDisk();
    await this.model_.update();
  }

  async goBack() {
    this.transitionToThreadList_(this.renderedRow_);
  }

  updateActions_() {
    let actions = this.renderedRow_ ? RENDER_ONE_ACTIONS : RENDER_ALL_ACTIONS;
    this.setActions([...BASE_ACTIONS, ...actions]);
    if (this.renderedRow_)
      this.addTimer_();
  }

  addTimer_() {
    let timer = new Timer(
        this.autoStartTimer_, this.countDown_, this.timerDuration_,
        this.singleThreadContainer_);
    this.addToFooter(timer);
    timer.style.top = `-${timer.offsetHeight}px`;
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

    let toast: HTMLElement|undefined;
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
        if (nextRow) {
          let nextGroupName = this.model_.getGroupName(nextRow.thread);
          if (this.renderedGroupName_ !== nextGroupName)
            toast = this.createToast_(nextGroupName);
          this.setRenderedRowInternal_(nextRow);
        } else {
          this.transitionToThreadList_(null);
        }
      } else {
        // Intentionally call even if nextRow is null to clear out the focused
        // row if there's nothing left to focus.
        this.setFocus_(nextRow);
      }
    }

    if (!this.renderedRow_ && (!this.focusedRow_ || this.autoFocusedRow_)) {
      this.autoFocusedRow_ = newRows[0];
      this.setFocus_(this.autoFocusedRow_);
    }

    if (this.hasNewRenderedRow_) {
      this.hasNewRenderedRow_ = false;
      this.renderOne_(toast);
    }
    // Do this async so it doesn't block putting up the frame.
    setTimeout(() => this.prerender_());
  }

  private prerender_() {
    let row;
    if (this.renderedRow_) {
      row = rowAtOffset(this.getRows_(), this.renderedRow_, 1);
      assert(row !== this.renderedRow_);
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

  private createToast_(nextGroupName: string) {
    let toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 50%;
      right: 0;
      bottom: 0;
      left: 0;
      font-size: 20px;
      opacity: 0.5;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      transition: opacity 0.5s;
      transition-delay: 3s;
      opacity: 0.95;
      pointer-events: none;
    `;
    let text = document.createElement('div');
    text.style.cssText = `
      background-color: black;
      padding: 10px;
      border-radius: 5px;
      border: 1px solid grey;
      color: white;
    `;
    setTimeout(() => defined(toast).style.opacity = '0');
    text.append(`Now triaging: ${nextGroupName}`);
    toast.append(text);
    return toast;
  }

  private setFocus_(row: ThreadRow|null) {
    if (row) {
      let areAnyRowsChecked = this.getRows_().some(x => x.checked);
      let focusImpliesSelected = !areAnyRowsChecked;
      row.setFocus(true, focusImpliesSelected);
    } else {
      this.clearFocus_();
    }
  }

  clearFocus_() {
    this.focusedRow_ = null;
    this.autoFocusedRow_ = null;
  }

  private handleFocusRow_(row: ThreadRow|null) {
    // Once a row gets manually focused, stop auto-focusing.
    if (row !== this.autoFocusedRow_)
      this.autoFocusedRow_ = null;

    if (row === this.focusedRow_)
      return;

    if (this.focusedRow_)
      this.focusedRow_.clearFocus();
    this.focusedRow_ = row;
  }

  private setFocusAndScrollIntoView_(row: ThreadRow|null) {
    this.setFocus_(row);
    if (this.focusedRow_)
      this.focusedRow_.scrollIntoView({'block': 'center'});
  }

  private moveFocus_(action: Action) {
    let rows = this.getRows_();
    if (!rows.length)
      return;

    if (this.focusedRow_ == null) {
      switch (action) {
        case NEXT_ROW_ACTION:
        case NEXT_QUEUE_ACTION: {
          this.setFocusAndScrollIntoView_(rows[0]);
          break;
        }
        case PREVIOUS_ROW_ACTION: {
          this.setFocusAndScrollIntoView_(rows[rows.length - 1]);
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
          this.setFocusAndScrollIntoView_(nextRow);
        break;
      }
      case PREVIOUS_ROW_ACTION: {
        const previousRow = rowAtOffset(rows, this.focusedRow_, -1);
        if (previousRow)
          this.setFocusAndScrollIntoView_(previousRow);
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
    this.setFocusAndScrollIntoView_(firstRow);
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
      this.moveFocus_(action);
      return;
    }
    if (action == TOGGLE_FOCUSED_ACTION) {
      // If nothing is focused, pretend the first email was focused.
      if (!this.focusedRow_)
        this.moveFocus_(NEXT_ROW_ACTION);
      if (!this.focusedRow_)
        return;

      this.focusedRow_.checked = !this.focusedRow_.checked;
      this.moveFocus_(NEXT_ROW_ACTION);
      return;
    }
    if (action == TOGGLE_QUEUE_ACTION) {
      // If nothing is focused, pretend the first email was focused.
      if (!this.focusedRow_)
        this.moveFocus_(NEXT_ROW_ACTION);
      if (!this.focusedRow_)
        return;
      const checking = !this.focusedRow_.checked;

      let rows = this.focusedRow_.getGroup().getRows();
      for (let row of rows) {
        row.checked = checking;
      }
    }
    if (action == NEXT_QUEUE_ACTION) {
      this.moveFocus_(action);
      return;
    }
    if (action == PREVIOUS_QUEUE_ACTION) {
      this.moveFocus_(action);
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
        this.moveFocus_(NEXT_ROW_ACTION);
      if (!this.focusedRow_)
        return;
      this.setRenderedRow_(this.focusedRow_);
      return;
    }

    await this.markTriaged_(defined(action.destination));
  }

  transitionToThreadList_(focusedRow: ThreadRow|null) {
    this.showBackArrow_(false);

    this.rowGroupContainer_.style.display = 'flex';
    this.singleThreadContainer_.textContent = '';
    this.scrollContainer_.scrollTop = this.scrollOffset_ || 0;

    this.setFocusAndScrollIntoView_(focusedRow);
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
        if (child.selected) {
          if (child == this.focusedRow_)
            focusedRowIsSelected = true;
          threads.push(child.thread);
          // ThreadRows get recycled, so clear the checked and focused state
          // for future use.
          child.resetState();

          let parentGroup = child.getGroup();
          // The rows will get removed on the next frame anyways, but we don't
          // want the user to see an intermediary state where the row is shown
          // but unchecked and we don't want to move focus to the next row until
          // these rows have been removed. So just removed them synchronously
          // here purely for the visual effect.
          child.remove();
          // Remove the parent group if it's now empty so the user doens't see a
          // flicker where the row is removed without it's parent group also
          // being removed.
          parentGroup.removeIfEmpty();
        } else if (focusedRowIsSelected && !firstUnselectedRowAfterFocused) {
          firstUnselectedRowAfterFocused = child;
        }
      }

      if (!threads.length)
        return;

      // Move focus to the first unselected email. If we aren't able to find
      // an unselected email, focusedEmail_ should end up null, so set it even
      // if firstUnselectedRowAfterSelected is null.
      if (focusedRowIsSelected)
        this.setFocus_(firstUnselectedRowAfterFocused);

      await this.model_.markThreadsTriaged(
          threads, destination, expectedNewMessageCount);
    }
  }

  setRenderedRowInternal_(row: ThreadRow|null) {
    this.hasNewRenderedRow_ = !!row;
    if (this.renderedRow_)
      this.renderedRow_.rendered.remove();
    this.renderedRow_ = row;
    this.renderedGroupName_ = row ? this.model_.getGroupName(row.thread) : null;
  }

  setRenderedRow_(row: ThreadRow|null) {
    this.setRenderedRowInternal_(row);
    if (row)
      this.render_();
  }

  renderOne_(toast?: HTMLElement) {
    if (this.rowGroupContainer_.style.display != 'none')
      this.transitionToSingleThread_();

    let renderedRow = notNull(this.renderedRow_);
    let rendered = renderedRow.rendered;
    assert(
        !rendered.isRendered() ||
            rendered.parentNode == this.singleThreadContainer_,
        'Tried to rerender already rendered thread. This should never happen.');

    if (!rendered.isRendered()) {
      rendered.render();
      this.singleThreadContainer_.append(rendered);
    }

    rendered.style.bottom = '';
    rendered.style.visibility = 'visible';

    this.updateActions_();
    if (toast)
      this.addToFooter(toast);

    // If you click on a row before it's pulled in message details, handle it
    // semi-gracefully.
    // TODO: Once the message details load, call the code below to add the
    // subject, etc.
    let messages = renderedRow.thread.getMessages();
    if (!messages.length) {
      this.setSubject_('');
      return;
    }

    let viewInGmailButton = new ViewInGmailButton();
    viewInGmailButton.setMessageId(messages[messages.length - 1].id);
    viewInGmailButton.style.display = 'inline-flex';

    let subject = document.createElement('div');
    subject.style.flex = '1';
    subject.append(renderedRow.thread.getSubject());
    this.setSubject_(subject, viewInGmailButton);

    var elementToScrollTo = rendered.firstUnreadMessageHeader();
    if (!elementToScrollTo)
      elementToScrollTo = rendered.lastMessageHeader();
    elementToScrollTo.scrollIntoView({'block': 'center'});

    // Check if new messages have come in since we last fetched from the
    // network. Intentionally don't await this since we don't want to
    // make renderOne_ async.
    renderedRow.thread.update();
  }

  // TODO: Make a proper QuickReply element. This function is getting unweildy
  // and ThreadListView shouldn't know all these details about compose and
  // sending.
  async showQuickReply() {
    let container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      width: 100%;
    `;

    let compose = new EmailCompose(true);
    compose.style.cssText = `
      flex: 1;
      margin: 4px;
      display: flex;
      background-color: white;
    `;
    compose.placeholder =
        'Hit <enter> to send, <ctrl+enter> to send and archive, <esc> to cancel. Allowed length is configurable in Settings.';

    let replyType = document.createElement('select');
    replyType.innerHTML = `
      <option>${ReplyType.ReplyAll}</option>
      <option>${ReplyType.Reply}</option>
      <option>${ReplyType.Forward}</option>
    `;

    let sendAs = defined(this.sendAs_);
    let from;
    let senders: HTMLSelectElement;
    if (sendAs.senders && sendAs.senders.length > 1) {
      from = document.createElement('div');
      from.style.cssText = `
        white-space: nowrap;
        margin: 0 6px;
      `;
      senders = document.createElement('select');
      senders.style.cssText = `
        margin-left: 2px;
      `;
      from.append('From', senders);

      let messages = notNull(this.renderedRow_).thread.getMessages();
      let lastMessage = messages[messages.length - 1];
      let deliveredTo = lastMessage.deliveredTo;

      for (let sender of sendAs.senders) {
        let option = document.createElement('option');
        option.append(defined(sender.sendAsEmail));
        if (deliveredTo ? sender.sendAsEmail === deliveredTo : sender.isDefault)
          option.setAttribute('selected', 'true');
        senders.append(option);
      }
    }

    let progress = new RadialProgress(true);
    progress.addToTotal(this.allowedReplyLength_);

    let count = document.createElement('div');
    count.style.cssText = `
      margin: 4px;
      color: red;
    `;

    let onClose = this.updateActions_.bind(this);

    let cancel = document.createElement('button');
    cancel.textContent = 'cancel';
    cancel.onclick = onClose;

    // Group these together so they wrap atomically.
    let controls = document.createElement('div');
    controls.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
    `;
    controls.append(cancel, replyType);
    if (from)
      controls.append(from);
    controls.append(count, progress);

    container.append(compose, controls);

    compose.addEventListener('cancel', onClose);

    compose.addEventListener('submit', async (e: Event) => {
      let submitEvent = <SubmitEvent>e;

      let textLength = compose.plainText.length;
      if (!textLength)
        return;

      if (textLength > this.allowedReplyLength_) {
        alert(`Email is longer than the allowed length of ${
            this.allowedReplyLength_} characters. Allowed length is configurable in Settings.`);
        return;
      }

      // Grab this before setting isSending_ to true to ensure that we don't
      // get stuck unable to send when there are bugs.
      let renderedRow = notNull(this.renderedRow_);

      if (this.isSending_)
        return;
      this.isSending_ = true;
      let progress =
          this.updateTitle('ThreadListView.sendReply', 1, 'Sending reply...');

      let sender: gapi.client.gmail.SendAs|undefined;
      if (sendAs.senders && sendAs.senders.length) {
        // Even if there's only one sendAs sender, we should use it since it
        // could have a custom reply-to.
        if (sendAs.senders.length == 1) {
          sender = sendAs.senders[0];
        } else {
          let sendAsEmail = senders.selectedOptions[0].value;
          sender =
              defined(sendAs.senders.find(x => x.sendAsEmail == sendAsEmail));
        }
      }

      let type = replyType.selectedOptions[0].value as ReplyType;
      try {
        // TODO: Handle if sending fails in such a way that the user can at
        // least save their message text.
        await renderedRow.thread.sendReply(
            compose.value, compose.getEmails(), type, sender);
      } finally {
        this.isSending_ = false;
        progress.incrementProgress();
      }

      this.updateActions_();

      if (submitEvent.ctrlKey) {
        let expectedNewMessageCount = type === ReplyType.Forward ? 0 : 1;
        await this.markTriaged_(
            ARCHIVE_ACTION.destination, expectedNewMessageCount);
      } else if (type !== ReplyType.Forward) {
        renderedRow.rendered.showSpinner(true);
        await renderedRow.thread.update();
        renderedRow.rendered.showSpinner(false);

        // The user can change the rendered row while the thread is updating.
        if (renderedRow === this.renderedRow_) {
          let lastMessage = renderedRow.rendered.lastMessageHeader();
          lastMessage.scrollIntoView({behavior: 'smooth'});
        }
      }
    })

    compose.addEventListener('input', () => {
      let textLength = compose.plainText.length;
      progress.setProgress(textLength);
      let lengthDiff = this.allowedReplyLength_ - textLength;
      count.textContent = (lengthDiff < 10) ? String(lengthDiff) : '';
    });

    this.setActions([]);
    this.setFooter(container);
    this.addTimer_();

    compose.focus();
  }
}
window.customElements.define('mt-thread-list-view', ThreadListView);
