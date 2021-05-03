import { Labels } from './Base.js';
import { QueueNames } from './QueueNames.js';

export class LabelCreatedEvent extends Event {
  static NAME = 'label-created';
  constructor(public name: string) {
    super(LabelCreatedEvent.NAME, { bubbles: true });
  }
}

export class LabelSelectedEvent extends Event {
  static NAME = 'label-selected';
  constructor(public name: string) {
    super(LabelSelectedEvent.NAME, { bubbles: true });
  }
}

export class LabelSelect extends HTMLElement {
  private select_: HTMLSelectElement;
  private selectedLabel_?: string;
  private queueNames_: QueueNames;

  constructor() {
    super();

    this.queueNames_ = QueueNames.create();

    this.select_ = document.createElement('select');
    this.append(this.select_);

    this.select_.addEventListener('change', async () => {
      // The first non-disabled item is the "Create new" label option.
      if (this.select_.selectedIndex === 1) {
        const label = await this.queueNames_.promptForNewLabel();
        if (label === undefined) {
          return;
        }
        this.selectedLabel_ = label;
      } else {
        this.selectedLabel_ = this.select_.selectedOptions[0].value;
      }
      this.renderOptions_();
      this.dispatchEvent(new LabelSelectedEvent(this.selectedLabel_));
    });

    this.select_.addEventListener('pointerdown', () => {
      this.renderOptions_();
    });

    this.renderOptions_();
  }

  async init() {
    await this.queueNames_.fetch();
  }

  clone() {
    return new LabelSelect();
  }

  getSelectedLabel() {
    return this.selectedLabel_;
  }

  selectLabel(label: string) {
    this.selectedLabel_ = label;
    this.renderOptions_();
  }

  private renderOptions_() {
    let labels = this.queueNames_.getCachedNames();
    labels.sort((a, b) => {
      if (a === Labels.Archive) {
        return -1;
      }
      if (b === Labels.Archive) {
        return 1;
      }
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    });

    const builtInLabels = Object.values(Labels) as string[];
    const customLabels = labels.filter((x) => !builtInLabels.includes(x));
    const allLabels = [
      { name: 'Pick a label', disabled: true },
      'Create new label',
      { name: '', disabled: true },
      { name: 'Built-in labels', disabled: true },
      ...builtInLabels,
      { name: '', disabled: true },
      { name: 'Custom labels', disabled: true },
      ...customLabels,
    ];

    this.select_.textContent = '';

    for (let label of allLabels) {
      let option = document.createElement('option');
      if (typeof label === 'string') {
        option.append(label);
      } else {
        option.append(label.name);
        option.disabled = label.disabled;
      }
      this.select_.append(option);
    }

    for (let option of this.select_.options) {
      if (option.value === this.selectedLabel_) {
        option.selected = true;
        return;
      }
    }
    // If the label doesn't exist, select the first option since it won't get
    // auto-selected due to being disabled.
    this.select_.selectedIndex = 0;
  }
}

window.customElements.define('mt-label-select', LabelSelect);
