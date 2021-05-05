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

const PICK_LABEL_TEXT = 'Pick a label';

export class LabelSelect extends HTMLElement {
  private select_: HTMLSelectElement;
  private queueNames_: QueueNames;
  private isOpen_: boolean;

  constructor(private selectedLabel_?: string) {
    super();

    this.queueNames_ = QueueNames.create();
    this.isOpen_ = false;

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
      this.setIsOpen_(false);
      this.dispatchEvent(new LabelSelectedEvent(this.selectedLabel_));
    });

    this.select_.addEventListener('pointerdown', () => this.setIsOpen_(true));
    this.select_.addEventListener('blur', () => this.setIsOpen_(false));

    this.renderOptions_(false);
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

  private setIsOpen_(isOpen: boolean) {
    this.isOpen_ = isOpen;
    if (isOpen) {
      this.setFixedWidth_();
    } else {
      this.select_.style.width = '';
      // Need to remove all the other options so that the width will be set to
      // just the one option.
      this.renderOptions_(true);
    }
    this.renderOptions_(false);
  }

  // Set the width of the select to the width of the currently selected option
  // so that it doesn't expand out and cause things to move around when we put
  // in the whole set of options upon opening the select.
  private setFixedWidth_() {
    if (this.select_.offsetWidth) {
      this.select_.style.width = `${this.select_.offsetWidth}px`;
    }
  }

  private renderOptions_(pretendClosed: boolean) {
    this.select_.textContent = '';

    let labels = this.queueNames_.getCachedNames();

    if (pretendClosed || !this.isOpen_) {
      this.select_.append(
        new Option(
          this.selectedLabel_ && labels.includes(this.selectedLabel_)
            ? this.selectedLabel_
            : PICK_LABEL_TEXT,
        ),
      );
      return;
    }

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
      { name: PICK_LABEL_TEXT, disabled: true },
      'Create new label',
      { name: '', disabled: true },
      { name: 'Built-in labels', disabled: true },
      ...builtInLabels,
      { name: '', disabled: true },
      { name: 'Custom labels', disabled: true },
      ...customLabels,
    ];

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
