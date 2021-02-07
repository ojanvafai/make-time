import { primaryModifierKey } from '../Actions.js';
import { assert, defined, notNull } from '../Base.js';
import { QueueNames } from '../QueueNames.js';
import {
  FilterRule,
  HEADER_FILTER_PREFIX,
  HeaderFilterRule,
  isHeaderFilterField,
  setFilterStringField,
  Settings,
} from '../Settings.js';

const CSV_FIELDS = ['from', 'to'];
const CURSOR_SENTINEL = '!!!!!!!!';
const DIRECTIVE_SEPARATOR_ = ':';
const QUERY_SEPARATOR_ = '&&';

export class LabelCreatedEvent extends Event {
  static NAME = 'label-created';
  constructor(public labelOption: HTMLOptionElement) {
    super(LabelCreatedEvent.NAME, { bubbles: true });
  }
}

export class FilterRuleComponent extends HTMLElement {
  // TODO: Stop using an element for maintaining cursor position. Do what
  // AddressCompose does with Ranges instead.
  private cursorSentinelElement_?: HTMLElement;
  private label_?: HTMLSelectElement;
  private matchAll_: HTMLInputElement;
  private noListId_: HTMLInputElement;
  private noCc_: HTMLInputElement;
  private editor_: HTMLElement;

  constructor(private settings_: Settings, private rule_: any, excludeLabelPicker?: boolean) {
    super();
    this.style.cssText = `
      flex: 1;
    `;

    this.matchAll_ = this.createCheckbox_(this.rule_.matchallmessages);
    this.noListId_ = this.createCheckbox_(this.rule_.nolistid);
    this.noCc_ = this.createCheckbox_(this.rule_.nocc);
    this.editor_ = this.createQueryEditor_();

    let topRow = document.createElement('div');
    topRow.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      align-items: center;
    `;
    topRow.append(
      this.attachLabel_('Match All Messages', this.matchAll_),
      this.attachLabel_('No List-ID', this.noListId_),
      this.attachLabel_('No CCs', this.noCc_),
    );
    this.append(topRow, this.editor_);
    if (!excludeLabelPicker) {
      this.prependLabelPicker_(topRow);
    }
  }

  private attachLabel_(label: string, checkbox: HTMLInputElement) {
    const container = document.createElement('label');
    container.style.cssText = `
      display: flex;
      align-items: center;
      white-space: nowrap;
      margin-right: 24px;
      margin-bottom: 4px;
    `;
    container.append(checkbox, label);
    return container;
  }

  getJson() {
    let parsed = this.getParsedQuery();
    let rule = this.convertToFilterRule_(parsed);
    if (!rule) {
      alert('Rule has invalid field.');
      return;
    }
    if (this.label_) {
      rule.label = this.getSelectedLabel();
    }
    if (this.getMatchAll()) {
      rule.matchallmessages = true;
    }
    if (this.getNoListId()) {
      rule.nolistid = true;
    }
    if (this.getNoCc()) {
      rule.nocc = true;
    }
    return rule;
  }

  private convertToFilterRule_(obj: any) {
    let rule: FilterRule = {
      label: obj.label,
    };
    let headerRules: HeaderFilterRule[] = [];
    for (let key in obj) {
      if (isHeaderFilterField(key)) {
        headerRules.push({ name: key.substring(1), value: String(obj[key]) });
      } else {
        let validField = setFilterStringField(rule, key, obj[key]);
        if (!validField) return null;
      }
    }
    if (headerRules.length) rule.header = headerRules;
    return rule;
  }

  private async createLabelPicker_() {
    // Add a "new label" option that prompts and then adds that option to all
    // the filter rows.
    let label = await this.settings_.getLabelSelect();
    label.style.cssText = `
      margin-right: 16px;
      margin-bottom: 4px;
    `;
    this.label_ = label;

    let option = document.createElement('option');
    option.append('Create new...');
    label.append(option);

    for (let option of label.options) {
      if (option.value === this.rule_.label) {
        option.selected = true;
        break;
      }
    }
    label.addEventListener('change', () => {
      // The last item is the "Create new" label option.
      if (label.selectedIndex !== label.options.length - 1) return;
      const queueNames = QueueNames.create();
      const newLabel = queueNames.promptForNewLabel();
      if (!newLabel) {
        return;
      }
      const option = this.settings_.addLabel(newLabel);
      this.dispatchEvent(new LabelCreatedEvent(option));
      // createLabel_ prepends the new label as the first item.
      label.selectedIndex = 0;
    });

    return label;
  }

  private async prependLabelPicker_(topRow: HTMLElement) {
    topRow.prepend(await this.createLabelPicker_());
  }

  getParsedQuery() {
    let query = this.editor_.textContent;
    return this.parseQuery_(query, true);
  }
  getMatchAll() {
    return this.matchAll_.checked;
  }
  getNoListId() {
    return this.noListId_.checked;
  }
  getNoCc() {
    return this.noCc_.checked;
  }
  getSelectedLabel() {
    return assert(this.label_).selectedOptions[0].value;
  }

  add(name: string, value: string) {
    this.modify_((parsed: any) => (parsed[name] = value));
  }

  delete(name: string) {
    this.modify_((parsed: any) => delete parsed[name]);
  }

  modify_(callback: (parsed: any) => {}) {
    let parsed = this.getParsedQuery();
    callback(parsed);
    this.editor_.textContent = '';
    this.appendQueryParts_(this.editor_, parsed);
  }

  prependLabel(option: HTMLOptionElement) {
    assert(this.label_).prepend(option);
  }

  private createCheckbox_(checked: boolean) {
    let checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    return checkbox;
  }

  private appendWithSentinel_(container: HTMLElement, text: string) {
    let index = text.indexOf(CURSOR_SENTINEL);
    if (index == -1) {
      container.append(text);
      return;
    }

    container.append(text.substring(0, index));
    this.appendSentinelElement_(container);
    container.append(text.substring(index + CURSOR_SENTINEL.length));
  }

  private appendSentinelElement_(container: HTMLElement) {
    this.cursorSentinelElement_ = document.createElement('span');
    container.append(this.cursorSentinelElement_);
  }

  private appendQueryParts_(container: HTMLElement, queryParts: any) {
    let isFirst = true;
    let previousEndedInWhiteSpace = false;
    let space = ' ';

    for (let field in queryParts) {
      let fieldText = field;
      if (!isFirst) {
        if (!previousEndedInWhiteSpace) container.append(space);
        container.append(QUERY_SEPARATOR_);
        if (fieldText.charAt(0) == space) {
          container.append(space);
          fieldText = fieldText.substring(1);
        } else if (field != CURSOR_SENTINEL) {
          container.append(space);
        }
      }
      isFirst = false;

      if (field == CURSOR_SENTINEL) {
        container.append(queryParts[field]);
        this.appendSentinelElement_(container);
        continue;
      }

      let fieldElement = document.createElement('span');
      fieldElement.style.cssText = `
        padding: 1px 2px;
        font-weight: bold;
      `;

      let fieldTextWithoutSentinel = fieldText.replace(CURSOR_SENTINEL, '').trim();
      if (
        !isHeaderFilterField(fieldTextWithoutSentinel) &&
        !Settings.FILTERS_RULE_DIRECTIVES.includes(fieldTextWithoutSentinel)
      )
        fieldElement.classList.add('invalid-directive');

      this.appendWithSentinel_(fieldElement, fieldText);
      container.append(fieldElement);

      let value = queryParts[field];
      previousEndedInWhiteSpace = value && value.charAt(value.length - 1) == space;
      if (value) {
        fieldElement.append(DIRECTIVE_SEPARATOR_);

        if (CSV_FIELDS.includes(field)) {
          let values = value.split(',');
          for (var i = 0; i < values.length; i++) {
            this.appendValue_(container, values[i]);
            if (i + 1 < values.length) {
              let comma = document.createElement('span');
              comma.append(',');
              comma.style.marginRight = '2px';
              container.append(comma);
            }
          }
        } else {
          this.appendValue_(container, value);
        }
      }
    }
  }

  private appendValue_(container: HTMLElement, value: string) {
    let valueElement = document.createElement('span');
    valueElement.style.cssText = `
      padding: 1px 2px;
      text-decoration: underline var(--dim-text-color);
    `;
    this.appendWithSentinel_(valueElement, value);
    container.append(valueElement);
  }

  private parseQuery_(query: string, trimWhitespace: boolean) {
    let queryParts: any = {};
    query = query.replace(/[\n\r]/g, '');
    let directives = query.split(QUERY_SEPARATOR_);
    for (let directive of directives) {
      if (!directive) continue;

      let colonIndex = directive.indexOf(DIRECTIVE_SEPARATOR_);
      let hasColon = colonIndex != -1;
      let field = hasColon ? directive.substring(0, colonIndex) : directive;
      let value = hasColon ? directive.substring(colonIndex + 1) : '';

      if (trimWhitespace) {
        field = field.trim();
        value = value.trim();
        if (CSV_FIELDS.includes(field))
          value = value
            .split(',')
            .map((x) => x.trim())
            .join(',');
      }

      if (hasColon && !value) field = field + DIRECTIVE_SEPARATOR_;
      queryParts[field] = value;
    }
    return queryParts;
  }

  private setEditorText_(editor: HTMLElement, text: string, trimWhitespace: boolean) {
    editor.textContent = '';
    let newParts = this.parseQuery_(text, trimWhitespace);
    this.appendQueryParts_(editor, newParts);
  }

  private setEditorTextAndSelectSentinel_(editor: HTMLElement, text: string) {
    this.setEditorText_(editor, text, false);
    notNull(window.getSelection()).selectAllChildren(defined(this.cursorSentinelElement_));
  }

  private insertSentinelText_() {
    let range = notNull(window.getSelection()).getRangeAt(0);
    let node = new Text(CURSOR_SENTINEL);
    range.insertNode(node);
    return node;
  }

  private getEditorTextContentWithSentinel_(editor: HTMLElement) {
    let sentinel = this.insertSentinelText_();
    let content = editor.textContent;
    sentinel.remove();
    return content;
  }

  private createQueryEditor_() {
    let queryParts: any = {};
    for (let field in this.rule_) {
      if (!Settings.FILTERS_RULE_DIRECTIVES.includes(field)) continue;
      if (field == 'header') {
        let headers = this.rule_[field] as HeaderFilterRule[];
        for (let header of headers) {
          queryParts[`${HEADER_FILTER_PREFIX}${header.name}`] = header.value;
        }
      } else {
        queryParts[field] = this.rule_[field];
      }
    }

    let editor = document.createElement('div');
    editor.contentEditable = 'plaintext-only';
    editor.style.cssText = `
      padding: 1px;
      line-height: 1.7em;
      font-family: system-ui;
      white-space: pre-wrap;
      word-break: break-word;
    `;
    this.appendQueryParts_(editor, queryParts);

    let undoStack: string[] = [];
    let redoStack_: string[] = [];

    editor.addEventListener('beforeinput', (e) => {
      if (e.inputType == 'historyUndo' || e.inputType == 'historyRedo') return;

      redoStack_ = [];
      undoStack.push(this.getEditorTextContentWithSentinel_(editor));
    });

    editor.oninput = (e) => {
      if (e.inputType == 'historyUndo' || e.inputType == 'historyRedo') return;

      let content = this.getEditorTextContentWithSentinel_(editor);
      this.setEditorTextAndSelectSentinel_(editor, content);
    };

    editor.onkeydown = (e) => {
      if (e.key == 'z' && primaryModifierKey(e)) {
        e.preventDefault();

        let popStack = e.shiftKey ? redoStack_ : undoStack;
        let pushStack = e.shiftKey ? undoStack : redoStack_;

        let newValue = popStack.pop();
        if (newValue) {
          pushStack.push(this.getEditorTextContentWithSentinel_(editor));
          this.setEditorTextAndSelectSentinel_(editor, newValue);
        }
      }
    };

    editor.onblur = () => {
      this.setEditorText_(editor, editor.textContent, true);
    };

    return editor;
  }
}

window.customElements.define('mt-filter-rule', FilterRuleComponent);
