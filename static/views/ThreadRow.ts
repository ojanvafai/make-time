import {assert, parseAddressList} from '../Base.js';
import {RenderedThread} from '../RenderedThread.js';
import {BLOCKED_LABEL_NAME, Thread, UpdatedEvent} from '../Thread.js';
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
      public subject: string, public snippet: string, public from: string,
      public count: number, public lastMessageId: string, public group: string,
      public label: string|null, public priority: string|null,
      public blocked: Date|null) {}

  equals(other: RowState) {
    return this.subject === other.subject && this.snippet === other.snippet &&
        this.from === other.from && this.count === other.count &&
        this.lastMessageId === other.lastMessageId &&
        this.group === other.group && this.label === other.label &&
        this.priority === other.priority &&
        (this.blocked === other.blocked ||
         this.blocked && other.blocked &&
             this.blocked.getTime() === other.blocked.getTime());
  }
}

export class ThreadRow extends HTMLElement {
  focused_: boolean;
  checked_: boolean;
  focusImpliesSelected_: boolean;
  rendered: RenderedThread;
  mark: boolean|undefined;
  private checkBox_: HTMLInputElement;
  private label_: HTMLElement;
  private messageDetails_: HTMLElement;
  private lastRowState_?: RowState;

  constructor(public thread: Thread) {
    super();
    this.style.cssText = `
      display: flex;
      background-color: ${UNCHECKED_BACKGROUND_COLOR};
    `;

    this.focused_ = false;
    this.checked_ = false;
    this.focusImpliesSelected_ = false;

    let label = document.createElement('div');
    this.label_ = label;
    label.style.cssText = `
      width: 40px;
      border-right: 0;
      display: flex;
      justify-content: center;
      align-items: center;
    `;

    // Pevent the default behavior of text selection on shift+click this is used
    // for range selections. Need to do it on mousedown unfortunately since
    // that's when the selection is modified on some platforms (e.g. mac).
    label.addEventListener('mousedown', e => {
      if (e.shiftKey)
        e.preventDefault();
    });
    label.addEventListener('click', e => this.select(e.shiftKey));

    this.checkBox_ = document.createElement('input');
    this.checkBox_.type = 'checkbox';
    // This pointer-events:none is so that clicking on the checkbox doesn't do
    // anything since we toggle the checked state ourselves. For some reason
    // e.preventDefault() on click doesn't seem to achieve the same result, but
    // couldn't actually reduce it to a small test case to file a bug.
    this.checkBox_.style.cssText = `
      margin-left: 5px;
      margin-right: 5px;
      pointer-events: none;
    `;

    label.append(this.checkBox_);
    this.append(label);

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
    if (this.rendered.isRendered())
      this.rendered.render();
  }

  connectedCallback() {
    this.renderRow_();
  }

  renderRow_() {
    if (!this.parentNode)
      return;

    let snippetText = this.thread.getSnippet();
    let messageIds = this.thread.getMessageIds();
    let blockedDate =
        this.thread.isBlocked() ? this.thread.getBlockedDate() : null;

    let state = new RowState(
        this.thread.getSubject(), ` - ${snippetText}`, this.thread.getFrom(),
        messageIds.length, messageIds[messageIds.length - 1],
        this.getGroup().name, this.thread.getLabel(), this.thread.getPriority(),
        blockedDate);

    // Keep track of the last state we used to render this row so we can avoid
    // rendering new frames when nothing has changed.
    if (this.lastRowState_ && this.lastRowState_.equals(state))
      return;

    this.lastRowState_ = state;

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

    if (state.from) {
      let parsed = parseAddressList(state.from)[0];
      from.textContent = parsed.name || parsed.address;
    } else {
      from.textContent = '\xa0';
    }

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

    if (state.blocked && state.group !== BLOCKED_LABEL_NAME) {
      let blockedString = DAY_MONTH_FORMATTER.format(state.blocked);
      let label = this.createLabel_(blockedString);
      title.append(label);
    }

    if (state.priority && state.group !== state.priority) {
      let label = this.createLabel_(state.priority);
      title.append(label);
    }

    if (state.label && state.group !== state.label) {
      let label = this.createLabel_(state.label);
      title.append(label);
    }

    let snippet = document.createElement('span');
    snippet.style.color = '#666';
    // Snippet as returned by the gmail API is html escaped.
    snippet.innerHTML = state.snippet;
    title.append(state.subject || '\xa0', snippet);

    let date = document.createElement('div');
    date.textContent = this.dateString_(this.thread.getDate());

    let popoutButton = new ViewInGmailButton();
    popoutButton.setMessageId(state.lastMessageId);
    popoutButton.style.marginLeft = '4px';
    popoutButton.style.marginRight = '4px';

    this.messageDetails_.textContent = '';

    // window.innerWidth makes more logical sense for this, but chrome has bugs.
    // crbug.com/960803.
    if (window.outerWidth < 600) {
      this.messageDetails_.style.alignItems = '';

      let topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.append(fromContainer, date, popoutButton);
      this.messageDetails_.append(topRow, title);

      this.messageDetails_.style.flexDirection = 'column';
      fromContainer.style.flex = '1';
      title.style.fontSize = '12px';
      title.style.margin = '5px 5px 0 5px';
    } else {
      this.messageDetails_.style.alignItems = 'center';
      this.messageDetails_.append(fromContainer, title, date, popoutButton);
    }
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
