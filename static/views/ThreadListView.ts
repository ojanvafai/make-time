import {Action, Actions, registerActions} from '../Actions.js';
import {assert, defined, notNull} from '../Base.js';
import {getSendAs, login} from '../BaseMain.js';
import {ThreadListModel, UndoEvent} from '../models/ThreadListModel.js';
import {QuickReply, ReplyCloseEvent, ReplyScrollEvent} from '../QuickReply.js';
import {SendAs} from '../SendAs.js';
import {ServerStorage} from '../ServerStorage.js';
import {Settings} from '../Settings.js';
import {BACKLOG_PRIORITY_NAME, BLOCKED_LABEL_NAME, MUST_DO_PRIORITY_NAME, NEEDS_FILTER_PRIORITY_NAME, URGENT_PRIORITY_NAME} from '../Thread.js';
import {Thread} from '../Thread.js';
import {Timer} from '../Timer.js';
import {ViewInGmailButton} from '../ViewInGmailButton.js';

import {AppShell} from './AppShell.js';
import {FocusRowEvent, SelectRowEvent as CheckRowEvent, ThreadRow} from './ThreadRow.js';
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

export let ARCHIVE_ACTION = {
  name: `Archive`,
  description: `Archive and remove from the current group.`,
};

let QUICK_REPLY_ACTION = {
  name: `Quick reply`,
  shortName: `Reply`,
  description: `Give a short reply.`,
  key: 'r',
};

export let BLOCKED_ACTION = {
  name: BLOCKED_LABEL_NAME,
  description: `Show the blocked buttons.`,
};

export let BLOCKED_1D_ACTION = {
  name: '1 day',
  description:
      `Block on action from someone else. Shows up tomorrow to retriage.`,
  key: '5',
  hidden: true,
};

export let BLOCKED_2D_ACTION = {
  name: '2 days',
  description:
      `Block on action from someone else. Shows up in 2 days to retriage.`,
  key: '6',
  hidden: true,
};

export let BLOCKED_7D_ACTION = {
  name: '7 days',
  description:
      `Block on action from someone else. Shows up in 7 days to retriage.`,
  key: '7',
  hidden: true,
};

export let BLOCKED_14D_ACTION = {
  name: '14 days',
  description:
      `Block on action from someone else. Shows up in 14 days to retriage.`,
  key: '8',
  hidden: true,
};

export let BLOCKED_30D_ACTION = {
  name: '30 days',
  description:
      `Block on action from someone else. Shows up in 30 days to retriage.`,
  key: '9',
  hidden: true,
};

export let MUTE_ACTION = {
  name: `Mute`,
  description:
      `Like gmail mute, but more aggressive. Will never appear in your inbox again.`,
};

export let NEXT_ACTION = {
  name: `Next`,
  description: `Go to the next row/thread/message.`,
  key: 'j',
  hidden: true,
  repeatable: true,
};

export let PREVIOUS_ACTION = {
  name: `Previous`,
  description: `Go to the previous row/thread/message.`,
  key: 'k',
  hidden: true,
  repeatable: true,
};

export let NEXT_FULL_ACTION = {
  name: `Next group or last message`,
  description:
      `Focus the first email of the next group or scroll thread to the last message.`,
  key: 'n',
  hidden: true,
  repeatable: true,
};

export let PREVIOUS_FULL_ACTION = {
  name: `Previous group or first message`,
  description:
      `Focus the first email of the previous group or scroll thread to the first message..`,
  key: 'p',
  hidden: true,
  repeatable: true,
};

let TOGGLE_GROUP_ACTION = {
  name: `Toggle group`,
  description: `Toggle all items in the current group.`,
  key: 'g',
  hidden: true,
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

export let MUST_DO_ACTION = {
  name: MUST_DO_PRIORITY_NAME,
  description: `Must do today. Literally won't go home till it's done.`,
  key: '1',
};

export let URGENT_ACTION = {
  name: URGENT_PRIORITY_NAME,
  description: `Needs to happen ASAP.`,
  key: '2',
};

export let BACKLOG_ACTION = {
  name: BACKLOG_PRIORITY_NAME,
  description:
      `Important for achieving my mission, but can be done at leisure.`,
  key: '3',
};

export let NEEDS_FILTER_ACTION = {
  name: NEEDS_FILTER_PRIORITY_NAME,
  shortName: 'Filter',
  description:
      `Needs a new/different filter, but don't want to interrupt triaging to do that now.`,
  key: 'f',
};

let BLOCKED_BUTTONS = [
  BLOCKED_1D_ACTION,
  BLOCKED_2D_ACTION,
  BLOCKED_7D_ACTION,
  BLOCKED_14D_ACTION,
  BLOCKED_30D_ACTION,
];

let BASE_ACTIONS = [
  ARCHIVE_ACTION,
  BLOCKED_ACTION,
  ...BLOCKED_BUTTONS,
  MUTE_ACTION,
  MUST_DO_ACTION,
  URGENT_ACTION,
  BACKLOG_ACTION,
  NEEDS_FILTER_ACTION,
  UNDO_ACTION,
  PREVIOUS_ACTION,
  PREVIOUS_FULL_ACTION,
  NEXT_ACTION,
  NEXT_FULL_ACTION,
];

let RENDER_ALL_ACTIONS = [
  TOGGLE_FOCUSED_ACTION,
  TOGGLE_GROUP_ACTION,
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
  private autoStartTimer_: boolean;
  private timerDuration_: number;
  private allowedReplyLength_: number;
  private modelListeners_: ListenerData[];
  private threadToRow_: WeakMap<Thread, ThreadRow>;
  private focusedRow_: ThreadRow|null;
  private rowGroupContainer_: HTMLElement;
  private singleThreadContainer_: HTMLElement;
  private renderedRow_: ThreadRow|null;
  private autoFocusedRow_: ThreadRow|null;
  private lastCheckedRow_: ThreadRow|null;
  private renderedGroupName_: string|null;
  private scrollOffset_: number|undefined;
  private hasQueuedFrame_: boolean;
  private hasNewRenderedRow_: boolean;
  private sendAs_?: SendAs;
  private blockedToolbar_?: Actions;

  constructor(
      private model_: ThreadListModel, private appShell_: AppShell,
      settings: Settings, bottomButtonUrl?: string, bottomButtonText?: string) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    this.autoStartTimer_ = settings.get(ServerStorage.KEYS.AUTO_START_TIMER);
    this.timerDuration_ = settings.get(ServerStorage.KEYS.TIMER_DURATION);
    this.allowedReplyLength_ =
        settings.get(ServerStorage.KEYS.ALLOWED_REPLY_LENGTH);

    this.modelListeners_ = [];
    this.threadToRow_ = new WeakMap();
    this.focusedRow_ = null;
    this.renderedRow_ = null;
    this.autoFocusedRow_ = null;
    this.lastCheckedRow_ = null;
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
    this.rowGroupContainer_.addEventListener(FocusRowEvent.NAME, (e: Event) => {
      this.handleFocusRow_(<ThreadRow>e.target);
    });
    this.rowGroupContainer_.addEventListener(CheckRowEvent.NAME, (e: Event) => {
      this.handleCheckRow_(<ThreadRow>e.target, (e as CheckRowEvent).shiftKey);
    });

    this.singleThreadContainer_ = document.createElement('div');
    this.singleThreadContainer_.style.cssText = `
      position: relative;
    `;
    this.append(this.singleThreadContainer_);

    if (bottomButtonUrl) {
      let button = document.createElement('a');
      button.className = 'label-button';
      button.href = bottomButtonUrl;
      button.textContent = defined(bottomButtonText);
      this.append(button);
    }
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
      row = new ThreadRow(thread, this.model_);
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

  tearDown() {
    for (let listener of this.modelListeners_) {
      this.model_.removeEventListener(listener.name, listener.handler);
    }
    this.appShell_.setSubject('');
    this.appShell_.showBackArrow(false);
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
        this.autoStartTimer_, !!this.model_.timerCountsDown,
        this.timerDuration_, this.singleThreadContainer_);
    AppShell.addToFooter(timer);
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
        currentGroup = new ThreadRowGroup(groupName, this.model_);
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
          if (this.renderedGroupName_ !== nextGroupName) {
            // If the next group is collapsed, go back to the thread list.
            if (this.model_.isCollapsed(nextGroupName))
              nextRow = null;
            else
              toast = this.createToast_(nextGroupName);
          }
        }
        if (nextRow) {
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

  private handleFocusRow_(row: ThreadRow) {
    // Once a row gets manually focused, stop auto-focusing.
    if (row !== this.autoFocusedRow_)
      this.autoFocusedRow_ = null;

    if (row === this.focusedRow_)
      return;

    if (this.focusedRow_)
      this.focusedRow_.clearFocus();
    this.focusedRow_ = row;
  }

  private handleCheckRow_(row: ThreadRow, rangeSelect: boolean) {
    // Double check that the last selected row is still actually selected.
    if (rangeSelect && this.lastCheckedRow_ && this.lastCheckedRow_.checked) {
      let rows = this.getRows_();
      let lastIndex = rows.indexOf(this.lastCheckedRow_);
      let newIndex = rows.indexOf(row);
      let start = (lastIndex < newIndex) ? lastIndex : newIndex;
      let end = (lastIndex < newIndex) ? newIndex : lastIndex;
      for (var i = start; i < end; i++) {
        rows[i].checked = true;
      }
    }
    this.lastCheckedRow_ = row;
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
        case NEXT_ACTION:
        case NEXT_FULL_ACTION: {
          this.setFocusAndScrollIntoView_(rows[0]);
          break;
        }
        case PREVIOUS_ACTION: {
          this.setFocusAndScrollIntoView_(rows[rows.length - 1]);
          break;
        }
        case PREVIOUS_FULL_ACTION: {
          let lastGroup = rows[rows.length - 1].getGroup();
          this.focusFirstRowOfGroup_(lastGroup);
          break;
        }
      }
      return;
    }
    switch (action) {
      case NEXT_ACTION: {
        const nextRow = rowAtOffset(rows, this.focusedRow_, 1);
        if (nextRow)
          this.setFocusAndScrollIntoView_(nextRow);
        break;
      }
      case PREVIOUS_ACTION: {
        const previousRow = rowAtOffset(rows, this.focusedRow_, -1);
        if (previousRow)
          this.setFocusAndScrollIntoView_(previousRow);
        break;
      }
      case NEXT_FULL_ACTION: {
        let currentGroup = this.focusedRow_.getGroup();
        this.focusFirstRowOfGroup_(
            <ThreadRowGroup>currentGroup.nextElementSibling);
        break;
      }
      case PREVIOUS_FULL_ACTION: {
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

  private toggleBlockedToolbar_() {
    if (this.blockedToolbar_) {
      this.blockedToolbar_.remove();
      this.blockedToolbar_ = undefined;
    } else {
      this.blockedToolbar_ = new Actions(this, true);
      this.blockedToolbar_.setActions(BLOCKED_BUTTONS);
      this.blockedToolbar_.style.position = 'absolute';
      AppShell.addToFooter(this.blockedToolbar_);
      this.blockedToolbar_.style.top =
          `-${this.blockedToolbar_.offsetHeight}px`;
    }
  }

  async takeAction(action: Action) {
    switch (action) {
      case BLOCKED_ACTION:
        this.toggleBlockedToolbar_();
        return;

      case UNDO_ACTION:
        this.model_.undoLastAction();
        return;

      case QUICK_REPLY_ACTION:
        await this.showQuickReply();
        return;

      case NEXT_FULL_ACTION:
      case PREVIOUS_FULL_ACTION:
      case NEXT_ACTION:
      case PREVIOUS_ACTION:
        if (this.renderedRow_)
          this.renderedRow_.rendered.moveFocus(action);
        else
          this.moveFocus_(action);
        return;

      case TOGGLE_FOCUSED_ACTION:
        this.toggleFocused_();
        return;

      case TOGGLE_GROUP_ACTION:
        this.toggleQueue_();
        return;

      case VIEW_THREADLIST_ACTION:
        this.transitionToThreadList_(this.renderedRow_);
        return;

      case VIEW_FOCUSED_ACTION:
        this.viewFocused_();
        return;

      default:
        await this.markTriaged_(action);
    }
  }

  toggleFocused_() {
    let focused = notNull(this.focusedRow_);
    focused.checked = !focused.checked;
    this.moveFocus_(NEXT_ACTION);
  }

  toggleQueue_() {
    let focused = notNull(this.focusedRow_);
    const checking = !focused.checked;
    let rows = focused.getGroup().getRows();
    for (let row of rows) {
      row.checked = checking;
    }
  }

  viewFocused_() {
    if (!this.focusedRow_)
      this.moveFocus_(NEXT_ACTION);
    if (!this.focusedRow_)
      return;
    this.setRenderedRow_(this.focusedRow_);
  }

  transitionToThreadList_(focusedRow: ThreadRow|null) {
    this.appShell_.showBackArrow(false);

    this.rowGroupContainer_.style.display = 'flex';
    this.singleThreadContainer_.textContent = '';
    this.appShell_.contentScrollTop = this.scrollOffset_ || 0;

    this.setFocusAndScrollIntoView_(focusedRow);
    this.setRenderedRow_(null);
    this.appShell_.setSubject('');
    this.updateActions_();

    this.render_();
  }

  transitionToSingleThread_() {
    this.appShell_.showBackArrow(true);

    this.scrollOffset_ = this.appShell_.contentScrollTop;
    this.rowGroupContainer_.style.display = 'none';
  }

  private async markTriaged_(destination: Action) {
    if (this.renderedRow_) {
      await this.model_.markSingleThreadTriaged(
          this.renderedRow_.thread, destination);
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

          // TODO: Instead of removing rows outside of model changes, which
          // causes races, move focus state into the model so that it all
          // updates atomically.
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

      await this.model_.markThreadsTriaged(threads, destination);
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
      AppShell.addToFooter(toast);

    // If you click on a row before it's pulled in message details, handle it
    // semi-gracefully.
    // TODO: Once the message details load, call the code below to add the
    // subject, etc.
    let messages = renderedRow.thread.getMessages();
    if (!messages.length) {
      this.appShell_.setSubject('');
      return;
    }

    let viewInGmailButton = new ViewInGmailButton();
    viewInGmailButton.setMessageId(messages[messages.length - 1].id);
    viewInGmailButton.style.display = 'inline-flex';

    let subject = document.createElement('div');
    subject.style.flex = '1';
    subject.append(renderedRow.thread.getSubject());
    this.appShell_.setSubject(subject, viewInGmailButton);

    rendered.focusFirstUnread();
    // Check if new messages have come in since we last fetched from the
    // network. Intentionally don't await this since we don't want to
    // make renderOne_ async.
    renderedRow.thread.update();
  }

  async showQuickReply() {
    let reply = new QuickReply(
        notNull(this.renderedRow_).thread, this.allowedReplyLength_,
        defined(this.sendAs_));
    reply.addEventListener(ReplyCloseEvent.NAME, () => this.updateActions_());

    reply.addEventListener(ReplyScrollEvent.NAME, async () => {
      if (!this.renderedRow_)
        return;

      let row = this.renderedRow_;
      if (row.thread === reply.thread) {
        row.rendered.showSpinner(true);
        await row.thread.update();
        row.rendered.showSpinner(false);
        row.rendered.moveFocus(NEXT_FULL_ACTION, {behavior: 'smooth'});
      }
    });

    this.setActions([]);
    AppShell.setFooter(reply);
    this.addTimer_();

    reply.focus();
  }
}
window.customElements.define('mt-thread-list-view', ThreadListView);
