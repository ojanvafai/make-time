import {defined, showDialog, notNull} from '../Base.js';
import {QueueListEntry, QueueSettings} from '../QueueSettings.js';

import {HelpDialog} from './HelpDialog.js';

let HELP_TEXT = `<b>Help</b> <a>show more</a>
- Use ctrl+up/down or cmd+up/down to reorder the focused row. Hold shift to move 10 rows at a time.

Pro-tip: I have emails to me from VIPs show up immediately. All other emails are queued to either be daily (to me or one of my primary project's lists), weekly (to lists I need to pay attention to and sometimes reply to) or monthly (to lists I need to keep abrest of but basically never need to reply to). And if it's not something I need to pay attention to, but occasionally need to search for, then its just archived immediately.

Queues can be marked as "Inbox Zero" or "Best Effort". Best Effort queues are only shown after the Inbox Zero threads have all be processed. Best Effort threads are autotriaged to a "bankrupt/queuename" label when they are too old (1 week for daily queues, 2 weeks for weekly, or 6 weeks for monthly). This distinction is especially useful for times when you have to play email catchup (returning from vacation, post perf, etc.). It allows you to focus on at least triaging the potentially important Inbox Zero emails while still getting your non-email work done. Since the queue structure is maintained, you can always go back and get caught up on the bankrupt threads.`;

export class QueuesView extends HTMLElement {
  private immediate_: HTMLElement|undefined;
  private daily_: HTMLElement|undefined;
  private weekly_: HTMLElement|undefined;
  private monthly_: HTMLElement|undefined;
  private dialog_: HTMLDialogElement|undefined;

  static rowClassName_ = 'queue-row';

  constructor(
      private queueNames_: Set<string>,
      private queuedLabelData_: QueueSettings) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
      width: 800px;
      max-width: 95vw;
      outline: 0;
    `;

    this.onkeydown = (e) => this.handleKeyDown_(e);
    this.render_();
  }

  handleKeyDown_(e: KeyboardEvent) {
    // TODO: Use metaKey on mac and ctrlKey elsewhere.
    let hasModifier = e.ctrlKey || e.metaKey;
    if (!hasModifier)
      return;

    switch (e.key) {
      case 'ArrowUp':
        this.moveRow_(e.key, e.shiftKey);
        break;

      case 'ArrowDown':
        this.moveRow_(e.key, e.shiftKey);
        break;
    }
  }

  isChecked_(row: HTMLElement) {
    return (<HTMLInputElement>row.querySelector('input')).checked;
  }

  moveRow_(direction: string, move10: boolean) {
    let rows =
        [].slice.call(this.querySelectorAll(`.${QueuesView.rowClassName_}`));
    let row: HTMLElement|undefined;
    for (let currentRow of rows) {
      if (this.isChecked_(currentRow)) {
        row = currentRow;
        break;
      }
    }
    if (!row)
      return;

    let parent = row.parentNode;
    while (parent && parent != this) {
      parent = parent.parentNode;
    }
    if (!parent)
      return;

    let count = move10 ? 10 : 1;

    if (direction == 'ArrowUp') {
      while (count--) {
        // Switch to the next queue group. Skip over the title for the queue
        // group.
        if (!row.previousSibling ||
            row.previousSibling.nodeType == Node.TEXT_NODE) {
          let parent = notNull(row.parentNode);
          if (parent.previousSibling)
            (<HTMLElement>parent.previousSibling).append(row);
          else
            break;
        } else {
          row.previousSibling.before(row);
        }
      }
    } else if (direction == 'ArrowDown') {
      while (count--) {
        if (!row.nextSibling) {
          let parent = notNull(row.parentNode);
          if (parent.nextSibling)
            parent.nextSibling.firstChild!.after(row);
          else
            break;
        } else {
          row.nextSibling.after(row);
        }
      }
    } else {
      throw `Tried to move row in invalid direction: ${direction}`;
    }

    this.tabIndex = -1;
    this.focus();
  }

  createRowGroup_(groupName: string) {
    let group = document.createElement('div');
    group.className = groupName.toLowerCase();
    group.textContent = groupName;
    group.style.cssText = `margin-top: 15px;`;
    return group;
  }

  async render_() {
    // TODO: Show help text if there are no queues.
    let scrollable = document.createElement('div');
    scrollable.style.cssText = `
      overflow: auto;
      flex: 1;
    `;
    this.append(scrollable);

    this.immediate_ = document.createElement('div');
    this.daily_ = this.createRowGroup_(QueueSettings.DAILY);
    this.weekly_ = this.createRowGroup_(QueueSettings.WEEKLY);
    this.monthly_ = this.createRowGroup_(QueueSettings.MONTHLY);

    scrollable.append(
        this.immediate_, this.daily_, this.weekly_, this.monthly_);

    let queueDatas = this.queuedLabelData_.getSorted(this.queueNames_);
    for (let queueData of queueDatas) {
      this.appendRow_(queueData);
    }

    let helpButton = document.createElement('button');
    helpButton.style.cssText = `margin-right: auto`;
    helpButton.append('Help');
    helpButton.onclick = () => {
      new HelpDialog(HELP_TEXT);
    };

    let cancel = document.createElement('button');
    cancel.append('cancel');
    cancel.onclick = () => this.cancel_();

    let save = document.createElement('button');
    save.append('save');
    save.onclick = () => this.save_();

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      align-items: center;
    `;
    buttonContainer.append(helpButton, cancel, save);
    this.append(buttonContainer);

    this.dialog_ = showDialog(this);
  }

  extractQueueData_(
      output: (string|number)[][], group: HTMLElement, queue: string) {
    let selectors = group.querySelectorAll(`.${QueuesView.rowClassName_}`);
    for (let i = 0; i < selectors.length; i++) {
      let selector = selectors[i];
      let label = selector.querySelector('.label')!.textContent;
      if (queue == QueueSettings.WEEKLY)
        queue = (<HTMLSelectElement>selector.querySelector('.day')!)
                    .selectedOptions[0]
                    .value;
      let goal = (<HTMLSelectElement>selector.querySelector('.goal')!)
                     .selectedOptions[0]
                     .value;
      output.push([label, queue, goal, i + 1]);
    }
  }

  async save_() {
    let newQueueData: (string|number)[][] = [];

    this.extractQueueData_(
        newQueueData, this.immediate_!, QueueSettings.IMMEDIATE);
    this.extractQueueData_(newQueueData, this.daily_!, QueueSettings.DAILY);
    this.extractQueueData_(newQueueData, this.weekly_!, QueueSettings.WEEKLY);
    this.extractQueueData_(newQueueData, this.monthly_!, QueueSettings.MONTHLY);

    if (newQueueData.length) {
      await this.queuedLabelData_.write(newQueueData);
      window.location.reload();
      return;
    }

    defined(this.dialog_).close();
  }

  cancel_() {
    // TODO: prompt if there are changes.
    defined(this.dialog_).close();
  }

  createSelect_(list: string[], opt_selectedItem?: string) {
    let select = document.createElement('select');
    for (let item of list) {
      let option = this.createOption_(item);
      option.selected = opt_selectedItem == item;
      select.append(option);
    }
    return select;
  }

  updateHighlights_() {
    let rows = <NodeListOf<HTMLElement>>this.querySelectorAll(
        `.${QueuesView.rowClassName_}`);
    for (let row of rows) {
      row.style.backgroundColor = this.isChecked_(row) ? '#c2dbff' : 'white';
    }
  }

  appendRow_(queueData: QueueListEntry) {
    let row = document.createElement('div');
    row.style.cssText = `
      display: flex;
    `;
    row.className = QueuesView.rowClassName_;

    let label = document.createElement('label')
    label.style.cssText = `
      flex: 1;
    `;
    label.className = 'label';

    let checkbox = document.createElement('input');
    checkbox.type = 'radio';
    checkbox.name = 'row';
    checkbox.onchange = () => this.updateHighlights_();

    label.append(checkbox, queueData.label);
    row.append(label);

    let queue = queueData.data.queue;
    let days = this.createSelect_(QueueSettings.WEEKDAYS, queue);
    days.className = 'day';
    row.append(days);

    let goal = queueData.data.goal;
    let goals = this.createSelect_(QueueSettings.goals, goal);
    goals.className = 'goal';
    row.append(goals);

    let container = defined(this.getRowContainer_(queue));
    container.append(row);
  }

  getRowContainer_(queue: string) {
    if (queue == QueueSettings.DAILY)
      return this.daily_;
    if (queue == QueueSettings.MONTHLY)
      return this.monthly_;
    if (QueueSettings.WEEKDAYS.includes(queue))
      return this.weekly_;
    return this.immediate_;
  }

  createOption_(value: string) {
    let option = document.createElement('option');
    option.value = value;
    option.append(value);
    return option;
  }
}

window.customElements.define('mt-queues', QueuesView);
