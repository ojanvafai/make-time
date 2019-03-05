import {defined, Labels, notNull} from '../Base.js';
import {AllQueueDatas, QueueListEntry, QueueSettings} from '../QueueSettings.js';
import {FiltersChangedEvent, Settings} from '../Settings.js';

export class QueuesView extends HTMLElement {
  private immediate_: HTMLElement|undefined;
  private daily_: HTMLElement|undefined;
  private weekly_: HTMLElement|undefined;
  private monthly_: HTMLElement|undefined;

  static rowClassName_ = 'queue-row';

  constructor(private settings_: Settings) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
      outline: 0;
    `;

    this.onkeydown = (e) => this.handleKeyDown_(e);
    this.settings_.addEventListener(
        FiltersChangedEvent.NAME, () => this.render_());
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
    this.dispatchChange_();

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
    let group = document.createElement('fieldset');
    group.className = groupName.toLowerCase();
    group.style.cssText = `margin-top: 15px;`;

    let legend = document.createElement('legend');
    legend.append(groupName);
    group.append(legend);
    return group;
  }

  private async render_() {
    this.textContent = '';

    let filters = await this.settings_.getFilters();
    let queues: Set<string> = new Set();
    for (let rule of filters) {
      queues.add(defined(rule.label));
    }

    queues.delete(Labels.Archive);
    queues.add(Labels.Fallback);

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

    let queueDatas = this.settings_.getQueueSettings().getSorted(queues);
    for (let queueData of queueDatas) {
      this.appendRow_(queueData);
    }
  }

  extractQueueData_(output: AllQueueDatas, group: HTMLElement, queue: string) {
    let selectors = group.querySelectorAll(`.${QueuesView.rowClassName_}`);
    for (let i = 0; i < selectors.length; i++) {
      let selector = selectors[i];
      let label = selector.querySelector('.label')!.textContent;
      if (queue == QueueSettings.WEEKLY) {
        queue = (<HTMLSelectElement>selector.querySelector('.day')!)
                    .selectedOptions[0]
                    .value;
      }
      output[label] = {queue, index: i + 1};
    }
  }

  getAllQueueDatas() {
    let newQueueData: AllQueueDatas = {};
    this.extractQueueData_(
        newQueueData, this.immediate_!, QueueSettings.IMMEDIATE);
    this.extractQueueData_(newQueueData, this.daily_!, QueueSettings.DAILY);
    this.extractQueueData_(newQueueData, this.weekly_!, QueueSettings.WEEKLY);
    this.extractQueueData_(newQueueData, this.monthly_!, QueueSettings.MONTHLY);
    return newQueueData;
  }

  dispatchChange_() {
    this.dispatchEvent(new Event('change'));
  }

  createSelect_(list: string[], opt_selectedItem?: string) {
    let select = document.createElement('select');
    select.addEventListener('change', () => this.dispatchChange_());
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
