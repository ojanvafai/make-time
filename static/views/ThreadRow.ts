import {assert, isMobileUserAgent} from '../Base.js';
import {RenderedThread} from '../RenderedThread.js';
import {SelectBox, SelectChangedEvent} from '../SelectBox.js';
import {ALL, DISABLED, NONE, SOME} from '../SelectBox.js';
import {InProgressChangedEvent, Thread, UpdatedEvent} from '../Thread.js';

import {ThreadRowGroup} from './ThreadRowGroup.js';

let DIFFERENT_YEAR_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

let DIFFERENT_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

let SAME_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: 'numeric',
});

let formattingOptions: {
  year?: string;
  month?: string;
  day?: string;
  hour?: string;
  minute?: string;
} = {
  month: 'short',
  day: 'numeric',
}

let DAY_MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, formattingOptions);

export class FocusRowEvent extends Event {
  static NAME = 'focus-row';
  constructor() {
    super(FocusRowEvent.NAME, {bubbles: true});
  }
}

export class SelectRowEvent extends Event {
  static NAME = 'select-row';
  constructor(public selected: boolean, public shiftKey: boolean) {
    super(SelectRowEvent.NAME, {bubbles: true});
  }
}

export class RenderThreadEvent extends Event {
  static NAME = 'render-thread';
  constructor(public shiftKey: boolean) {
    super(RenderThreadEvent.NAME, {bubbles: true});
  }
}

export class HeightChangedEvent extends Event {
  static NAME = 'row-height-changed';
  constructor() {
    super(HeightChangedEvent.NAME, {bubbles: true});
  }
}

export class LabelState {
  public label: string|null;
  public priority: string|null;
  public blocked: Date|null;
  public due: Date|null;
  public hasRepeat: boolean;

  constructor(thread: Thread, public group: string) {
    this.label = thread.getLabel();
    this.priority = thread.getPriority();
    this.blocked = thread.getBlockedDate();
    this.due = thread.getDueDate();
    this.hasRepeat = thread.hasRepeat();
  }

  equals(other: LabelState) {
    return this.group === other.group && this.label === other.label &&
        this.priority === other.priority &&
        this.datesEqual_(this.blocked, other.blocked) &&
        this.datesEqual_(this.due, other.due) &&
        this.hasRepeat === other.hasRepeat;
  }

  private datesEqual_(a: Date|null, b: Date|null) {
    if (a && b)
      return a.getTime() === b.getTime();
    return a === b;
  }
}

class RowState extends LabelState {
  isSmallScreen: boolean;
  subject: string;
  snippet: string;
  from: HTMLElement;
  isUnread: boolean;
  count: number;
  lastMessageId: string;

  constructor(
      thread: Thread, public group: string,
      public finalVersionSkipped: boolean) {
    super(thread, group);

    // window.innerWidth makes more logical sense for this, but chrome has
    // bugs. crbug.com/960803.
    this.isSmallScreen = window.outerWidth < 600;

    this.subject = thread.getSubject();
    this.snippet = thread.getSnippet();
    this.from = thread.getFrom();
    this.isUnread = thread.isUnread();

    let messageIds = thread.getMessageIds();
    this.count = messageIds.length;
    this.lastMessageId = messageIds[messageIds.length - 1];
  }

  equals(other: RowState): boolean {
    return super.equals(other) && this.isSmallScreen === other.isSmallScreen &&
        this.subject === other.subject && this.snippet === other.snippet &&
        this.from === other.from && this.count === other.count &&
        this.lastMessageId === other.lastMessageId &&
        this.isUnread === other.isUnread &&
        this.finalVersionSkipped === other.finalVersionSkipped;
  }
}

export class ThreadRow extends HTMLElement {
  rendered: RenderedThread;
  mark: boolean|undefined;
  private inViewport_: boolean;
  private focused_: boolean;
  private focusImpliesSelected_: boolean;
  private hovered_: boolean;
  private checkBox_: SelectBox;
  private messageDetails_: HTMLElement;
  private lastRowState_?: RowState;
  private finalVersionSkipped_: boolean;
  private static lastHeightIsSmallScreen_: boolean;
  private static lastHeight_: number;

  constructor(
      public thread: Thread, private showFinalVersion_: boolean,
      private labelSelectTemplate_: HTMLSelectElement) {
    super();
    this.style.cssText = `
      display: flex;
      white-space: nowrap;
      padding-right: 12px;
    `;

    this.inViewport_ = false;
    this.focused_ = false;
    this.focusImpliesSelected_ = false;
    this.hovered_ = false;
    this.finalVersionSkipped_ = false;

    this.checkBox_ = new SelectBox();
    this.append(this.checkBox_);

    if (showFinalVersion_) {
      let checkbox = new SelectBox();
      this.append(checkbox);
      checkbox.select(thread.finalVersion() ? ALL : NONE);
      checkbox.addEventListener(SelectChangedEvent.NAME, async () => {
        await this.thread.setOnlyFinalVersion(checkbox.isFullySelected());
      });
    }

    this.checkBox_.addEventListener(SelectChangedEvent.NAME, e => {
      let rangeSelect = (e as SelectChangedEvent).rangeSelect;
      this.handleCheckedChanged_(rangeSelect);
      this.setFocus(true, false);
    });

    this.messageDetails_ = document.createElement('div');
    this.messageDetails_.style.cssText = `
      display: flex;
      overflow: hidden;
      flex: 1;
      min-height: 40px;
    `;

    // Pevent the default behavior of text selection on shift+click this is
    // used for range selections. Need to do it on mousedown unfortunately
    // since that's when the selection is modified on some platforms (e.g.
    // mac). Need to do this on messageDetails_ in additon to the label since
    // the whole row is clickable in Skim view.
    // TODO: See if we need this now that we no longer have Skim view. Should
    // we make the whole row clickable when viewing messages is disallowed in
    // Triage view?
    this.messageDetails_.addEventListener('mousedown', e => {
      if (e.shiftKey)
        e.preventDefault();
    });

    this.messageDetails_.addEventListener('click', (e) => {
      // If the user is selecting the subject line in the row, have that
      // prevent rendering the thread so they can copy-paste the subject.
      if (!this.threadRowContainsSelection_())
        this.dispatchEvent(new RenderThreadEvent(e.shiftKey));
    });
    this.append(this.messageDetails_);


    this.addEventListener('pointerover', () => {
      this.setHovered_(true);
    });
    this.addEventListener('pointerout', () => {
      this.setHovered_(false);
    });

    this.rendered = new RenderedThread(thread);
    thread.addEventListener(
        UpdatedEvent.NAME, () => this.handleThreadUpdated_());

    // Redispatch this so the ThreadListView picks it up.
    thread.addEventListener(InProgressChangedEvent.NAME, () => {
      // This happens when a triage action completes on a Thread, which means
      // that the row was removed from the view, so we should remove it's
      // previous focused/checked state.
      this.resetState_();
      this.dispatchEvent(new InProgressChangedEvent());
    });

    this.updateCheckbox_();
  }

  static lastHeight() {
    return this.lastHeight_;
  }

  setInViewport(inViewport: boolean) {
    // Don't rerender if inViewport state isn't changing.
    if (this.inViewport_ === inViewport)
      return;
    this.inViewport_ = inViewport;
    this.render();
  }

  private threadRowContainsSelection_() {
    let sel = window.getSelection();
    return !sel.isCollapsed &&
        (this.containsNode_(sel.anchorNode) ||
         this.containsNode_(sel.focusNode));
  }

  private containsNode_(node: Node) {
    while (node.parentNode) {
      if (node.parentNode == this)
        return true;
      node = node.parentNode;
    }
    return false;
  }

  private resetState_() {
    // Intentionally use the public setters so that styles are updated.
    this.clearFocus();
    this.setChecked(false);
  }

  private getGroupMaybeNull_() {
    let parent = this.parentElement;
    while (parent && !(parent instanceof ThreadRowGroup)) {
      parent = parent.parentElement
    }
    return parent;
  }

  getGroup() {
    let parent = this.getGroupMaybeNull_();
    return assert(
        parent,
        'Attempted to get the parent group of a ThreadRow not in a group.');
  }

  private handleThreadUpdated_() {
    this.render();
    if (this.rendered.isAttached()) {
      // Rerender messages even if the thread is only prerendred in case new
      // messages came in.
      this.rendered.render();
      // If the thread is the actual rendered thread, mark new messages as
      // read.
      if (this.rendered.isRendered())
        this.thread.markRead();
    }
  }

  connectedCallback() {
    this.render();
  }

  setFinalVersionSkipped(value: boolean) {
    this.finalVersionSkipped_ = value;
    this.render();
  }

  render() {
    if (!this.inViewport_)
      return;

    if (this.thread.actionInProgress())
      return;

    let group = this.getGroupMaybeNull_();
    if (!group)
      return;

    let state = new RowState(
        this.thread, group.name,
        this.showFinalVersion_ && this.finalVersionSkipped_);

    // Keep track of the last state we used to render this row so we can avoid
    // rendering new frames when nothing has changed.
    if (this.lastRowState_ && this.lastRowState_.equals(state))
      return;

    this.lastRowState_ = state;
    this.style.display = state.finalVersionSkipped ? 'none' : 'flex';

    let fromContainer = document.createElement('div');
    fromContainer.style.cssText = `
      width: 150px;
      display: flex;
      align-items: baseline;
    `;

    let from = document.createElement('div');
    from.style.cssText = `
      overflow: hidden;
      text-transform: uppercase;
      font-size: 12px;
      color: var(--dim-text-color);
  `;
    from.append(state.from)
    fromContainer.append(from);

    if (state.count > 1) {
      let count = document.createElement('div');
      count.style.cssText = `
        font-size: 80%;
        margin: 0 6px;
        color: grey;
      `;
      count.textContent = String(state.count);
      fromContainer.append(count);
    }

    let labels = document.createElement('div');
    ThreadRow.appendLabels(
        labels, state, this.thread, this.labelSelectTemplate_);

    let snippet = document.createElement('span');
    snippet.style.color = '#666';
    // Snippet as returned by the gmail API is html escaped.
    snippet.innerHTML = ` - ${state.snippet}`;

    let justSubject = document.createElement('span');
    justSubject.append(state.subject);

    let subject = document.createElement('span');
    subject.style.cssText = `
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      margin-right: 25px;
    `;
    subject.style.fontSize = isMobileUserAgent() ? '16px' : '14px';
    subject.append(justSubject, snippet);

    let date = document.createElement('div');
    date.textContent = this.dateString_(this.thread.getDate());
    date.style.cssText = `
      text-align: right;
      text-transform: uppercase;
      font-size: 12px;
      color: var(--dim-text-color);
      display: flex;
      align-items: center;
    `;

    let boldState = state.isUnread ? '600' : '';
    justSubject.style.fontWeight = boldState;
    date.style.fontWeight = boldState;

    this.messageDetails_.textContent = '';
    this.messageDetails_.style.flexDirection =
        state.isSmallScreen ? 'column' : '';

    if (state.isSmallScreen) {
      this.messageDetails_.style.padding = '12px 0 12px 4px';
      this.messageDetails_.style.alignItems = '';
      let topRow = document.createElement('div');
      topRow.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 4px;
      `;
      topRow.append(fromContainer, labels, date);
      this.messageDetails_.append(topRow, subject);

      fromContainer.style.flex = '1';
    } else {
      this.messageDetails_.style.padding = '0 0 0 4px';
      this.messageDetails_.style.alignItems = 'center';
      this.messageDetails_.append(fromContainer, labels, subject, date);
    }

    // All rows are the same height, so we can save the last rendered height in
    // a static variable that we can then use to estimate heights for the
    // virtual scrolling. The height of rows only changes if the screen width
    // changes or if the user zooms. We don't currently handle the latter.
    if (state.isSmallScreen !== ThreadRow.lastHeightIsSmallScreen_) {
      ThreadRow.lastHeightIsSmallScreen_ = state.isSmallScreen;
      ThreadRow.lastHeight_ = this.offsetHeight;
    }
  }

  static appendLabels(
      container: HTMLElement, state: LabelState, thread: Thread,
      labelSelect: HTMLSelectElement) {
    // TODO: Make this a date picker for changing the blocked date.
    if (state.blocked) {
      let blockedString = `Stuck: ${DAY_MONTH_FORMATTER.format(state.blocked)}`;
      let label = this.createLabel_(blockedString);
      container.append(label);
    }

    // TODO: Make this a date picker for changing the due date.
    if (state.due) {
      let blockedString = `Due: ${DAY_MONTH_FORMATTER.format(state.due)}`;
      let label = this.createLabel_(blockedString);
      if (state.due < new Date())
        label.style.color = 'red';
      container.append(label);
    }

    // TODO: Make this a select element for changing the priority.
    if (state.priority && state.group !== state.priority) {
      let label = this.createLabel_(state.priority);
      container.append(label);
    }

    if (state.label && state.group !== state.label) {
      let label = this.createSelectChip_(state.label);

      // Clicks on the select shouldn't also be clicks on the row.
      label.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      label.addEventListener('pointerdown', () => {
        if (label.children.length > 1)
          return;

        let cloned = labelSelect.cloneNode(true) as HTMLSelectElement;
        label.append(...cloned.children);

        (label.children[0] as HTMLOptionElement).selected = true;
      });

      // Remove the extra items so the select shrinks back down to the width
      // of the currently selected one.
      let removeUnselected = () => {
        let toRemove = Array.from(label.children) as HTMLOptionElement[];
        for (let element of toRemove) {
          if (!element.selected)
            element.remove();
        }
      };

      label.addEventListener('blur', () => removeUnselected());

      label.addEventListener('change', async () => {
        let newLabel = label.selectedOptions[0].value;
        removeUnselected();
        await thread.setOnlyLabel(newLabel);
      });

      container.append(label);
    }

    if (state.hasRepeat) {
      let repeat = document.createElement('span')
      repeat.textContent = '\u{1F501}';
      repeat.style.marginRight = '4px';
      container.append(repeat);
    }
  }

  private static createSelectChip_(text: string) {
    let label = document.createElement('select');
    this.styleLabel_(label);

    let option = new Option();
    option.append(text);
    label.append(option);

    return label;
  }

  private static createLabel_(text: string) {
    let label = document.createElement('span');
    this.styleLabel_(label);

    label.append(text);
    return label;
  }

  private static styleLabel_(label: HTMLElement) {
    label.className = 'label-chip';
    label.style.cssText = `
      display: inline-block;
      font-size: 0.75rem;
      line-height: 18px;
      margin-right: 4px;
      white-space: nowrap;
    `;
  }

  private dateString_(date: Date) {
    let formatter: Intl.DateTimeFormat;
    let today = new Date();
    if (today.getFullYear() != date.getFullYear()) {
      formatter = DIFFERENT_YEAR_FORMATTER;
    } else if (
        today.getMonth() != date.getMonth() ||
        today.getDate() != date.getDate()) {
      formatter = DIFFERENT_DAY_FORMATTER;
    } else {
      formatter = SAME_DAY_FORMATTER;
    }
    return formatter.format(date);
  }

  setFocus(value: boolean, focusImpliesSelected: boolean) {
    this.focusImpliesSelected_ = focusImpliesSelected;
    this.focused_ = value;
    this.checkBox_.style.backgroundColor =
        this.focused_ ? 'var(--border-and-hover-color)' : '';
    this.updateCheckbox_();
    // TODO: Technically we probably want a blur event as well for !value.
    if (value)
      this.dispatchEvent(new FocusRowEvent());
  }

  clearFocus() {
    this.setFocus(false, false);
  }

  clearFocusImpliesSelected() {
    this.setFocus(this.focused_, false);
  }

  get selected() {
    return this.checked || (this.focused_ && this.focusImpliesSelected_);
  }

  get checked() {
    return this.checkBox_.isFullySelected();
  }

  setChecked(value: boolean, rangeSelect?: boolean) {
    this.checkBox_.select(value ? ALL : NONE);
    this.updateCheckbox_();
    this.handleCheckedChanged_(rangeSelect);
  }

  private handleCheckedChanged_(rangeSelect?: boolean) {
    this.dispatchEvent(new SelectRowEvent(this.checked, !!rangeSelect));
  }

  private setHovered_(hovered: boolean) {
    this.hovered_ = hovered;
    this.updateCheckbox_();
  }

  private updateCheckbox_() {
    let newState;
    if (this.checked)
      newState = ALL;
    else if (this.focused_ && this.focusImpliesSelected_)
      newState = SOME;
    else if (this.focused_ || this.hovered_)
      newState = NONE;
    else
      newState = DISABLED;

    this.checkBox_.select(newState);
  }
}

window.customElements.define('mt-thread-row', ThreadRow);
