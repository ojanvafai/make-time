
import {shortcutString} from '../Actions.js';
import {collapseArrow, defined, expandArrow, linkify, notNull} from '../Base.js';
import {login} from '../BaseMain.js';
import {ThreadListChangedEvent, ThreadListModel} from '../models/ThreadListModel.js';
import {Settings} from '../Settings.js';
import {Themes} from '../Themes.js';
import {Thread} from '../Thread.js';

import {AppShell} from './AppShell.js';
import {ThreadRow} from './ThreadRow.js';
import {ThreadRowGroupBase} from './ThreadRowGroupBase.js';
import {View} from './View.js';

interface ListenerData {
  target: EventTarget, name: string, handler: (e: Event) => void,
}

export const VIEW_THREADLIST_ACTION = {
  name: `View thread list`,
  description: `Go back to the thread list.`,
  key: 'Escape',
  hidden: true,
};

export const VIEW_IN_GMAIL_ACTION = {
  name: `View in gmail`,
  description: `View the selected thread in gmail.`,
  key: 'v',
  hidden: true,
};

export const NEXT_ACTION = {
  name: `Next`,
  description: `Go to the next row/thread/message.`,
  key: 'j',
  secondaryKey: 'ArrowDown',
  hidden: true,
  repeatable: true,
};

export const PREVIOUS_ACTION = {
  name: `Previous`,
  description: `Go to the previous row/thread/message.`,
  key: 'k',
  secondaryKey: 'ArrowUp',
  hidden: true,
  repeatable: true,
};

export abstract class ThreadListViewBase extends View {
  private listeners_: ListenerData[];
  private threadToRow_: WeakMap<Thread, ThreadRow>;
  private hasQueuedFrame_: boolean;
  private labelSelectTemplate_?: HTMLSelectElement;

  constructor(
      protected model: ThreadListModel, protected appShell: AppShell,
      protected settings: Settings) {
    super();

    this.style.cssText = `
      width: 100%;
      margin: auto;
    `;

    this.listeners_ = [];
    this.threadToRow_ = new WeakMap();
    this.hasQueuedFrame_ = false;

    this.listen(this.model, ThreadListChangedEvent.NAME, () => this.render());
  }

  protected getThreadRow(thread: Thread) {
    let row = this.threadToRow_.get(thread);
    if (!row) {
      row = new ThreadRow(thread, defined(this.labelSelectTemplate_));
      this.threadToRow_.set(thread, row);
    }
    return row;
  };

  protected setThreadSubject(thread: Thread, ...extraSubject: HTMLElement[]) {
    let arrow = document.createElement('span');
    arrow.style.cssText = `
      font-size: 75%;
      height: 20px;
      width: 20px;
      display: flex;
      align-items: center;
    `;

    let subject = document.createElement('div');
    subject.append(thread.getSubject());
    linkify(subject);

    let toggleClamp = () => {
      // Don't toggle if the user has selected part of the subject text.
      if (!(notNull(window.getSelection()).isCollapsed)) {
        return;
      }
      let shouldClamp = subject.style.overflow === '';
      arrow.textContent = '';
      if (shouldClamp) {
        subject.style.overflow = 'hidden';
        subject.style.display = '-webkit-box';
        arrow.append(expandArrow());
      } else {
        subject.style.overflow = '';
        subject.style.display = '';
        arrow.append(collapseArrow());
      }
    };
    subject.addEventListener('click', () => toggleClamp());
    arrow.addEventListener('click', () => toggleClamp());
    toggleClamp();

    this.appShell.setSubject(subject, ...extraSubject);

    // Only show the arrow if there's actual overflow.
    // TODO: Technically we should recompute this when the window changes
    // width.
    if (subject.offsetHeight < subject.scrollHeight)
      subject.before(arrow);
  }

  protected listen(
      target: EventTarget, eventName: string, handler: (e: Event) => void) {
    this.listeners_.push({
      target: target,
      name: eventName,
      handler: handler,
    });
    target.addEventListener(eventName, handler);
  }

  tearDown() {
    for (let listener of this.listeners_) {
      listener.target.removeEventListener(listener.name, listener.handler);
    }
  }

  async init() {
    await login();
    await this.model.loadFromDisk();
    await this.model.update();
  }

  protected createMenuItem(
      container: HTMLElement, clickHandler: () => void,
      ...contents: (string|Element)[]) {
    let item = document.createElement('div');
    item.className = 'menu-item';
    item.append(...contents);
    item.addEventListener('click', () => {
      this.appShell.closeOverflowMenu();
      clickHandler();
    });
    container.append(item);
  }

  protected openThreadInGmail(thread: Thread) {
    let messageIds = thread.getMessageIds();
    // TODO: Fallback to using the threadId in this case.
    if (!messageIds) {
      return;
    }
    let messageId = messageIds[messageIds.length - 1];
    // In theory, linking to the threadId should work, but it doesn't for
    // some threads. Linking to the messageId seems to work reliably. The
    // message ID listed will be expanded in the gmail UI, so link to the
    // last one since that one is definitionally always expanded.
    window.open(`https://mail.google.com/mail/#all/${defined(messageId)}`);
  }

  openOverflowMenu(container: HTMLElement) {
    this.createMenuItem(
        container, () => Themes.toggleDarkMode(), 'Force dark mode');

    let name = document.createElement('div');
    name.style.cssText = `
      flex: 1;
    `;
    name.append(VIEW_IN_GMAIL_ACTION.name);
    let shortcut = document.createElement('div');
    shortcut.style.cssText = `
      color: var(--dim-text-color);
    `;
    shortcut.append(`${shortcutString(VIEW_IN_GMAIL_ACTION.key)}`);

    this.createMenuItem(
        container, () => this.takeAction(VIEW_IN_GMAIL_ACTION), name, shortcut);
  }

  protected abstract getGroups(): ThreadRowGroupBase[];
  protected abstract renderFrame(): void;

  protected getRows() {
    let rows = [];
    let groups = this.getGroups();
    for (let group of groups) {
      rows.push(group.getRows());
    }
    return rows.flat();
  }

  protected getLabelSelectTemplate() {
    return defined(this.labelSelectTemplate_);
  }

  protected async render() {
    if (this.hasQueuedFrame_)
      return;
    this.hasQueuedFrame_ = true;
    if (!this.labelSelectTemplate_)
      this.labelSelectTemplate_ = await this.settings.getLabelSelectTemplate();
    requestAnimationFrame(() => {
      this.hasQueuedFrame_ = false;
      this.renderFrame();
    });
  }

  protected mergedGroupName(thread: Thread) {
    let originalGroupName = this.model.getGroupName(thread);
    return this.settings.getQueueSettings().getMappedGroupName(
               originalGroupName) ||
        originalGroupName;
  }
}
