import {assert} from '../Base.js';
import {RenderedThread} from '../RenderedThread.js';
import {Thread, UpdatedEvent} from '../Thread.js';
import {ViewInGmailButton} from '../ViewInGmailButton.js';

import {ThreadRowGroup} from './ThreadRowGroup.js';

let UNCHECKED_BACKGROUND_COLOR = '#ffffffbb';

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
  constructor(public shiftKey: boolean) {
    super(SelectRowEvent.NAME, {bubbles: true});
  }
}

export class RenderThreadEvent extends Event {
  static NAME = 'render-thread';
  constructor(public shiftKey: boolean) {
    super(RenderThreadEvent.NAME, {bubbles: true});
  }
}

class RowState {
  constructor(
      public isSmallScreen: boolean, public subject: string,
      public snippet: string, public from: string, public count: number,
      public lastMessageId: string, public group: string,
      public label: string|null, public priority: string|null,
      public blocked: Date|null, public due: Date|null,
      public hasRepeat: boolean, public isUnread: boolean,
      public finalVersionSkipped: boolean, public actionInProgress: boolean) {}

  equals(other: RowState) {
    return this.isSmallScreen === other.isSmallScreen &&
        this.subject === other.subject && this.snippet === other.snippet &&
        this.from === other.from && this.count === other.count &&
        this.lastMessageId === other.lastMessageId &&
        this.group === other.group && this.label === other.label &&
        this.priority === other.priority &&
        (this.blocked === other.blocked ||
         this.blocked && other.blocked &&
             this.blocked.getTime() === other.blocked.getTime()) &&
        (this.due && other.due && this.due.getTime() === other.due.getTime()) &&
        this.hasRepeat === other.hasRepeat &&
        this.isUnread === other.isUnread &&
        this.finalVersionSkipped === other.finalVersionSkipped &&
        this.actionInProgress === other.actionInProgress;
  }
}

export class ThreadRow extends HTMLElement {
  private focused_: boolean;
  private checked_: boolean;
  private focusImpliesSelected_: boolean;
  rendered: RenderedThread;
  mark: boolean|undefined;
  private checkBox_: HTMLInputElement;
  private label_: HTMLElement;
  private messageDetails_: HTMLElement;
  private lastRowState_?: RowState;
  private finalVersionSkipped_: boolean;

  constructor(
      public thread: Thread, private showFinalVersion_: boolean,
      private labelSelectTemplate_: HTMLSelectElement) {
    super();
    this.style.cssText = `
      display: flex;
      background-color: ${UNCHECKED_BACKGROUND_COLOR};
    `;

    this.focused_ = false;
    this.checked_ = false;
    this.focusImpliesSelected_ = false;
    this.finalVersionSkipped_ = false;

    if (showFinalVersion_) {
      let container = this.appendCheckboxContainer_();
      let checkbox = this.appendCheckbox_(container);
      checkbox.checked = thread.finalVersion();
      container.addEventListener('click', async () => {
        await this.thread.setOnlyFinalVersion(checkbox.checked);
      });
    }

    this.label_ = this.appendCheckboxContainer_();
    this.checkBox_ = this.appendCheckbox_(this.label_);

    // Pevent the default behavior of text selection on shift+click this is used
    // for range selections. Need to do it on mousedown unfortunately since
    // that's when the selection is modified on some platforms (e.g. mac).
    this.label_.addEventListener('mousedown', e => {
      if (e.shiftKey)
        e.preventDefault();
    });
    this.label_.addEventListener('click', e => this.select(e.shiftKey));

    // This pointer-events:none is so that clicking on the checkbox doesn't do
    // anything since we toggle the checked state ourselves. For some reason
    // e.preventDefault() on click doesn't seem to achieve the same result, but
    // couldn't actually reduce it to a small test case to file a bug.
    this.checkBox_.style.pointerEvents = 'none';
    this.append(this.label_);

    this.messageDetails_ = document.createElement('div');
    this.messageDetails_.style.cssText = `
      display: flex;
      overflow: hidden;
      flex: 1;
    `;

    // Pevent the default behavior of text selection on shift+click this is used
    // for range selections. Need to do it on mousedown unfortunately since
    // that's when the selection is modified on some platforms (e.g. mac). Need
    // to do this on messageDetails_ in additon to the label since the whole row
    // is clickable in Skim view.
    // TODO: See if we need this now that we no longer have Skim view. Should we
    // make the whole row clickable when viewing messages is disallowed in
    // Triage view?
    this.messageDetails_.addEventListener('mousedown', e => {
      if (e.shiftKey)
        e.preventDefault();
    });

    this.messageDetails_.addEventListener('click', (e) => {
      // If the user is selecting the subject line in the row, have that prevent
      // rendering the thread so they can copy-paste the subject.
      if (!this.threadRowContainsSelection_())
        this.dispatchEvent(new RenderThreadEvent(e.shiftKey));
    });
    this.append(this.messageDetails_);

    this.rendered = new RenderedThread(thread);
    thread.addEventListener(
        UpdatedEvent.NAME, () => this.handleThreadUpdated_());
  }

  private appendCheckboxContainer_() {
    let container = document.createElement('div');
    container.style.cssText = `
      width: 40px;
      border-right: 0;
      display: flex;
      justify-content: center;
      align-items: center;
    `;
    this.append(container);
    return container;
  }

  private appendCheckbox_(container: HTMLElement) {
    let checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.style.cssText = `
      margin-left: 5px;
      margin-right: 5px;
    `;

    container.append(checkbox);
    return checkbox;
  }

  select(shiftKey: boolean) {
    this.checked = !this.selected;
    if (this.checked)
      this.dispatchEvent(new SelectRowEvent(shiftKey));
    this.setFocus(true, false);
  }

  threadRowContainsSelection_() {
    let sel = window.getSelection();
    return !sel.isCollapsed &&
        (this.containsNode_(sel.anchorNode) ||
         this.containsNode_(sel.focusNode));
  }

  containsNode_(node: Node) {
    while (node.parentNode) {
      if (node.parentNode == this)
        return true;
      node = node.parentNode;
    }
    return false;
  }

  resetState() {
    // Intentionally use the public setters so that styles are updated.
    this.clearFocus();
    this.checked = false;
  }

  getGroup() {
    let parent = this.parentElement;
    while (parent && !(parent instanceof ThreadRowGroup)) {
      parent = parent.parentElement
    }
    return assert(
        parent,
        'Attempted to get the parent group of a ThreadRow not in a group.');
  }

  private handleThreadUpdated_() {
    this.renderRow_();
    if (this.rendered.isAttached()) {
      // Rerender messages even if the thread is only prerendred in case new
      // messages came in.
      this.rendered.render();
      // If the thread is the actual rendered thread, mark new messages as read.
      if (this.rendered.isRendered())
        this.thread.markRead();
    }
  }

  connectedCallback() {
    this.renderRow_();
  }

  setFinalVersionSkipped(value: boolean) {
    this.finalVersionSkipped_ = value;
    this.renderRow_();
  }

  renderRow_() {
    if (!this.parentNode)
      return;

    let snippetText = this.thread.getSnippet();
    let messageIds = this.thread.getMessageIds();
    let blockedDate =
        this.thread.isBlocked() ? this.thread.getBlockedDate() : null;
    let dueDate = this.thread.hasDueDate() ? this.thread.getDueDate() : null;

    // window.innerWidth makes more logical sense for this, but chrome has bugs.
    // crbug.com/960803.
    let state = new RowState(
        window.outerWidth < 600, this.thread.getSubject(), ` - ${snippetText}`,
        this.thread.getFrom(), messageIds.length,
        messageIds[messageIds.length - 1], this.getGroup().name,
        this.thread.getLabel(), this.thread.getPriority(), blockedDate, dueDate,
        this.thread.hasRepeat(), this.thread.isUnread(),
        this.showFinalVersion_ && this.finalVersionSkipped_,
        this.thread.actionInProgress());

    // Keep track of the last state we used to render this row so we can avoid
    // rendering new frames when nothing has changed.
    if (this.lastRowState_ && this.lastRowState_.equals(state))
      return;

    this.lastRowState_ = state;

    this.style.opacity = state.actionInProgress ? '0.2' : '';
    this.style.display = state.finalVersionSkipped ? 'none' : 'flex';

    let fromContainer = document.createElement('div');
    fromContainer.style.cssText = `
      width: 150px;
      margin-right: 25px;
      padding-left: 5px;
      display: flex;
      align-items: baseline;
    `;

    let from = document.createElement('div');
    from.style.cssText = `
      overflow: hidden;
    `;

    from.textContent = state.from || '\xa0';

    let count = document.createElement('div');
    count.style.cssText = `
      font-size: 80%;
      margin-left: 4px;
      color: grey;
    `;

    if (state.count > 1)
      count.textContent = String(state.count);
    fromContainer.append(from, count);

    let title = document.createElement('div');
    title.style.cssText = `
      overflow: hidden;
      margin-right: 25px;
      flex: 1;
    `;

    // TODO: Make this a date picker for changing the blocked date.
    if (state.blocked) {
      let blockedString = `Stuck: ${DAY_MONTH_FORMATTER.format(state.blocked)}`;
      let label = this.createLabel_(blockedString);
      title.append(label);
    }

    // TODO: Make this a date picker for changing the due date.
    if (state.due) {
      let blockedString = `Due: ${DAY_MONTH_FORMATTER.format(state.due)}`;
      let label = this.createLabel_(blockedString);
      if (state.due < new Date())
        label.style.color = 'red';
      title.append(label);
    }

    // TODO: Make this a select element for changing the priority.
    if (state.priority && state.group !== state.priority) {
      let label = this.createLabel_(state.priority);
      title.append(label);
    }

    if (state.label && state.group !== state.label) {
      let label = this.createSelectChip_(state.label);

      // Clicks on the select shouldn't also be clicks on the row.
      label.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      label.addEventListener('pointerdown', () => {
        label.style.color = '#666';
        label.style.backgroundColor = '#ddd';

        if (label.children.length > 1)
          return;

        let cloned =
            this.labelSelectTemplate_.cloneNode(true) as HTMLSelectElement;
        label.append(...cloned.children);

        (label.children[0] as HTMLOptionElement).selected = true;
      });

      // Remove the extra items so the select shrinks back down to the width of
      // the currently selected one.
      label.addEventListener('blur', () => {
        let toRemove = Array.from(label.children);
        toRemove.shift();
        for (let element of toRemove) {
          element.remove();
        }
      });

      label.addEventListener('change', async () => {
        let newLabel = label.selectedOptions[0].value;
        await this.thread.setOnlyLabel(newLabel);
      });

      title.append(label);
    }

    let snippet = document.createElement('span');
    snippet.style.color = '#666';
    // Snippet as returned by the gmail API is html escaped.
    snippet.innerHTML = state.snippet;

    let subject = document.createElement('span');
    subject.append(state.subject || '\xa0');
    title.append(subject, snippet);

    let repeat;
    if (state.hasRepeat) {
      repeat = document.createElement('div')
      repeat.textContent = '\u{1F501}';
      repeat.style.marginRight = '4px';
    }

    let date = document.createElement('div');
    date.textContent = this.dateString_(this.thread.getDate());
    date.style.cssText = `
      width: 4.5em;
      text-align: right;
    `;

    let boldState = state.isUnread ? '600' : '';
    fromContainer.style.fontWeight = boldState;
    subject.style.fontWeight = boldState;
    date.style.fontWeight = boldState;

    let popoutButton = new ViewInGmailButton();
    popoutButton.setMessageId(state.lastMessageId);
    popoutButton.style.marginLeft = '4px';
    popoutButton.style.marginRight = '4px';

    this.messageDetails_.textContent = '';
    this.messageDetails_.style.flexDirection =
        state.isSmallScreen ? 'column' : '';

    if (state.isSmallScreen) {
      this.messageDetails_.style.alignItems = '';

      let topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.append(fromContainer);
      if (repeat)
        topRow.append(repeat);
      topRow.append(date, popoutButton);
      this.messageDetails_.append(topRow, title);

      fromContainer.style.flex = '1';
      title.style.fontSize = '12px';
      title.style.margin = '5px 5px 0 5px';
    } else {
      this.messageDetails_.style.alignItems = 'center';
      this.messageDetails_.append(fromContainer, title);
      if (repeat)
        this.messageDetails_.append(repeat);
      this.messageDetails_.append(date, popoutButton);
    }
  }

  private createSelectChip_(text: string) {
    let label = document.createElement('select');
    // TODO: Share some code with createLabel_.
    label.style.cssText = `
      display: inline-block;
      color: #666;
      background-color: #ddd;
      font-size: 0.75rem;
      line-height: 18px;
      border: none;
      border-radius: 4px;
      padding: 0 4px;
      margin-right: 4px;
    `;
    label.addEventListener('pointerenter', () => {
      label.style.color = '#ddd';
      label.style.backgroundColor = '#666';
    });
    label.addEventListener('pointerleave', () => {
      label.style.color = '#666';
      label.style.backgroundColor = '#ddd';
    });
    let option = new Option();
    option.append(text);
    label.append(option);
    return label;
  }

  private createLabel_(text: string) {
    let label = document.createElement('span');
    label.style.cssText = `
      display: inline-block;
      color: #666;
      background-color: #ddd;
      font-size: 0.75rem;
      line-height: 18px;
      border-radius: 4px;
      padding: 0 4px;
      margin-right: 4px;
    `;
    label.append(text);
    return label;
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
    this.label_.style.backgroundColor = this.focused_ ? '#ccc' : '';
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
    return this.checked_ || (this.focused_ && this.focusImpliesSelected_);
  }

  get checked() {
    return this.checked_;
  }

  set checked(value) {
    this.checked_ = value;
    this.style.backgroundColor =
        this.checked_ ? '#c2dbff' : UNCHECKED_BACKGROUND_COLOR;
    this.updateCheckbox_();
  }

  updateCheckbox_() {
    this.checkBox_.checked = this.selected;
  }
}

window.customElements.define('mt-thread-row', ThreadRow);
