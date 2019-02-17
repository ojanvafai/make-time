import {assert, parseAddressList} from '../Base.js';
import {RenderedThread} from '../RenderedThread.js';
import {Thread, UpdatedEvent} from '../Thread.js';
import {ViewInGmailButton} from '../ViewInGmailButton.js';

import {ThreadRowGroup} from './ThreadRowGroup.js';

export const FOCUS_THREAD_ROW_EVENT_NAME = 'focus-thread-row';

let UNCHECKED_BACKGROUND_COLOR = 'white';

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

class RowState {
  constructor(
      public subject: string, public snippet: string, public from: string,
      public count: number, public lastMessageId: string) {}

  equals(other: RowState) {
    return this.subject === other.subject && this.snippet === other.snippet &&
        this.from === other.from && this.count === other.count &&
        this.lastMessageId === other.lastMessageId;
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
    this.focusImpliesSelected_ = true;

    let label = document.createElement('div');
    this.label_ = label;
    label.style.cssText = `
      width: 40px;
      border-right: 0;
      display: flex;
      justify-content: center;
      align-items: center;
    `;
    label.addEventListener('click', () => {
      this.checked = !this.selected;
      this.focused = true;
    });

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
    this.messageDetails_.onclick = () => {
      // If the user is selecting the subject line in the row, have that prevent
      // rendering the thread so they can copy-paste the subject.
      if (!this.threadRowContainsSelection_())
        this.dispatchEvent(new Event('renderThread', {bubbles: true}));
    };
    this.append(this.messageDetails_);

    this.renderRow_();
    this.rendered = new RenderedThread(thread);
    thread.addEventListener(
        UpdatedEvent.NAME, () => this.handleThreadUpdated_());
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
    this.focused = false;
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

  renderRow_() {
    let snippetText = this.thread.getSnippet();
    let messageIds = this.thread.getMessageIds();
    let state = new RowState(
        this.thread.getSubject(), ` - ${snippetText}`, this.thread.getFrom(),
        messageIds.length, messageIds[messageIds.length - 1]);

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

    let snippet = document.createElement('span');
    snippet.style.color = '#666';
    // Snippet as returned by the gmail API is html escaped.
    snippet.innerHTML = state.snippet;

    let title = document.createElement('div');
    title.append(state.subject || '\xa0', snippet);
    title.style.cssText = `
      overflow: hidden;
      margin-right: 25px;
      flex: 1;
    `;

    let date = document.createElement('div');
    date.textContent = this.dateString_(this.thread.getDate());

    let popoutButton = new ViewInGmailButton();
    popoutButton.setMessageId(state.lastMessageId);
    popoutButton.style.marginLeft = '4px';
    popoutButton.style.marginRight = '4px';

    this.messageDetails_.textContent = '';
    if (window.innerWidth < 600) {
      let topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.append(fromContainer, date, popoutButton);
      this.messageDetails_.append(topRow, title);

      this.messageDetails_.style.flexDirection = 'column';
      fromContainer.style.flex = '1';
      title.style.fontSize = '12px';
      title.style.margin = '5px 5px 0 5px';
    } else {
      this.messageDetails_.append(fromContainer, title, date, popoutButton);
    }
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

  get focused() {
    return this.focused_;
  }

  set focused(value) {
    // Changing focus away from this row resets this bit so that later focusing
    // it this checks it again.
    if (!value)
      this.focusImpliesSelected_ = true;

    this.focused_ = value;
    this.label_.style.backgroundColor = this.focused ? '#ccc' : '';
    this.updateCheckbox_();
    // TODO: Technically we probably want a blur event as well for !value.
    if (value) {
      this.dispatchEvent(
          new Event(FOCUS_THREAD_ROW_EVENT_NAME, {bubbles: true}));
    }
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
    this.focusImpliesSelected_ = false;
    this.updateCheckbox_();
  }

  updateCheckbox_() {
    this.checkBox_.checked = this.selected;
  }
}

window.customElements.define('mt-thread-row', ThreadRow);
