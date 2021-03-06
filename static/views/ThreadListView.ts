import type * as firebase from 'firebase/app';
import { Action, ActionGroup, registerActions, Shortcut, cloneAndDisable } from '../Actions.js';
import {
  assert,
  defined,
  notNull,
  stopInProgressScroll,
  createMktimeButton,
  Labels,
} from '../Base.js';
import { firestoreUserCollection } from '../BaseMain.js';
import { CalendarEvent, NO_ROOM_NEEDED } from '../calendar/CalendarEvent.js';
import { INSERT_LINK_HIDDEN } from '../EmailCompose.js';
import { ThreadListModel, UndoEvent } from '../models/ThreadListModel.js';
import { QuickReply, ReplyCloseEvent, ReplyScrollEvent } from '../QuickReply.js';
import { SendAs } from '../SendAs.js';
import { ServerStorage } from '../ServerStorage.js';
import { Settings } from '../Settings.js';
import {
  BACKLOG_PRIORITY_NAME,
  BOOKMARK_PRIORITY_NAME,
  InProgressChangedEvent,
  MUST_DO_PRIORITY_NAME,
  PINNED_PRIORITY_NAME,
  STUCK_LABEL_NAME,
  Thread,
  URGENT_PRIORITY_NAME,
} from '../Thread.js';
import { BASE_THREAD_ACTIONS, REPEAT_ACTION, ARCHIVE_ACTIONS } from '../ThreadActions.js';
import { Timer } from '../Timer.js';
import { Toast } from '../Toast.js';

import { AppShell } from './AppShell.js';
import { FocusRowEvent, LabelState, RenderThreadEvent, ThreadRow } from './ThreadRow.js';
import { SelectRowEvent, ThreadRowGroup, ThreadRowGroupRenderMode } from './ThreadRowGroup.js';
import { ThreadRowGroupList } from './ThreadRowGroupList.js';
import { ThreadRowGroupBase } from './ThreadRowGroupBase.js';
import {
  ThreadListViewBase,
  VIEW_IN_GMAIL_ACTION,
  VIEW_THREADLIST_ACTION,
  PREVIOUS_ACTION,
  NEXT_ACTION,
  OTHER_MENU_ACTION,
  ADD_FILTER_ACTION,
  UNDO_ACTION,
} from './ThreadListViewBase.js';
import { AddFilterDialog } from './AddFilterDialog.js';
import { MailProcessor } from '../MailProcessor.js';

let rowAtOffset = (rows: ThreadRow[], anchorRow: ThreadRow, offset: number): ThreadRow | null => {
  if (offset != -1 && offset != 1) throw `getRowFromRelativeOffset called with offset of ${offset}`;

  let index = rows.indexOf(anchorRow);
  if (index == -1) throw `Tried to get row via relative offset on a row that's not in the dom.`;
  if (0 <= index + offset && index + offset < rows.length) return rows[index + offset];
  return null;
};

interface IgnoredEvent {
  summary: string;
  eventId: string;
  end: number;
}

interface IgnoredDocumentData extends firebase.firestore.DocumentSnapshot {
  ignored: IgnoredEvent[];
}

type ThreadRowGroupMetadata = {
  group: ThreadRowGroupBase;
  rows: ThreadRow[];
};

let QUICK_REPLY_ACTION = {
  name: `Reply`,
  description: `Give a short reply.`,
  key: 'r',
  actionGroup: ActionGroup.Reply,
};

export let NEXT_FULL_ACTION = {
  name: `Next group or last message`,
  description: `Focus the first email of the next group or scroll thread to the last message.`,
  key: 'n',
  secondaryKey: new Shortcut('ArrowDown', false, true),
  hidden: true,
  repeatable: true,
};

export let PREVIOUS_FULL_ACTION = {
  name: `Previous group or first message`,
  description: `Focus the first email of the previous group or scroll thread to the first message..`,
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

let MOVE_UP_ACTION = {
  name: 'mv up',
  description: `Moves the row up in sort order in the Todo view.`,
  key: '[',
  secondaryKey: new Shortcut('ArrowUp', true, false),
  repeatable: true,
  actionGroup: ActionGroup.Other,
};

let MOVE_DOWN_ACTION = {
  name: 'mv down',
  description: `Moves the row down in sort order in the Todo view.`,
  key: ']',
  secondaryKey: new Shortcut('ArrowDown', true, false),
  repeatable: true,
  actionGroup: ActionGroup.Other,
};

let NAVIGATION_ACTIONS = [
  PREVIOUS_ACTION,
  PREVIOUS_FULL_ACTION,
  NEXT_ACTION,
  NEXT_FULL_ACTION,
  INSERT_LINK_HIDDEN,
  VIEW_IN_GMAIL_ACTION,
];

let BASE_ACTIONS = [...ARCHIVE_ACTIONS, ...BASE_THREAD_ACTIONS, ...NAVIGATION_ACTIONS];

let SORT_ACTIONS = [MOVE_UP_ACTION, MOVE_DOWN_ACTION];

let RENDER_ALL_ACTIONS = [TOGGLE_FOCUSED_ACTION, TOGGLE_GROUP_ACTION, VIEW_FOCUSED_ACTION];

let RENDER_ONE_ACTIONS = [QUICK_REPLY_ACTION, VIEW_THREADLIST_ACTION];

registerActions('Todo', [
  ...BASE_ACTIONS,
  ...SORT_ACTIONS,
  ...RENDER_ALL_ACTIONS,
  ...RENDER_ONE_ACTIONS,
]);

export class ThreadListView extends ThreadListViewBase {
  private timerDuration_: number;
  private focusedRow_: ThreadRow | null;
  private undoRow_: ThreadRow | null;
  private noMeetingRoomEvents_?: HTMLElement;
  private rowGroupContainer_: HTMLElement;
  private singleThreadContainer_: HTMLElement;
  private pendingContainer_: HTMLElement;
  private pendingWithSpinner_: HTMLElement;
  private renderedRow_: ThreadRow | null;
  private autoFocusedRow_: ThreadRow | null;
  private lastCheckedRow_: ThreadRow | null;
  private renderedGroupName_: string | null;
  private scrollOffset_?: number;
  private hasNewRenderedRow_: boolean;
  private buttonContainer_: HTMLElement;
  private isVisibleObserver_: IntersectionObserver;
  private isHiddenObserver_: IntersectionObserver;
  private lowPriorityContainer_: ThreadRowGroupList;
  private highPriorityContainer_: ThreadRowGroupList;
  private untriagedContainer_: ThreadRowGroupList;
  private untriagedButton_: HTMLElement;
  private nonLowPriorityWrapper_: HTMLElement;
  private hasHadAction_?: boolean;
  private reply_?: QuickReply | null;
  private boundBeforeUnload_: (e: BeforeUnloadEvent) => void;

  private static ACTIONS_THAT_KEEP_ROWS_: Action[] = [REPEAT_ACTION];

  constructor(
    model: ThreadListModel,
    appShell: AppShell,
    settings: Settings,
    private isTodoView_: boolean,
    private getMailProcessor_?: () => Promise<MailProcessor>,
  ) {
    super(model, appShell, settings);

    this.timerDuration_ = settings.get(ServerStorage.KEYS.TIMER_DURATION);

    this.focusedRow_ = null;
    this.undoRow_ = null;
    this.renderedRow_ = null;
    this.autoFocusedRow_ = null;
    this.lastCheckedRow_ = null;
    this.renderedGroupName_ = null;
    this.hasNewRenderedRow_ = false;
    this.reply_ = null;

    this.boundBeforeUnload_ = (e: BeforeUnloadEvent) => {
      if (this.reply_) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    // Use a larger margin for hiding content than for creating it so that small
    // scrolls up and down don't repeatedly do rendering. Register the hidden
    // observer first so that it runs before the visible one since we always get
    // called back once when we first observe a target.
    this.isHiddenObserver_ = new IntersectionObserver(
      (entries) => {
        entries.map((x) => {
          if (!x.isIntersecting) (x.target as ThreadRowGroup).setInViewport(false);
        });
      },
      { root: this.appShell.getScroller(), rootMargin: '100%' },
    );

    this.isVisibleObserver_ = new IntersectionObserver(
      (entries) => {
        entries.map((x) => {
          if (x.isIntersecting) (x.target as ThreadRowGroup).setInViewport(true);
        });
      },
      { root: this.appShell.getScroller(), rootMargin: '50%' },
    );

    this.pendingWithSpinner_ = document.createElement('div');
    this.pendingWithSpinner_.style.cssText = `
      position: fixed;
      z-index: 10;
      bottom: 100px;
      right: 10px;
      max-width: 300px;
      box-shadow: 0px 0px 8px var(--border-and-hover-color);
      background-color: var(--overlay-background-color);
      height: 7em;
      overflow: auto;
    `;
    this.append(this.pendingWithSpinner_);

    const spinnerContainer = document.createElement('div');
    spinnerContainer.style.cssText = `
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      opacity: 0.4;
      background-color: var(--overlay-background-color);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    `;
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    spinnerContainer.append(spinner);
    this.pendingContainer_ = document.createElement('div');
    this.pendingContainer_.className = 'pending-changes overflow-auto';
    this.pendingWithSpinner_.append(spinnerContainer, this.pendingContainer_);
    this.listen(this.pendingContainer_, InProgressChangedEvent.NAME, () =>
      this.handleInProgressChanged_(),
    );

    this.rowGroupContainer_ = document.createElement('div');
    this.rowGroupContainer_.className = 'flex flex-column';
    this.append(this.rowGroupContainer_);

    this.highPriorityContainer_ = new ThreadRowGroupList();
    this.highPriorityContainer_.className = 'mb2';

    this.lowPriorityContainer_ = new ThreadRowGroupList();
    this.untriagedContainer_ = new ThreadRowGroupList();
    this.untriagedContainer_.className = 'theme-main-background pb2';

    this.untriagedButton_ = createMktimeButton(() => this.routeToUntriaged_(), 'ojan');
    const untriagedWrapper = document.createElement('div');
    untriagedWrapper.className = 'theme-main-background flex justify-center';
    untriagedWrapper.append(this.untriagedButton_);

    this.nonLowPriorityWrapper_ = document.createElement('div');
    this.nonLowPriorityWrapper_.className =
      'flex flex-column relative theme-nested-background-color';
    this.nonLowPriorityWrapper_.append(
      this.untriagedContainer_,
      untriagedWrapper,
      this.highPriorityContainer_,
    );
    this.rowGroupContainer_.append(this.nonLowPriorityWrapper_, this.lowPriorityContainer_);

    this.listen(this.rowGroupContainer_, InProgressChangedEvent.NAME, () =>
      this.handleInProgressChanged_(),
    );
    this.listen(this.rowGroupContainer_, RenderThreadEvent.NAME, (e: Event) => {
      this.setRenderedRow_(e.target as ThreadRow);
    });
    this.listen(this.rowGroupContainer_, FocusRowEvent.NAME, (e: Event) => {
      this.handleFocusRow_(<ThreadRow>e.target);
    });
    this.listen(this.rowGroupContainer_, SelectRowEvent.NAME, (e: Event) => {
      let event = e as SelectRowEvent;
      if (event.selected) this.handleCheckRow_(<ThreadRow>e.target, event.shiftKey);
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

    this.listen(this.model, 'undo', (e: Event) => {
      let undoEvent = <UndoEvent>e;
      this.undoRow_ = this.getThreadRow(undoEvent.thread);
    });

    this.transitionToThreadList_(null);
  }

  private routeToUntriaged_() {
    let a = document.createElement('a');
    a.href = '/untriaged';
    this.append(a);
    a.click();
  }

  private handleInProgressChanged_() {
    this.updatePendingStyling_();
    this.render();
  }

  private meetingsDocument_() {
    return firestoreUserCollection().doc('meetings');
  }

  private async ignoredMeetings_() {
    // TODO: Cache this in memory.
    return (await this.meetingsDocument_().get()).data() as IgnoredDocumentData;
  }

  private async renderCalendar_() {
    this.noMeetingRoomEvents_ = document.createElement('div');

    let events = await this.model.getNoMeetingRoomEvents();
    if (!events.length) return;

    let ignoredData = await this.ignoredMeetings_();
    let ignored = ignoredData ? ignoredData.ignored : [];
    let notIgnored = events.filter((x) => !ignored.find((y) => y.eventId === x.eventId));
    if (!notIgnored.length) return;

    // renderCalendar can get called twice without noMeetingRoomEvents_ being
    // removed due to the await calls above if the user clicks on a thread when
    // we're halfway through the first renderCalendar call.
    if (!this.noMeetingRoomEvents_) return;

    this.noMeetingRoomEvents_.style.cssText = `
      text-align: center;
      margin: 8px 0;
    `;
    this.prepend(this.noMeetingRoomEvents_);

    let eventContainer = document.createElement('div');
    eventContainer.style.cssText = `
      display: flex;
      white-space: nowrap;
      flex-wrap: wrap;
      justify-content: center;
      text-align: start;
      margin-top: 4px;
    `;

    this.noMeetingRoomEvents_.append(
      `Meetings without a local room. Ignore by adding "${NO_ROOM_NEEDED}" to the location.`,
      eventContainer,
    );

    for (let event of notIgnored) {
      this.appendNoMeetingRoomEvent(eventContainer, event);
    }

    // Remove ignored meetings that have passed from firestore.
    let yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    let time = yesterday.getTime();
    let filteredIgnored = ignored.filter((x) => x.end > time);
    if (filteredIgnored.length != ignored.length) {
      await this.meetingsDocument_().set({ ignored: filteredIgnored }, { merge: true });
    }
  }

  private appendNoMeetingRoomEvent(container: HTMLElement, event: CalendarEvent) {
    let item = document.createElement('div');
    item.style.cssText = `
      display: flex;
      border-radius: 3px;
      border: 1px dotted var(--border-and-hover-color);
      margin: 4px;
    `;

    let link = document.createElement('a');
    link.style.cssText = `
      overflow: hidden;
      text-overflow: ellipsis;
      width: 150px;
      padding: 4px;
      color: var(--text-color);
    `;
    link.className = 'hover';
    link.href = event.editUrl;
    link.title = event.summary;
    link.append(`${event.start.getMonth() + 1}/${event.start.getDate()} `, event.summary);

    let xButton = document.createElement('div');
    xButton.title = `Click here to remove if this meeting doesn't need a room.`;
    xButton.className = 'x-button';
    // Override the borders from the stylesheet for x-button.
    xButton.style.cssText = `
      border: 0;
      border-radius: 0;
      width: 20px;
    `;

    xButton.addEventListener('click', async () => {
      let ignoredData = await this.ignoredMeetings_();
      let newIgnored = ignoredData ? ignoredData.ignored : [];
      let ignoredEvent = {
        summary: event.summary,
        eventId: event.eventId,
        end: new Date(event.end).getTime(),
      };
      newIgnored.push(ignoredEvent);

      // TODO: Give some indication that this is blocked on a network request.
      item.remove();
      if (!container.childElementCount) this.clearNoMeetingRooms_();

      await this.meetingsDocument_().set({ ignored: newIgnored }, { merge: true });
    });

    item.append(link, xButton);
    container.append(item);
  }

  private clearNoMeetingRooms_() {
    if (this.noMeetingRoomEvents_) {
      this.noMeetingRoomEvents_.remove();
      this.noMeetingRoomEvents_ = undefined;
    }
  }

  tearDown() {
    super.tearDown();
    this.appShell.setSubject();
    this.appShell.showBackArrow(false);
  }

  private firstSelectedRow_() {
    return this.renderedRow_ || this.getRows().find((x) => x.selected);
  }

  openFirstSelectedThreadInGmail_() {
    // Would prefer to open all the selected rows in gmail, but Chrome only
    // allows one popup per gesture.
    let row = this.firstSelectedRow_();
    if (!row) {
      return;
    }
    this.openThreadInGmail(row.thread);
  }

  async goBack() {
    this.transitionToThreadList_(this.renderedRow_);
  }

  private updateActions_() {
    if (this.reply_) {
      this.reply_ = null;
      window.removeEventListener('beforeunload', this.boundBeforeUnload_);
    }

    const currentRow = this.renderedRow_ ?? this.focusedRow_;
    if (!currentRow) {
      this.setActions(this.model.hasUndoActions() ? [UNDO_ACTION] : []);
      return;
    }

    let viewSpecific = this.renderedRow_ ? RENDER_ONE_ACTIONS : RENDER_ALL_ACTIONS;
    let includeSortActions = this.isTodoView_ && !this.renderedRow_;
    let sortActions = includeSortActions ? SORT_ACTIONS : [];

    let otherMenuActions = [
      currentRow.thread.getLabel() === Labels.Fallback
        ? ADD_FILTER_ACTION
        : cloneAndDisable(ADD_FILTER_ACTION),
      this.model.hasUndoActions() ? UNDO_ACTION : cloneAndDisable(UNDO_ACTION),
      ...sortActions,
    ];

    this.setActions([...BASE_ACTIONS, ...viewSpecific, [OTHER_MENU_ACTION, otherMenuActions]]);

    if (this.renderedRow_) this.addTimer_();
  }

  private updateActionsAndMainBodyMinHeight_() {
    this.updateActions_();

    // Need to do this after we update the toolbar since it can change height.
    // TODO: We should also do this when the window resizes since the toolbars
    // can wrap and change height.
    this.nonLowPriorityWrapper_.style.minHeight = `${this.appShell.getContentHeight() - 70}px`;
  }

  private addTimer_() {
    let row = assert(this.renderedRow_);
    // Timer counts down if in triage view or in any untriaged group.
    let timer = new Timer(
      !!this.model.timerCountsDown || row.thread.forceTriage(),
      this.timerDuration_,
      this.singleThreadContainer_,
    );
    AppShell.addToFooter(timer);
    timer.style.top = `-${timer.offsetHeight}px`;
  }

  private getFirstRow_() {
    return (
      this.untriagedContainer_.getFirstRow() ||
      this.highPriorityContainer_.getFirstRow() ||
      this.lowPriorityContainer_.getFirstRow()
    );
  }

  forceRender() {
    let rows = this.getRows();
    for (let row of rows) {
      row.render();
    }
    this.render();
  }

  protected getGroups() {
    return [
      ...this.untriagedContainer_.getSubGroups(),
      ...this.highPriorityContainer_.getSubGroups(),
      ...this.lowPriorityContainer_.getSubGroups(),
    ];
  }

  // Threads should be in sorted order already and all threads in the same
  // queue should be adjacent to each other. Ensure the order of groups match
  // the new order, but also try to minimize moving things around in the DOM
  // to minimize style recalc.
  private ensureGroupExistenceAndOrder(
    groupMap: Map<string, ThreadRowGroupMetadata>,
    groupNames: Iterable<string>,
  ) {
    let hasOnlyLowPriorityThreads = true;
    let previousUntriaged;
    let previousHighPriority;
    let previousLowPriority;
    for (const groupName of groupNames) {
      const isHighPriority =
        !this.isTodoView_ || [PINNED_PRIORITY_NAME, MUST_DO_PRIORITY_NAME].includes(groupName);
      const isLowPriority =
        this.isTodoView_ &&
        [BOOKMARK_PRIORITY_NAME, URGENT_PRIORITY_NAME, BACKLOG_PRIORITY_NAME].includes(groupName);
      const isUntriaged = !isHighPriority && !isLowPriority;

      if (!isLowPriority) {
        hasOnlyLowPriorityThreads = false;
      }

      let entry = groupMap.get(groupName);
      if (!entry) {
        let renderMode = ThreadRowGroupRenderMode.Default;
        if (this.isTodoView_ && isUntriaged) {
          renderMode = ThreadRowGroupRenderMode.ShowOnlyHighlightedRows;
        } else if (
          this.isTodoView_ ? groupName === PINNED_PRIORITY_NAME : groupName === STUCK_LABEL_NAME
        ) {
          renderMode = ThreadRowGroupRenderMode.MinimalistRows;
        }

        const group = new ThreadRowGroup(groupName, this.model.allowedCount(groupName), renderMode);

        let previousGroup;
        let groupList;
        if (isHighPriority) {
          previousGroup = previousHighPriority && previousHighPriority.group;
          groupList = this.highPriorityContainer_;
        } else if (isLowPriority) {
          previousGroup = previousLowPriority && previousLowPriority.group;
          groupList = this.lowPriorityContainer_;
        } else {
          assert(isUntriaged);
          previousGroup = previousUntriaged && previousUntriaged.group;
          groupList = this.untriagedContainer_;
        }

        if (
          previousGroup ? group.previousSibling !== previousGroup : group !== groupList.firstChild
        ) {
          if (previousGroup) {
            previousGroup.after(group);
          } else {
            groupList.prepend(group);
          }
        }

        entry = { group, rows: [] };
        groupMap.set(groupName, entry);
        // Call observe after putting the group in the DOM so we don't have a
        // race condition where sometimes the group has no
        // dimensions/position.
        this.isVisibleObserver_.observe(group);
        this.isHiddenObserver_.observe(group);
      }
      if (isHighPriority) {
        previousHighPriority = entry;
      } else if (isLowPriority) {
        previousLowPriority = entry;
      } else if (isUntriaged) {
        previousUntriaged = entry;
      }
    }
    return hasOnlyLowPriorityThreads;
  }

  protected renderFrame() {
    let allThreads = this.model.getThreads(true);
    let oldRows = this.getRows();
    // Need to grab this before removing the row.
    const oldRenderedRowGroupList = this.renderedRow_
      ? this.getGroupList_(this.renderedRow_)
      : null;

    let threads = allThreads.filter((x) => !x.actionInProgress());
    let newGroupNames = new Set(threads.map((x) => this.mergedGroupName(x)));
    let removedRows = [];
    let oldGroups = this.getGroups();
    let groupMap: Map<string, ThreadRowGroupMetadata> = new Map();
    // Remove groups that no longer exist.
    for (let group of oldGroups) {
      if (newGroupNames.has(group.name)) {
        groupMap.set(group.name, { group: group, rows: [] });
      } else {
        group.remove();
        this.isVisibleObserver_.unobserve(group);
        this.isHiddenObserver_.unobserve(group);
        removedRows.push(...group.getRows());
      }
    }

    const groupNames = new Set(threads.map((x) => this.mergedGroupName(x)));
    const hasOnlyLowPriorityThreads = this.ensureGroupExistenceAndOrder(groupMap, groupNames);

    for (let thread of threads) {
      let groupName = this.mergedGroupName(thread);
      const entry = groupMap.get(groupName);
      if (!entry) {
        continue;
      }
      let row = this.getThreadRow(thread);
      entry.rows.push(row);
      if (!this.hasHadAction_) {
        entry.group.setCollapsed(true);
      }
    }

    for (let entry of groupMap.values()) {
      if (!entry.rows.length) {
        entry.group.remove();
      } else {
        removedRows.push(...entry.group.setRows(entry.rows));
      }
    }

    const untriagedCount = this.untriagedContainer_.getRows().length;
    const showUntriagedButton = untriagedCount > 2;
    this.untriagedButton_.style.display = showUntriagedButton ? '' : 'none';
    if (showUntriagedButton) {
      this.untriagedButton_.textContent = `Quick triage ${untriagedCount} untriaged threads`;
    }

    this.handleRowsRemoved_(removedRows, oldRows, oldRenderedRowGroupList);

    // Have to do this after we gether the list of removedRows so that
    // handleRowsRemoved_ gets called on the pending threads and focus is
    // updated appropriately.
    let threadsInPending = allThreads.filter((x) => x.actionInProgress());
    this.updatePendingArea_(threadsInPending);

    if (this.undoRow_) {
      if (this.renderedRow_) {
        this.setRenderedRow_(this.undoRow_);
      } else {
        this.setFocus_(this.undoRow_);
      }
      this.undoRow_ = null;
    }

    if (!this.renderedRow_ && (!this.focusedRow_ || this.autoFocusedRow_)) {
      this.autoFocusedRow_ = this.getFirstRow_();
      this.setFocus_(this.autoFocusedRow_);
    }

    // Only set this after the initial update so we don't show the all done
    // indication incorrectly.
    if (this.model.hasFetchedThreads()) {
      if (this.isTodoView_) {
        this.highPriorityContainer_.className = hasOnlyLowPriorityThreads ? 'all-done' : '';
      } else {
        if (threads.length) {
          this.classList.remove('all-done', 'quiet-message');
        } else {
          this.classList.add('all-done', 'quiet-message');
        }
      }
    }

    this.updateThreadRowGroupListDisplay_(this.untriagedContainer_);
    this.updateThreadRowGroupListDisplay_(this.highPriorityContainer_);
    this.updateThreadRowGroupListDisplay_(this.lowPriorityContainer_);

    // Do this async so it doesn't block putting up the frame.
    setTimeout(() => this.prerender_());
  }

  private updateThreadRowGroupListDisplay_(threadRowGroupList: ThreadRowGroupList) {
    threadRowGroupList.style.display = threadRowGroupList.childElementCount === 0 ? 'none' : '';
  }

  private updatePendingArea_(threads: Thread[]) {
    let oldPending = new Set(
      Array.from(this.pendingContainer_.children as HTMLCollectionOf<ThreadRow>),
    );
    for (let thread of threads) {
      let row = this.getThreadRow(thread);
      row.setRenderMode(ThreadRowGroupRenderMode.Default);
      if (oldPending.has(row)) {
        oldPending.delete(row);
        continue;
      }
      this.pendingContainer_.prepend(row);
    }
    for (let row of oldPending) {
      row.remove();
    }
    this.updatePendingStyling_();
  }

  private updatePendingStyling_() {
    const stillHasPendingRows = Array.from(
      this.pendingContainer_.children as HTMLCollectionOf<ThreadRow>,
    ).some((x) => x.thread.actionInProgress());
    this.pendingWithSpinner_.style.display = stillHasPendingRows ? 'flex' : 'none';
  }

  private getGroupList_(row: ThreadRow) {
    let parent = row.parentNode;
    while (parent && !(parent instanceof ThreadRowGroupList)) {
      parent = parent.parentNode;
    }
    return parent;
  }

  private handleRowsRemoved_(
    removedRows: ThreadRow[],
    oldRows: ThreadRow[],
    rendereedRowGroupList: ThreadRowGroupList | null,
  ) {
    let toast: Toast | undefined;
    let current = this.renderedRow_ || this.focusedRow_;
    if (current && removedRows.find((x) => x == current)) {
      // Find the next row in oldRows that isn't also removed.
      let nextRow = null;
      let index = oldRows.findIndex((x) => x == current);
      for (var i = index + 1; i < oldRows.length; i++) {
        let row = oldRows[i];
        if (!removedRows.find((x) => x == row)) {
          nextRow = row;
          break;
        }
      }

      if (this.renderedRow_) {
        if (!nextRow) {
          this.transitionToThreadList_(null);
          return;
        }

        if (rendereedRowGroupList !== this.getGroupList_(nextRow)) {
          this.transitionToThreadList_(nextRow);
          return;
        }

        let newGroupName = this.mergedGroupName(nextRow.thread);
        if (this.renderedGroupName_ !== newGroupName) toast = new Toast(`Now in ${newGroupName}`);
        this.setRenderedRowInternal_(nextRow);
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
    let row;
    if (this.renderedRow_) {
      row = rowAtOffset(this.getRows(), this.renderedRow_, 1);
      assert(row !== this.renderedRow_);
    } else {
      row = this.focusedRow_;
    }

    if (!row) return;

    let rendered = row.rendered;
    rendered.render();
    rendered.style.position = 'absolute';
    rendered.style.bottom = '0';
    rendered.style.visibility = 'hidden';
    this.singleThreadContainer_.append(rendered);
  }

  private setFocus_(row: ThreadRow | null) {
    if (row) {
      let previouslyFocusedGroup = this.focusedRow_ && this.focusedRow_.getGroupMaybeNull();

      let areAnyRowsChecked = this.getRows().some((x) => x.checked);
      let focusImpliesSelected = !areAnyRowsChecked;
      row.setFocus(true, focusImpliesSelected);
      // If the row isn't actually in the tree, then it's focus event won't
      // bubble up to the ThreadListView, so manually set this.focusedRow_.
      if (!row.parentNode) this.setFocusInternal_(row);

      let newGroup = row.getGroup();
      // Ensure the focused group is actually expanded.
      newGroup.setCollapsed(false, true);

      // Collapse the previous group if focused is being moved out of it.
      if (
        previouslyFocusedGroup &&
        previouslyFocusedGroup !== newGroup &&
        !previouslyFocusedGroup.hasSelectedRows()
      ) {
        previouslyFocusedGroup.setCollapsed(true, true);
      }
    } else {
      this.autoFocusedRow_ = null;
      this.setFocusInternal_(null);
    }
  }

  private setFocusInternal_(row: ThreadRow | null) {
    if (this.focusedRow_) this.focusedRow_.clearFocus();
    this.focusedRow_ = row;
    this.updateActionsAndMainBodyMinHeight_();
  }

  private preventAutoFocusFirstRow_() {
    this.autoFocusedRow_ = null;
  }

  private handleFocusRow_(row: ThreadRow) {
    // Once a row gets manually focused, stop auto-focusing.
    if (row !== this.autoFocusedRow_) this.preventAutoFocusFirstRow_();

    if (row !== this.focusedRow_) this.setFocusInternal_(row);
  }

  private handleCheckRow_(row: ThreadRow, rangeSelect: boolean) {
    // Double check that the last selected row is still actually selected.
    if (rangeSelect && this.lastCheckedRow_ && this.lastCheckedRow_.checked) {
      let rows = this.getRows();
      let lastIndex = rows.indexOf(this.lastCheckedRow_);
      let newIndex = rows.indexOf(row);
      let start = lastIndex < newIndex ? lastIndex : newIndex;
      let end = lastIndex < newIndex ? newIndex : lastIndex;
      for (var i = start; i < end; i++) {
        rows[i].setChecked(true);
      }
    }
    this.lastCheckedRow_ = row;
  }

  private setFocusAndScrollIntoView_(row: ThreadRow | null) {
    this.setFocus_(row);
    if (this.focusedRow_) {
      // If the row was in a previously collapsed ThreadRowGroup, then we need
      // to render before trying to scroll it into view.
      if (this.focusedRow_.getBoundingClientRect().height === 0) this.renderFrame();
      this.focusedRow_.scrollIntoView({ block: 'center' });
    }
  }

  private moveRow_(action: Action) {
    let selectedRows = this.getRows().filter((x) => x.selected);
    if (!selectedRows.length) return;

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
      if (row.selected) selected.push(row);
      else if (selected.length) afterFirstSelected.push(row);
      else beforeFirstSelected.push(row);
    }

    if (action === MOVE_UP_ACTION) {
      let itemToMove = beforeFirstSelected.pop();
      if (itemToMove) afterFirstSelected.splice(0, 0, itemToMove);
    } else {
      let itemToMove = afterFirstSelected.shift();
      if (itemToMove) beforeFirstSelected.push(itemToMove);
    }

    let sorted = [...beforeFirstSelected, ...selected, ...afterFirstSelected];
    this.model.setSortOrder(sorted.map((x) => x.thread));
  }

  private moveFocus_(action: Action) {
    let rows = this.getRows();
    if (!rows.length) return;

    let focused = assert(this.focusedRow_);

    switch (action) {
      case NEXT_ACTION: {
        const nextRow = rowAtOffset(rows, focused, 1);
        if (nextRow) this.setFocusAndScrollIntoView_(nextRow);
        break;
      }
      case PREVIOUS_ACTION: {
        const previousRow = rowAtOffset(rows, focused, -1);
        if (previousRow) this.setFocusAndScrollIntoView_(previousRow);
        break;
      }
      case NEXT_FULL_ACTION: {
        let currentGroup = focused.getGroup();
        let newGroup = currentGroup.nextElementSibling as ThreadRowGroup;
        this.focusFirstRowOfGroup_(newGroup);
        break;
      }
      case PREVIOUS_FULL_ACTION: {
        let currentGroup = focused.getGroup();
        let newGroup = currentGroup.previousElementSibling as ThreadRowGroup;
        this.focusFirstRowOfGroup_(newGroup);
        break;
      }
    }
  }

  focusFirstRowOfGroup_(group: ThreadRowGroup) {
    if (!group) return;
    this.setFocusAndScrollIntoView_(group.getFirstRow());
  }

  async takeAction(action: Action) {
    this.hasHadAction_ = true;

    switch (action) {
      case OTHER_MENU_ACTION:
        return true;

      case ADD_FILTER_ACTION:
        let row = this.firstSelectedRow_();
        if (!row) {
          return false;
        }
        new AddFilterDialog(
          this.settings,
          row.thread,
          this.getAllUnfilteredUntriagedThreads(),
          defined(this.getMailProcessor_),
          () => this.updateActions_(),
        );
        return true;

      case UNDO_ACTION:
        this.model.undoLastAction();
        return true;

      case VIEW_IN_GMAIL_ACTION:
        this.openFirstSelectedThreadInGmail_();
        return true;

      case QUICK_REPLY_ACTION:
        await this.showQuickReply();
        return true;

      case MOVE_DOWN_ACTION:
      case MOVE_UP_ACTION:
        this.moveRow_(action);
        return true;

      case NEXT_FULL_ACTION:
      case PREVIOUS_FULL_ACTION:
      case NEXT_ACTION:
      case PREVIOUS_ACTION:
        if (this.renderedRow_) this.renderedRow_.rendered.moveFocus(action);
        else this.moveFocus_(action);
        return true;

      case TOGGLE_FOCUSED_ACTION:
        this.toggleFocused_();
        return true;

      case TOGGLE_GROUP_ACTION:
        this.toggleQueue_();
        return true;

      case VIEW_THREADLIST_ACTION:
        this.transitionToThreadList_(this.renderedRow_);
        return true;

      case VIEW_FOCUSED_ACTION:
        this.viewFocused_();
        return true;

      default:
        return await this.markTriaged_(action);
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

  private viewFocused_() {
    if (!this.focusedRow_) this.moveFocus_(NEXT_ACTION);
    if (!this.focusedRow_) return;
    this.setRenderedRow_(this.focusedRow_);
  }

  private transitionToThreadList_(focusedRow: ThreadRow | null) {
    if (
      this.reply_ &&
      !confirm(
        'Going back to the threadlist will discard the in progress reply. Would you like to proceed?',
      )
    ) {
      return;
    }

    // If you reply to a thread, we might be scrolling the new message into view
    // at this point but we don't want that scroll to keep happening it's it's
    // for the content we're removing.
    stopInProgressScroll();

    this.appShell.showFilterToggle(this.isTodoView_);
    this.appShell.showBackArrow(false);

    this.rowGroupContainer_.style.display = 'flex';
    this.buttonContainer_.style.display = 'flex';
    this.singleThreadContainer_.textContent = '';
    this.appShell.contentScrollTop = this.scrollOffset_ || 0;

    this.setFocusAndScrollIntoView_(focusedRow);
    this.setRenderedRow_(null);
    this.appShell.setSubject();
    this.updateActionsAndMainBodyMinHeight_();

    this.render();
    this.renderCalendar_();
  }

  transitionToSingleThread_() {
    this.appShell.showFilterToggle(false);
    this.appShell.showBackArrow(true);

    this.scrollOffset_ = this.appShell.contentScrollTop;
    this.rowGroupContainer_.style.display = 'none';
    this.buttonContainer_.style.display = 'none';

    this.clearNoMeetingRooms_();
  }

  private async markTriaged_(destination: Action) {
    let threads = this.collectThreadsToTriage_(
      ThreadListView.ACTIONS_THAT_KEEP_ROWS_.includes(destination),
    );

    if (threads.length > 1) {
      let toast = new Toast(`Triaged ${threads.length} threads`);
      AppShell.addToFooter(toast);
    }

    return await this.model.markTriaged(destination, threads);
  }

  private collectThreadsToTriage_(keepRows: boolean) {
    let rows = this.renderedRow_ ? [this.renderedRow_] : this.getRows().filter((x) => x.selected);

    // Queue rerender so that we update the visible threadlist without waiting
    // for firestore changes.
    if (!keepRows && rows.length) this.render();

    return rows.map((x) => {
      // This causes the row to be removed instantly rather than waiting for
      // the action to complete.
      if (!keepRows) x.thread.setActionInProgress(true);
      return x.thread;
    });
  }

  setRenderedRowInternal_(row: ThreadRow | null) {
    this.hasNewRenderedRow_ = !!row;
    if (this.renderedRow_) {
      // Mark read after leaving the rendered thread instead of when first
      // viewing it so that viewing the thread doesn't cause it to change it's
      // sort order as you are reading mail. Technically this is async, but
      // it's OK if this happens async with respect to the surrounding code as
      // well.
      this.renderedRow_.thread.markRead();
      this.renderedRow_.rendered.remove();
    }
    this.renderedRow_ = row;
    // This is read in renderFrame_. At that point, the rendered row will have
    // already been triaged and will no longer have a group name.
    this.renderedGroupName_ = row ? this.mergedGroupName(row.thread) : null;
  }

  setRenderedRow_(row: ThreadRow | null) {
    this.setRenderedRowInternal_(row);
    if (row) this.render();
  }

  renderOne_(toast?: Toast) {
    // If you reply to a thread, we might be scrolling the new message into view
    // at this point but we don't want that scroll to keep happening it's it's
    // for the content we're removing.
    stopInProgressScroll();

    if (this.rowGroupContainer_.style.display !== 'none') this.transitionToSingleThread_();

    this.updateActionsAndMainBodyMinHeight_();
    if (toast) AppShell.addToFooter(toast);

    let renderedRow = notNull(this.renderedRow_);
    let rendered = renderedRow.rendered;
    assert(
      !rendered.isAttached() || rendered.parentNode === this.singleThreadContainer_,
      'Tried to rerender already rendered thread. This should never happen.',
    );

    if (!rendered.isAttached()) {
      rendered.render();
      this.singleThreadContainer_.append(rendered);
    }

    rendered.style.bottom = '';
    rendered.style.visibility = 'visible';

    const noteToSelf = renderedRow.thread.getNoteToSelf();
    if (noteToSelf) {
      noteToSelf.getHtmlOrHtmlWrappedPlain().then((noteHtml) => console.log(noteHtml));
    }

    // Do this even if we don't have any messages yet so that we focus them when
    // the messages come in.
    rendered.queueFocusFirstUnreadOnNextRenderMessages();

    // If you click on a row before it's pulled in message details, handle it
    // semi-gracefully.
    // TODO: Once the message details load, call the code below to add the
    // subject, etc.
    let messages = renderedRow.thread.getMessages();
    if (!messages.length) {
      this.appShell.setSubject();
      return;
    }

    let labelContainer = document.createElement('div');
    let labelState = new LabelState(renderedRow.thread, '');
    ThreadRow.appendLabels(labelContainer, labelState, renderedRow.thread);

    this.setThreadSubject(renderedRow.thread, labelContainer);

    // Check if new messages have come in since we last fetched from the
    // network. Intentionally don't await this since we don't want to
    // make renderOne_ async.
    renderedRow.thread.update();
  }

  async showQuickReply() {
    window.addEventListener('beforeunload', this.boundBeforeUnload_);

    const thread = notNull(this.renderedRow_).thread;
    // TODO: Ojan Store this in this.reply_, show a confirmation warning if
    // there is text typed in the quick reply input if returning to the
    // threadlist, going to a different view, or (via beforeunload) reloading
    // the page. Clear this.reply_ via an event fired from QuickReply's
    // disconnectedCallback.
    this.reply_ = new QuickReply(thread, await SendAs.getDefault());

    this.reply_.addEventListener(ReplyCloseEvent.NAME, () =>
      this.updateActionsAndMainBodyMinHeight_(),
    );

    this.reply_.addEventListener(ReplyScrollEvent.NAME, async () => {
      if (!this.renderedRow_) return;

      let row = this.renderedRow_;
      if (row.thread === thread) {
        row.rendered.showSpinner(true);
        await row.thread.update();
        row.rendered.showSpinner(false);
        row.rendered.moveFocus(NEXT_FULL_ACTION, { behavior: 'smooth' });
      }
    });

    this.setActions([]);
    AppShell.setFooter(this.reply_);
    this.addTimer_();

    this.reply_.focus();
  }
}
window.customElements.define('mt-thread-list-view', ThreadListView);
