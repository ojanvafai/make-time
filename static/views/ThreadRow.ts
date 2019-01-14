import {RenderedThread} from '../RenderedThread.js';
import {Thread} from '../Thread.js';
import {ViewInGmailButton} from '../ViewInGmailButton.js';
import {ThreadRowGroup} from './ThreadRowGroup.js';
import { assert } from '../Base.js';

interface DateFormatOptions {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

let UNCHECKED_BACKGROUND_COLOR = 'white';

export class ThreadRow extends HTMLElement {
  focused_: boolean;
  rendered: RenderedThread;
  mark: boolean|undefined;
  private checkBox_: HTMLInputElement;
  private label_: HTMLElement;
  private messageDetails_: HTMLElement;

  constructor(public thread: Thread) {
    super();
    this.style.cssText = `
      display: flex;
      background-color: ${UNCHECKED_BACKGROUND_COLOR};
    `;

    this.focused_ = false;

    let label = document.createElement('label');
    this.label_ = label;
    label.style.cssText = `
      width: 32px;
      border-right: 0;
      display: flex;
      justify-content: center;
      align-items: center;
    `;

    this.checkBox_ = document.createElement('input');
    this.checkBox_.type = 'checkbox';
    this.checkBox_.style.cssText = `
      margin-left: 5px;
      margin-right: 5px;
    `;
    this.checkBox_.onchange = () => {
      this.checked = this.checkBox_.checked;
    };

    label.append(this.checkBox_);
    this.append(label);

    this.messageDetails_ = document.createElement('div');
    this.messageDetails_.style.cssText = `
      display: flex;
      overflow: hidden;
      flex: 1;
    `;
    this.messageDetails_.onclick = () => {
      this.dispatchEvent(new Event('renderThread', {bubbles: true}));
    };
    this.append(this.messageDetails_);

    this.rendered = new RenderedThread(thread);
    this.renderRow_();
  }

  resetState() {
    // Intentionally use the public setters so that updateHighlight_ gets
    // called.
    this.focused = false;
    this.checked = false;
  }

  getGroup() {
    let parent = this.parentElement;
    while (parent && !(parent instanceof ThreadRowGroup)) {
      parent = parent.parentElement
    }
    return assert(parent, 'Attempted to get the parent group of a ThreadRow not in a group.');
  }

  renderRow_() {
    let subject = this.thread.getSubjectSync();
    let messages = this.thread.getMessagesSync();

    let lastMessage = messages[messages.length - 1];

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
    from.textContent = lastMessage.fromName || '';

    let count = document.createElement('div');
    count.style.cssText = `
      font-size: 80%;
      margin-left: 4px;
      color: grey;
    `;
    if (messages.length > 1)
      count.textContent = String(messages.length);

    fromContainer.append(from, count);

    let snippet = document.createElement('span');
    snippet.style.color = '#666';
    // Snippet as returned by the gmail API is html escaped.
    snippet.innerHTML = ` - ${this.thread.snippet}`;

    let title = document.createElement('div');
    title.append(subject, snippet);
    title.style.cssText = `
      overflow: hidden;
      margin-right: 25px;
      flex: 1;
    `;

    let date = document.createElement('div');
    date.textContent = this.dateString_(lastMessage.date);

    let popoutButton = new ViewInGmailButton();
    popoutButton.setMessageId(messages[messages.length - 1].id);
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
    let options = <DateFormatOptions>{};
    let today = new Date();
    if (today.getFullYear() != date.getFullYear())
      options.year = 'numeric';

    if (today.getMonth() != date.getMonth() ||
        today.getDate() != date.getDate()) {
      options.month = 'short';
      options.day = 'numeric';
    } else {
      options.hour = 'numeric';
      options.minute = 'numeric';
    }

    return date.toLocaleString(undefined, options);
  }

  get focused() {
    return this.focused_;
  }

  set focused(value) {
    this.focused_ = value;
    this.label_.style.backgroundColor = this.focused ? '#ccc' : '';
  }

  get checked() {
    return this.checkBox_.checked;
  }

  set checked(value) {
    this.checkBox_.checked = value;
    this.style.backgroundColor =
        this.checkBox_.checked ? '#c2dbff' : UNCHECKED_BACKGROUND_COLOR;
  }
}

window.customElements.define('mt-thread-row', ThreadRow);
