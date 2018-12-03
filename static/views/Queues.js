import { FiltersView } from './Filters.js';
import { showDialog } from '../main.js';
import { QueueSettings } from '../QueueSettings.js';

export class QueuesView extends HTMLElement {
  constructor(queueNames, queuedLabelData) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
      width: 800px;
      max-width: 95vw;
      outline: 0;
    `;

    this.queueNames_ = queueNames;
    this.queuedLabelData_ = queuedLabelData;

    this.onkeydown = (e) => this.handleKeyDown_(e);
    this.render_();
  }

  handleKeyDown_(e) {
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

  isChecked_(row) {
    return row.querySelector('input').checked;
  }

  moveRow_(direction, move10) {
    let rows = [].slice.call(this.querySelectorAll(`.${QueuesView.rowClassName_}`));
    let row;
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
        // Swtich to the next queue group. Skip over the title for the queue group.
        if (!row.previousSibling || row.previousSibling.nodeType == Node.TEXT_NODE) {
          let parent = row.parentNode;
          if (parent.previousSibling)
            parent.previousSibling.append(row);
          else
            break;
        } else {
          row.previousSibling.before(row);
        }
      }
    } else if (direction == 'ArrowDown') {
      while (count--) {
        if (!row.nextSibling) {
          let parent = row.parentNode;
          if (parent.nextSibling)
            parent.nextSibling.firstChild.after(row);
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

  createRowGroup_(groupName) {
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

    scrollable.append(this.immediate_, this.daily_, this.weekly_, this.monthly_);

    let queueDatas = this.queuedLabelData_.getSorted(this.queueNames_);
    for (let queueData of queueDatas) {
      this.appendRow_(queueData);
    }

    let help = document.createElement('div');
    help.style.cssText = `
      flex: 1;
      white-space: pre-wrap;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-top: 4px;
    `;
    help.innerHTML = FiltersView.HELP_TEXT_;

    let expander = help.querySelector('a');
    expander.onclick = () => {
      let existing = window.getComputedStyle(help)['-webkit-line-clamp'];
      // Wow. Setting this to 'none' doens't work. But setting it to 'unset'
      // returns 'none' from computed style.
      let wasUnclamped = existing == 'none';
      help.style['-webkit-line-clamp'] = wasUnclamped ? '2' : 'unset';
      expander.textContent = wasUnclamped ? 'show more' : 'show less';
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
    buttonContainer.append(help, cancel, save);
    this.append(buttonContainer);

    this.dialog_ = showDialog(this);
  }

  extractQueueData_(output, group, queue) {
    let selectors = group.querySelectorAll(`.${QueuesView.rowClassName_}`);
    for (let i = 0; i < selectors.length; i++) {
      let selector = selectors[i];
      let label = selector.querySelector('.label').textContent;
      if (queue == QueueSettings.WEEKLY)
        queue = selector.querySelector('.day').selectedOptions[0].value;
      let goal = selector.querySelector('.goal').selectedOptions[0].value;
      output.push([label, queue, goal, i + 1]);
    }
  }

  async save_() {
    let newQueueData = [];

    this.extractQueueData_(newQueueData, this.immediate_, QueueSettings.IMMEDIATE);
    this.extractQueueData_(newQueueData, this.daily_, QueueSettings.DAILY);
    this.extractQueueData_(newQueueData, this.weekly_, QueueSettings.WEEKLY);
    this.extractQueueData_(newQueueData, this.monthly_, QueueSettings.MONTHLY);

    if (newQueueData.length) {
      await this.queuedLabelData_.write(newQueueData);
      window.location.reload();
      return;
    }

    this.dialog_.close();
  }

  cancel_() {
    // TODO: prompt if there are changes.
    this.dialog_.close();
  }

  createSelect_(list, opt_selectedItem) {
    let select = document.createElement('select');
    for (let item of list) {
      let option = this.createOption_(item);
      option.selected = opt_selectedItem == item;
      select.append(option);
    }
    return select;
  }

  updateHighlights_() {
    /** @type {NodeListOf<HTMLElement>} */
    let rows = document.querySelectorAll(`.${QueuesView.rowClassName_}`);
    for (let row of rows) {
      row.style.backgroundColor = this.isChecked_(row) ? '#c2dbff' : 'white';
    }
  }

  appendRow_(queueData) {
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

    label.append(checkbox, queueData[0]);
    row.append(label);

    let queue = queueData[1].queue;
    let days = this.createSelect_(QueueSettings.WEEKDAYS, queue);
    days.className = 'day';
    row.append(days);

    let goal = queueData[1].goal;
    let goals = this.createSelect_(QueueSettings.goals, goal);
    goals.className = 'goal';
    row.append(goals);

    this.insertRow_(row, queue)
  }

  insertRow_(row, queue) {
    let container = this.immediate_;
    if (queue == QueueSettings.DAILY)
      container = this.daily_;
    else if (queue == QueueSettings.MONTHLY)
      container = this.monthly_;
    else if (QueueSettings.WEEKDAYS.includes(queue))
      container = this.weekly_;
    container.append(row);
  }

  createOption_(value) {
    let option = document.createElement('option');
    option.value = value;
    option.append(value);
    return option;
  }
}

QueuesView.rowClassName_ = 'queue-row';

// TODO: update this text.
QueuesView.HELP_TEXT_ = `<b>Help</b> <a>show more</a>
 - Use ctrl+up/down or cmd+up/down to reorder the focused row. Hold shift to move 10 rows at a time.

 Pro-tip: I have emails to me from VIPs show up immediately. All other emails are queued to either be daily (to me or one of my primary project's lists), weekly (to lists I need to pay attention to and sometimes reply to) or monthly (to lists I need to keep abrest of but basically never need to reply to). And if it's not something I need to pay attention to, but occasionally need to search for, then its just archived immediately.

 Queues can be marked as "Inbox Zero" or "Best Effort". Best Effort queues are only shown after the Inbox Zero threads have all be processed. Best Effort threads are autotriaged to a "bankrupt/queuename" label when they are too old (1 week for daily queues, 2 weeks for weekly, or 6 weeks for monthly). This distinction is especially useful for times when you have to play email catchup (returning from vacation, post perf, etc.). It allows you to focus on at least triaging the potentially important Inbox Zero emails while still getting your non-email work done. Since the queue structure is maintained, you can always go back and get caught up on the bankrupt threads.`;

window.customElements.define('mt-queues', QueuesView);
