import {Action, registerActions, Shortcut} from '../Actions.js';
import {assert, defined, notNull} from '../Base.js';
import {login} from '../BaseMain.js';
import {NO_ROOM_NEEDED} from '../calendar/CalendarEvent.js';
import {INSERT_LINK_HIDDEN} from '../EmailCompose.js';
import {ThreadListChangedEvent, ThreadListModel, UndoEvent} from '../models/ThreadListModel.js';
import {QuickReply, ReplyCloseEvent, ReplyScrollEvent} from '../QuickReply.js';
import {SendAs} from '../SendAs.js';
import {ServerStorage} from '../ServerStorage.js';
import {Settings} from '../Settings.js';
import {Themes} from '../Themes.js';
import {InProgressChangedEvent, Thread} from '../Thread.js';
import {ARCHIVE_ACTION, BASE_THREAD_ACTIONS, DUE_ACTIONS, MUTE_ACTION, REPEAT_ACTION} from '../ThreadActions.js';
import {Timer} from '../Timer.js';
import {Toast} from '../Toast.js';

import {AppShell} from './AppShell.js';
import {FocusRowEvent, HeightChangedEvent, LabelState, RenderThreadEvent, SelectRowEvent, ThreadRow} from './ThreadRow.js';
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

let QUICK_REPLY_ACTION = {
  name: `Reply`,
  description: `Give a short reply.`,
  key: 'r',
};

let VIEW_IN_GMAIL_ACTION = {
  name: `View in gmail`,
  description: `View the selected thread in gmail.`,
  key: 'v',
  hidden: true,
};

export let NEXT_ACTION = {
  name: `Next`,
  description: `Go to the next row/thread/message.`,
  key: 'j',
  secondaryKey: 'ArrowDown',
  hidden: true,
  repeatable: true,
};

export let PREVIOUS_ACTION = {
  name: `Previous`,
  description: `Go to the previous row/thread/message.`,
  key: 'k',
  secondaryKey: 'ArrowUp',
  hidden: true,
  repeatable: true,
};

export let NEXT_FULL_ACTION = {
  name: `Next group or last message`,
  description:
      `Focus the first email of the next group or scroll thread to the last message.`,
  key: 'n',
  secondaryKey: new Shortcut('ArrowDown', false, true),
  hidden: true,
  repeatable: true,
};

export let PREVIOUS_FULL_ACTION = {
  name: `Previous group or first message`,
  description:
      `Focus the first email of the previous group or scroll thread to the first message..`,
  key: 'p',
  secondaryKey: new Shortcut('ArrowUp', false, true),
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
  key: 'u',
};

let MOVE_UP_ACTION = {
  name: '⬆',
  description: `Moves the row up in sort order in the Todo view.`,
  key: '[',
  secondaryKey: new Shortcut('ArrowUp', true, false),
  repeatable: true,
};

let MOVE_DOWN_ACTION = {
  name: '⬇',
  description: `Moves the row down in sort order in the Todo view.`,
  key: ']',
  secondaryKey: new Shortcut('ArrowDown', true, false),
  repeatable: true,
};

let BASE_ACTIONS = [
  [
    ARCHIVE_ACTION,
    MUTE_ACTION,
  ],
  ...BASE_THREAD_ACTIONS,
  [
    UNDO_ACTION,
    REPEAT_ACTION,
  ],
  PREVIOUS_ACTION,
  PREVIOUS_FULL_ACTION,
  NEXT_ACTION,
  NEXT_FULL_ACTION,
  INSERT_LINK_HIDDEN,
  VIEW_IN_GMAIL_ACTION,
];

let SORT_ACTIONS = [
  MOVE_UP_ACTION,
  MOVE_DOWN_ACTION,
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

const SHOW_PENDING_DELAY = 1000;

registerActions('Triage or Todo', [
  ...BASE_ACTIONS,
  ...SORT_ACTIONS,
  ...RENDER_ALL_ACTIONS,
  ...RENDER_ONE_ACTIONS,
]);

export class ThreadListView extends View {
  private timerDuration_: number;
  private modelListeners_: ListenerData[];
  private threadToRow_: WeakMap<Thread, ThreadRow>;
  private focusedRow_: ThreadRow|null;
  private noMeetingRoomEvents_: HTMLElement;
  private rowGroupContainer_: HTMLElement;
  private singleThreadContainer_: HTMLElement;
  private pendingContainer_: HTMLElement;
  private renderedRow_: ThreadRow|null;
  private autoFocusedRow_: ThreadRow|null;
  private lastCheckedRow_: ThreadRow|null;
  private renderedGroupName_: string|null;
  private scrollOffset_: number|undefined;
  private hasQueuedFrame_: boolean;
  private hasNewRenderedRow_: boolean;
  private labelSelectTemplate_?: HTMLSelectElement;
  private buttonContainer_: HTMLElement;
  private isVisibleObserver_: IntersectionObserver;
  private isHiddenObserver_: IntersectionObserver;
  private updateVisibilityTimer_?: number;

  private static ACTIONS_THAT_KEEP_ROWS_: Action[] =
      [REPEAT_ACTION, ...DUE_ACTIONS];

  constructor(
      private model_: ThreadListModel, private appShell_: AppShell,
      private settings_: Settings, private toggleViewUrl_?: string,
      private includeSortActions_?: boolean) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: 1000px;
      margin: auto;
      position: relative;
    `;

    this.timerDuration_ = settings_.get(ServerStorage.KEYS.TIMER_DURATION);

    this.modelListeners_ = [];
    this.threadToRow_ = new WeakMap();
    this.focusedRow_ = null;
    this.renderedRow_ = null;
    this.autoFocusedRow_ = null;
    this.lastCheckedRow_ = null;
    this.renderedGroupName_ = null;
    this.hasQueuedFrame_ = false;
    this.hasNewRenderedRow_ = false;

    // Use a larger margin for hiding content than for creating it so that small
    // scrolls up and down don't't repeatedly doing rendering work.
    // Register the hidden observer first so that it runs before the visible one
    // since we always get called back once when we first observe a target.
    this.isHiddenObserver_ = new IntersectionObserver((entries) => {
      entries.map(x => {
        if (!x.isIntersecting)
          (x.target as ThreadRowGroup).setInViewport(false);
      });
    }, {root: this.appShell_.getScroller(), rootMargin: '100%'});

    this.isVisibleObserver_ = new IntersectionObserver((entries) => {
      entries.map(x => {
        if (x.isIntersecting)
          (x.target as ThreadRowGroup).setInViewport(true);
      });
    }, {root: this.appShell_.getScroller(), rootMargin: '50%'});

    this.noMeetingRoomEvents_ = document.createElement('div');
    this.noMeetingRoomEvents_.style.cssText = `
      column-count: 3;
      white-space: nowrap;
    `;
    this.append(this.noMeetingRoomEvents_);

    this.pendingContainer_ = document.createElement('div');
    this.pendingContainer_.style.cssText = `
      position: sticky;
      z-index: 10;
      top: 0;
      max-width: 1000px;
      box-shadow: 0px 0px 8px var(--border-and-hover-color);
      background-color: var(--overlay-background-color);
      max-height: 7em;
      opacity: 0.5;
      overflow: auto;
    `;
    this.append(this.pendingContainer_);
    this.pendingContainer_.addEventListener(
        InProgressChangedEvent.NAME, (e) => this.handleInProgressChanged_(e));

    this.rowGroupContainer_ = document.createElement('div');
    this.rowGroupContainer_.style.cssText = `
      display: flex;
      flex-direction: column;
    `;
    this.append(this.rowGroupContainer_);
    this.rowGroupContainer_.addEventListener(
        InProgressChangedEvent.NAME, (e) => this.handleInProgressChanged_(e));

    this.rowGroupContainer_.addEventListener(
        RenderThreadEvent.NAME, (e: Event) => {
          this.setRenderedRowIfAllowed_(e.target as ThreadRow);
        });
    this.rowGroupContainer_.addEventListener(FocusRowEvent.NAME, (e: Event) => {
      this.handleFocusRow_(<ThreadRow>e.target);
    });
    this.rowGroupContainer_.addEventListener(
        SelectRowEvent.NAME, (e: Event) => {
          let event = (e as SelectRowEvent);
          if (event.selected)
            this.handleCheckRow_(<ThreadRow>e.target, event.shiftKey);
        });
    this.rowGroupContainer_.addEventListener(HeightChangedEvent.NAME, () => {
      this.forceRender();
    });

    this.singleThreadContainer_ = document.createElement('div');
    this.singleThreadContainer_.style.cssText = `
      position: relative;
    `;
    this.append(this.singleThreadContainer_);

    this.buttonContainer_ = document.createElement('div');
    this.buttonContainer_.style.cssText = `
      display: flex;
      justify-content: center;
    `;
    this.append(this.buttonContainer_);

    this.addListenerToModel(ThreadListChangedEvent.NAME, () => this.render_());
    this.addListenerToModel('undo', (e: Event) => {
      let undoEvent = <UndoEvent>e;
      this.handleUndo_(undoEvent.thread);
    });

    this.updateActions_();
    this.appShell_.showViewAndFilterToggles(!!this.toggleViewUrl_);
    this.renderCalendar_();
    this.render_();
  }

  private handleInProgressChanged_(e: InProgressChangedEvent) {
    let row = notNull(e.target && (e.target as ThreadRow));
    if (!row.thread.actionInProgress())
      this.setPendingStyling_(row, false);
    this.render_();
  }

  private async renderCalendar_() {
    let events = await this.model_.getNoMeetingRoomEvents();
    if (!events.length)
      return;

    this.noMeetingRoomEvents_.before(
        `Meetings without a local room. Ignore by adding "${
            NO_ROOM_NEEDED}" to the location.`);

    for (let event of events) {
      let item = document.createElement('div');
      item.style.cssText = `
        overflow: hidden;
        text-overflow: ellipsis;
      `;

      let link = document.createElement('a');
      link.href = event.editUrl;
      link.append(event.summary);

      item.append(
          `${event.start.getMonth() + 1}/${event.start.getDate()} `, link);
      this.noMeetingRoomEvents_.append(item);
    }
  }

  private getThreadRow_(thread: Thread) {
    let row = this.threadToRow_.get(thread);
    if (!row) {
      row = new ThreadRow(
          thread, this.model_.showFinalVersion(),
          defined(this.labelSelectTemplate_));
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
    await this.model_.loadFromDisk();
    await this.model_.update();
  }

  toggleView() {
    // TODO: Do this in a less hacky way.
    // Use a link instead of setting window.location so it goes through the
    // router.
    let a = document.createElement('a');
    a.href = defined(this.toggleViewUrl_);
    this.append(a);
    a.click();
  }

  createMenuItem_(
      container: HTMLElement, contents: string, clickHandler: () => void) {
    let item = document.createElement('div');
    item.className = 'menu-item';
    item.append(contents);
    item.addEventListener('click', () => {
      this.appShell_.closeOverflowMenu();
      clickHandler();
    });
    container.append(item);
  }

  openFirstSelectedThreadInGmail_() {
    // Would prefer to open all the selected rows in gmail, but Chrome only
    // allows one popup per gesture.
    let row = this.renderedRow_ || this.getRows_().find(x => x.selected);
    if (!row)
      return;

    let messageIds = row.thread.getMessageIds();
    let messageId = messageIds[messageIds.length - 1];

    // In theory, linking to the threadId should work, but it doesn't for
    // some threads. Linking to the messageId seems to work reliably. The
    // message ID listed will be expanded in the gmail UI, so link to the
    // last one since that one is definitionally always expanded.
    window.open(`https://mail.google.com/mail/#all/${defined(messageId)}`);
  }

  openOverflowMenu(container: HTMLElement) {
    this.createMenuItem_(
        container, 'Force dark mode', () => Themes.toggleDarkMode());

    this.createMenuItem_(
        container, `${VIEW_IN_GMAIL_ACTION.name} (${VIEW_IN_GMAIL_ACTION.key})`,
        () => this.takeAction(VIEW_IN_GMAIL_ACTION));

    if (!this.renderedRow_ && this.model_.canDisallowViewMessages()) {
      let contents = this.model_.allowViewMessages() ?
          'Disallow viewing messages' :
          'Allow viewing messages';
      this.createMenuItem_(
          container, contents, () => this.model_.toggleAllowViewMessages());
    }
  }

  async goBack() {
    this.transitionToThreadList_(this.renderedRow_);
  }

  updateActions_() {
    let viewSpecific =
        this.renderedRow_ ? RENDER_ONE_ACTIONS : RENDER_ALL_ACTIONS;
    let includeSortActions = this.includeSortActions_ && !this.renderedRow_;
    // TODO: Move this into the model so that we can have the TodoModel not
    // show sort actions for FinalVersion mode.
    let sortActions = includeSortActions ? SORT_ACTIONS : [];

    this.setActions([...BASE_ACTIONS, ...viewSpecific, ...sortActions]);

    if (this.renderedRow_)
      this.addTimer_();
  }

  private addTimer_() {
    // Having a timer when you can only read the subject and the snippet is not
    // helpful and adds visual clutter.
    if (!this.model_.allowViewMessages())
      return;

    let timer = new Timer(
        !!this.model_.timerCountsDown, this.timerDuration_,
        this.singleThreadContainer_);
    AppShell.addToFooter(timer);
    timer.style.top = `-${timer.offsetHeight}px`;
  }

  private async render_() {
    if (this.hasQueuedFrame_)
      return;
    this.hasQueuedFrame_ = true;

    if (!this.labelSelectTemplate_)
      this.labelSelectTemplate_ = await this.settings_.getLabelSelectTemplate();

    requestAnimationFrame(() => this.renderFrame_());
  }

  private getRows_() {
    let rows = [];
    for (let group of this.rowGroupContainer_.children as
         HTMLCollectionOf<ThreadRowGroup>) {
      rows.push(group.getRows());
    }
    return rows.flat();
  }

  private getFirstRow_() {
    let group = this.rowGroupContainer_.firstChild as ThreadRowGroup;
    return group && group.getFirstRow();
  }

  forceRender() {
    let rows = this.getRows_();
    for (let row of rows) {
      row.render();
    }
    this.render_();
  }

  private renderFrame_() {
    this.hasQueuedFrame_ = false;
    let allThreads = this.model_.getThreads();
    let oldRows = this.getRows_();

    // This happens when an undo has happened, but the model hasn't yet seen
    // the update from the undo.
    if (this.renderedRow_ && !oldRows.includes(this.renderedRow_) &&
        !allThreads.includes(this.renderedRow_.thread))
      return;

    let threadsInPending = allThreads.filter(x => x.actionInProgress());
    this.updatePendingArea_(threadsInPending);

    let threads = allThreads.filter(x => !x.actionInProgress());
    let newGroupNames = new Set(threads.map(x => this.model_.getGroupName(x)));
    let removedRows = [];

    // Remove groups that no longer exist.
    for (let group of this.rowGroupContainer_.children as
         HTMLCollectionOf<ThreadRowGroup>) {
      if (!newGroupNames.has(group.name)) {
        group.remove();
        this.isVisibleObserver_.unobserve(group);
        this.isHiddenObserver_.unobserve(group);
        removedRows.push(...group.getRows());
      }
    }

    let groupMap = new Map(
        (Array.from(this.rowGroupContainer_.children) as ThreadRowGroup[])
            .map(x => {
              return [
                x.name, {group: x, rows: []}
              ] as [string, {group: ThreadRowGroup, rows: ThreadRow[]}];
            }));

    // Threads should be in sorted order already and all threads in the
    // same queue should be adjacent to each other.
    let previousEntry: {group: ThreadRowGroup, rows: ThreadRow[]}|undefined;
    for (let thread of threads) {
      let groupName = this.model_.getGroupName(thread);
      let entry = groupMap.get(groupName);
      // Insertion sort insert new groups
      if (!entry) {
        let allowedCount = this.model_.allowedCount(groupName);
        let group = new ThreadRowGroup(groupName, this.model_, allowedCount);

        if (previousEntry)
          previousEntry.group.after(group);
        else
          this.rowGroupContainer_.prepend(group);

        entry = {group: group, rows: []};
        groupMap.set(groupName, entry);
        // Call observe after putting the group in the DOM so we don't have a
        // race condition where sometimes the group has no dimensions/position.
        this.isVisibleObserver_.observe(group);
        this.isHiddenObserver_.observe(group);
      }

      entry.rows.push(this.getThreadRow_(thread));
      previousEntry = entry;
    }

    for (let entry of groupMap.values()) {
      removedRows.push(...entry.group.setRows(entry.rows));
    }

    this.handleRowsRemoved_(removedRows, oldRows);

    this.updateFinalVersionRendering_();

    if (!this.renderedRow_ && (!this.focusedRow_ || this.autoFocusedRow_)) {
      this.autoFocusedRow_ = this.getFirstRow_();
      this.setFocus_(this.autoFocusedRow_);
    }

    // Only set this after the initial update so we don't show the all done
    // indication incorrectly.
    if (this.model_.hasFetchedThreads())
      this.rowGroupContainer_.className = 'row-group-container';

    // Do this async so it doesn't block putting up the frame.
    setTimeout(() => this.prerender_());
  }

  private updatePendingArea_(threads: Thread[]) {
    let oldPending = new Set(Array.from(
        this.pendingContainer_.children as HTMLCollectionOf<ThreadRow>));

    for (let thread of threads) {
      let row = this.getThreadRow_(thread);
      if (oldPending.has(row)) {
        oldPending.delete(row);
        continue;
      }

      this.setPendingStyling_(row, true);
      this.pendingContainer_.prepend(row);
    }

    // If a thread is archived, it's metadata isn't updated until it's shown
    // in some view, so it will still be styled for the pending queue.
    for (let row of oldPending) {
      this.setPendingStyling_(row, false);
      row.remove();
    }

    // Schedule an update so that we show the rows after a second if they are
    // still in the pending area.
    this.scheduleUpdatePendingVisibility_();
  }

  private scheduleUpdatePendingVisibility_() {
    if (this.updateVisibilityTimer_)
      return;
    this.updateVisibilityTimer_ = window.setTimeout(() => {
      this.updateVisibilityTimer_ = undefined;

      let rows = this.pendingContainer_.children as HTMLCollectionOf<ThreadRow>;
      for (let row of rows) {
        if (this.hasPendingStyling_(row)) {
          // If there are still rows that are hidden, then schedule another
          // update so they get caught later.
          let timestamp = defined(row.thread.actionInProgressTimestamp());
          if ((Date.now() - timestamp) < SHOW_PENDING_DELAY) {
            this.scheduleUpdatePendingVisibility_();
          } else {
            // Intentionally don't call setPendingStyling_ since we want to show
            // the row but keep the rest of the pending styling (e.g.
            // pointer-events).
            row.style.display = 'flex';
          }
        }
      }
    }, SHOW_PENDING_DELAY);
  }

  private hasPendingStyling_(row: ThreadRow) {
    return row.style.display === 'none';
  }

  private setPendingStyling_(row: ThreadRow, set: boolean) {
    // Show pending threads after a timeout to avoid excessive flickering.
    // Kind of gross to hide with CSS instead of just not putting in the DOM,
    // but we rely on the InProgressChangeEvents bubbling up to the
    // ThreadListView, so they need to be in the DOM for that.
    row.style.display = set ? 'none' : 'flex';
    row.style.pointerEvents = set ? 'none' : '';
  }

  private updateFinalVersionRendering_() {
    if (!this.model_.showFinalVersion())
      return;

    let groups =
        Array.from(this.rowGroupContainer_.children) as ThreadRowGroup[];
    for (let group of groups) {
      let rows = Array.from(group.getRows()).reverse();
      let hasHitFinalVersionRow = false;
      for (let row of rows) {
        if (!hasHitFinalVersionRow) {
          hasHitFinalVersionRow = row.thread.finalVersion();
          row.setFinalVersionSkipped(false);
        } else {
          row.setFinalVersionSkipped(!row.thread.finalVersion());
        }
      }
    }
  }

  private handleRowsRemoved_(removedRows: ThreadRow[], oldRows: ThreadRow[]) {
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
              toast = new Toast(`Now in: ${nextGroupName}`);
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

    if (this.hasNewRenderedRow_) {
      this.hasNewRenderedRow_ = false;
      this.renderOne_(toast);
    }
  }

  private prerender_() {
    if (!this.model_.allowViewMessages())
      return;

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

  private setFocus_(row: ThreadRow|null) {
    if (row) {
      let areAnyRowsChecked = this.getRows_().some(x => x.checked);
      let focusImpliesSelected = !areAnyRowsChecked;
      row.setFocus(true, focusImpliesSelected);
      // If the row isn't actually in the tree, then it's focus event won't
      // bubble up to the ThreadListView, so manually set this.focusedRow_.
      if (!row.parentNode)
        this.setFocusInternal_(row);
    } else {
      this.clearFocus_();
    }
  }

  clearFocus_() {
    this.autoFocusedRow_ = null;
    this.setFocusInternal_(null);
  }

  private setFocusInternal_(row: ThreadRow|null) {
    if (this.focusedRow_)
      this.focusedRow_.clearFocus();
    this.focusedRow_ = row;
  }

  private preventAutoFocusFirstRow_() {
    this.autoFocusedRow_ = null;
  }

  private handleFocusRow_(row: ThreadRow) {
    // Once a row gets manually focused, stop auto-focusing.
    if (row !== this.autoFocusedRow_)
      this.preventAutoFocusFirstRow_();

    if (row !== this.focusedRow_)
      this.setFocusInternal_(row);
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
        rows[i].setChecked(true);
      }
    }
    this.lastCheckedRow_ = row;
  }

  private setFocusAndScrollIntoView_(row: ThreadRow|null) {
    this.setFocus_(row);
    if (this.focusedRow_)
      this.focusedRow_.scrollIntoView({'block': 'center'});
  }

  private moveRow_(action: Action) {
    let selectedRows = this.getRows_().filter(x => x.selected);
    if (!selectedRows.length)
      return;

    // If the first row is auto selected because it's the first row, make sure
    // it stays focused after it's moved.
    this.preventAutoFocusFirstRow_();

    let firstSelected = selectedRows[0];
    let group = firstSelected.getGroup();
    let rows = group.getRows();

    let beforeFirstSelected = [];
    let selected = [];
    let afterFirstSelected = [];
    for (let row of rows) {
      if (row.selected)
        selected.push(row);
      else if (selected.length)
        afterFirstSelected.push(row);
      else
        beforeFirstSelected.push(row);
    }

    if (action === MOVE_UP_ACTION) {
      let itemToMove = beforeFirstSelected.pop();
      if (itemToMove)
        afterFirstSelected.splice(0, 0, itemToMove);
    } else {
      let itemToMove = afterFirstSelected.shift();
      if (itemToMove)
        beforeFirstSelected.push(itemToMove);
    }

    let sorted = [...beforeFirstSelected, ...selected, ...afterFirstSelected];
    this.model_.setSortOrder(sorted.map(x => x.thread));
  }

  private moveFocus_(action: Action) {
    let rows = this.getRows_();
    if (!rows.length)
      return;

    let focused = assert(this.focusedRow_);

    switch (action) {
      case NEXT_ACTION: {
        const nextRow = rowAtOffset(rows, focused, 1);
        if (nextRow)
          this.setFocusAndScrollIntoView_(nextRow);
        break;
      }
      case PREVIOUS_ACTION: {
        const previousRow = rowAtOffset(rows, focused, -1);
        if (previousRow)
          this.setFocusAndScrollIntoView_(previousRow);
        break;
      }
      case NEXT_FULL_ACTION: {
        let currentGroup = focused.getGroup();
        let newGroup = currentGroup.nextElementSibling as ThreadRowGroup;
        while (newGroup && newGroup.isCollapsed()) {
          newGroup = newGroup.nextElementSibling as ThreadRowGroup;
        }
        this.focusFirstRowOfGroup_(newGroup);
        break;
      }
      case PREVIOUS_FULL_ACTION: {
        let currentGroup = focused.getGroup();
        let newGroup = currentGroup.previousElementSibling as ThreadRowGroup;
        while (newGroup && newGroup.isCollapsed()) {
          newGroup = newGroup.previousElementSibling as ThreadRowGroup;
        }
        this.focusFirstRowOfGroup_(newGroup);
        break;
      }
    }
  }

  focusFirstRowOfGroup_(group: ThreadRowGroup) {
    if (!group)
      return;
    this.setFocusAndScrollIntoView_(group.getFirstRow());
  }

  async takeAction(action: Action) {
    switch (action) {
      case UNDO_ACTION:
        this.model_.undoLastAction();
        return;

      case VIEW_IN_GMAIL_ACTION:
        this.openFirstSelectedThreadInGmail_();
        return;

      case QUICK_REPLY_ACTION:
        await this.showQuickReply();
        return;

      case MOVE_DOWN_ACTION:
      case MOVE_UP_ACTION:
        this.moveRow_(action);
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
    focused.setChecked(!focused.checked);
    this.moveFocus_(NEXT_ACTION);
  }

  private toggleQueue_() {
    let focused = notNull(this.focusedRow_);
    const checking = !focused.checked;
    let rows = focused.getGroup().getRows();
    for (let row of rows) {
      row.setChecked(checking);
    }
  }

  private setRenderedRowIfAllowed_(row: ThreadRow) {
    this.setRenderedRow_(row);
  }

  private viewFocused_() {
    if (!this.focusedRow_)
      this.moveFocus_(NEXT_ACTION);
    if (!this.focusedRow_)
      return;
    this.setRenderedRowIfAllowed_(this.focusedRow_);
  }

  private transitionToThreadList_(focusedRow: ThreadRow|null) {
    this.appShell_.showViewAndFilterToggles(!!this.toggleViewUrl_);
    this.appShell_.showBackArrow(false);

    this.rowGroupContainer_.style.display = 'flex';
    this.buttonContainer_.style.display = 'flex';
    this.singleThreadContainer_.textContent = '';
    this.appShell_.contentScrollTop = this.scrollOffset_ || 0;

    this.setFocusAndScrollIntoView_(focusedRow);
    this.setRenderedRow_(null);
    this.appShell_.setSubject('');
    this.updateActions_();

    this.render_();
  }

  transitionToSingleThread_() {
    this.appShell_.showViewAndFilterToggles(false);
    this.appShell_.showBackArrow(true);

    this.scrollOffset_ = this.appShell_.contentScrollTop;
    this.rowGroupContainer_.style.display = 'none';
    this.buttonContainer_.style.display = 'none';
  }

  private async markTriaged_(destination: Action) {
    let threads = this.collectThreadsToTriage_(
        ThreadListView.ACTIONS_THAT_KEEP_ROWS_.includes(destination));

    if (threads.length > 1) {
      let toast = new Toast(`Triaged ${threads.length} threads`);
      AppShell.addToFooter(toast);
    }

    await this.model_.markTriaged(destination, threads);
  }

  private collectThreadsToTriage_(keepRows: boolean) {
    if (this.renderedRow_) {
      // Save off the row since handleRowsRemoved_ sets this.renderedRow_ in
      // some cases.
      let row = this.renderedRow_;
      // Do this here so that we show the next thread instantly rather than
      // waiting for the action to complete.
      if (!keepRows)
        this.handleRowsRemoved_([row], this.getRows_());
      return [row.thread];
    }

    return this.getRows_().filter(x => x.selected).map(x => {
      // This causes the row to be removed instantely rather than waiting for
      // the action to completely.
      if (!keepRows)
        x.thread.setActionInProgress(true);
      return x.thread;
    });
  }

  setRenderedRowInternal_(row: ThreadRow|null) {
    this.hasNewRenderedRow_ = !!row;
    if (this.renderedRow_)
      this.renderedRow_.rendered.remove();
    this.renderedRow_ = row;
    // This is read in renderFrame_. At that point, the rendered row will have
    // already been triaged and will no longer have a group name.
    this.renderedGroupName_ =
        (row ? this.model_.getGroupName(row.thread) : null);
  }

  setRenderedRow_(row: ThreadRow|null) {
    this.setRenderedRowInternal_(row);
    if (row)
      this.render_();
  }

  renderOneWithoutMessages_() {
    let renderedRow = notNull(this.renderedRow_);
    renderedRow.rendered.renderWithoutMessages();
    this.singleThreadContainer_.textContent = '';
    this.singleThreadContainer_.append(renderedRow.rendered);
  }

  renderOne_(toast?: HTMLElement) {
    if (this.rowGroupContainer_.style.display != 'none')
      this.transitionToSingleThread_();

    this.updateActions_();
    if (toast)
      AppShell.addToFooter(toast);

    if (!this.model_.allowViewMessages()) {
      this.renderOneWithoutMessages_();
      return;
    }

    let renderedRow = notNull(this.renderedRow_);

    let rendered = renderedRow.rendered;
    assert(
        !rendered.isAttached() ||
            rendered.parentNode === this.singleThreadContainer_,
        'Tried to rerender already rendered thread. This should never happen.');

    if (!rendered.isAttached()) {
      rendered.render();
      this.singleThreadContainer_.append(rendered);
    }

    rendered.style.bottom = '';
    rendered.style.visibility = 'visible';

    // If you click on a row before it's pulled in message details, handle it
    // semi-gracefully.
    // TODO: Once the message details load, call the code below to add the
    // subject, etc.
    let messages = renderedRow.thread.getMessages();
    if (!messages.length) {
      this.appShell_.setSubject('');
      return;
    }

    let arrow = document.createElement('span');
    arrow.style.cssText = `
      font-size: 75%;
      height: 20px;
      width: 20px;
      display: flex;
      align-items: center;
      margin-right: 6px;
    `;

    let subject = document.createElement('div');
    subject.style.cssText = `
      flex: 1;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      margin-right: 4px;
    `;
    subject.append(renderedRow.thread.getSubject());

    let toggleClamp = () => {
      let shouldClamp = subject.style.overflow === '';
      if (shouldClamp) {
        subject.style.overflow = 'hidden';
        subject.style.display = '-webkit-box';
        arrow.textContent = '▼';
      } else {
        subject.style.overflow = '';
        subject.style.display = '';
        arrow.textContent = '▲';
      }
    };
    subject.addEventListener('click', () => toggleClamp());
    arrow.addEventListener('click', () => toggleClamp());
    toggleClamp();

    let labelContainer = document.createElement('div');
    let labelState = new LabelState(renderedRow.thread, '');
    ThreadRow.appendLabels(
        labelContainer, labelState, renderedRow.thread,
        defined(this.labelSelectTemplate_));

    this.appShell_.setSubject(subject, labelContainer);

    // Only show the arrow if there's actual overflow.
    // TODO: Technically we should recompute this when the window changes width.
    if (subject.offsetHeight < subject.scrollHeight)
      subject.after(arrow);

    rendered.focusFirstUnread();

    // Technically this is async, but it's OK if this happens async with
    // respect to the surrounding code as well.
    renderedRow.thread.markRead();

    // Check if new messages have come in since we last fetched from the
    // network. Intentionally don't await this since we don't want to
    // make renderOne_ async.
    renderedRow.thread.update();
  }

  async showQuickReply() {
    let reply = new QuickReply(
        notNull(this.renderedRow_).thread, await SendAs.getDefault());
    reply.addEventListener(ReplyCloseEvent.NAME, () => this.updateActions_());

    reply.addEventListener(ReplyScrollEvent.NAME, async () => {
      if (!this.renderedRow_ || !this.model_.allowViewMessages())
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
