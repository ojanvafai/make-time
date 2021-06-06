import { primaryModifierKey } from '../Actions.js';
import { create, createMktimeButton, createTh, defined, Labels, notNull } from '../Base.js';
import { Dialog } from '../Dialog.js';
import {
  AttendeeCount,
  BuiltInRules,
  CalendarRule,
  Frequency,
  setCalendarFilterStringField,
  Settings,
} from '../Settings.js';

import { HelpDialog } from './HelpDialog.js';

const CURSOR_SENTINEL = '!!!!!!!!';
const DIRECTIVE_SEPARATOR_ = ':';
const QUERY_SEPARATOR_ = '&&';
export const HELP_TEXT = [
  create('b', 'Help'),
  `
 - Use ctrl+up/down or cmd+up/down to reorder the focused row. Hold shift to move 10 rows at a time.
 - The first rule that matches is the one that applies, so order matters.
 - Label is the text that will be shown in teh graph.
 - Frequency matches events that are recurring.
 - Attendees is the number of attendees other than yourself
 
`,
  create('b', 'Rule directives'),
  `
 - `,
  create('b', 'title:'),
  ` Matches the to/cc/bcc fields of the email. It just checks if the name or email address includes the value. Takes a comma separated list of values so you don't have to make a different rule for each address you want to match.
 - All rules are case insensitive and can be done as regular expressions by prefixing the value with regexp:, so title:regexp:foo will do a regexp on the title field with the value "foo".
`,
];

export class CalendarFiltersView extends HTMLElement {
  // TODO: Stop using an element for maintaining cursor position. Do what
  // AddressCompose does with Ranges instead.
  private cursorSentinelElement_?: HTMLElement;
  private dialog_?: Dialog;
  private labelSelect_?: HTMLSelectElement;

  constructor(private settings_: Settings) {
    super();
    this.style.cssText = `
      display: flex;
      flex-direction: column;
      width: 800px;
      max-width: 95vw;
    `;

    this.onkeydown = (e) => this.handleKeyDown_(e);
    this.render_();
  }

  handleKeyDown_(e: KeyboardEvent) {
    if (!primaryModifierKey(e)) return;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        this.moveRow_(e.key, e.shiftKey);
        break;

      case 'ArrowDown':
        e.preventDefault();
        this.moveRow_(e.key, e.shiftKey);
        break;
    }
  }

  moveRow_(direction: string, move10: boolean) {
    // TODO: Put a proper type on this.
    let focused = <any>document.activeElement;

    let row = focused.parentElement;
    while (row && row.tagName != 'TR') {
      row = row.parentElement;
    }
    if (!row) return;

    let parent = row.parentElement;
    while (parent && parent != this) {
      parent = parent.parentElement;
    }
    if (!parent) return;

    let count = move10 ? 10 : 1;

    if (direction == 'ArrowUp') {
      while (count-- && row.previousSibling) {
        row.previousSibling.before(row);
      }
    } else if (direction == 'ArrowDown') {
      while (count-- && row.nextSibling && !row.nextSibling.hasAttribute('fallback')) {
        row.nextSibling.after(row);
      }
    } else {
      throw `Tried to move row in invalid direction: ${direction}`;
    }

    focused.focus();
  }

  async getLabelSelect_() {
    if (!this.labelSelect_) {
      this.labelSelect_ = document.createElement('select');
      this.labelSelect_.className = 'label';
      let labels = Array.from(await this.settings_.getCalendarLabels()).sort();
      labels.push('Create new...');
      for (let label of labels) {
        let option = document.createElement('option');
        option.append(label);
        this.labelSelect_.append(option);
      }
    }
    return this.labelSelect_.cloneNode(true) as HTMLSelectElement;
  }

  async render_() {
    let rules = await this.settings_.getCalendarFilters();

    let container = document.createElement('table');
    container.style.cssText = `font-size: 13px;`;

    let ruleHeader = createTh('Rule');
    ruleHeader.style.width = '100%';

    let header = document.createElement('thead');
    header.append(
      createTh(''),
      createTh('Label'),
      ruleHeader,
      createTh('Frequency'),
      createTh('Attendees'),
    );
    container.append(header);

    let body = document.createElement('tbody');
    for (let rule of rules) {
      body.append(await this.createRule_(rule));
    }

    // Ensure there's at least one row since there's no other way to add the
    // first row.
    if (!rules.length) body.append(await this.createRule_());

    let builtInHeaderCell = document.createElement('td');
    builtInHeaderCell.setAttribute('colspan', '5');
    builtInHeaderCell.style.fontWeight = 'bold';
    builtInHeaderCell.append('Built in rules:');

    let builtInHeader = document.createElement('tr');
    builtInHeader.toggleAttribute('fallback');
    builtInHeader.append(builtInHeaderCell);
    body.append(builtInHeader);

    for (let rule of BuiltInRules) {
      body.append(await this.createRule_(rule, true));
    }

    // TODO: Move all the built-in rules here instead of hard coding anything
    // body.append(this.createUnfileredRule_());

    container.append(body);

    let scrollable = document.createElement('div');
    scrollable.style.cssText = `
      overflow: auto;
      flex: 1;
    `;
    scrollable.append(container);
    this.append(scrollable);

    let helpButton = createMktimeButton(() => new HelpDialog(...HELP_TEXT), 'Help');
    helpButton.style.cssText = `margin-right: auto`;
    let cancel = createMktimeButton(() => this.cancel_(), 'cancel');
    let save = createMktimeButton(() => this.save_(), 'save');
    this.dialog_ = new Dialog({ contents: this, buttons: [helpButton, cancel, save] });
  }

  createUnfileredRule_() {
    let container = document.createElement('tr');
    container.toggleAttribute('fallback');
    container.style.cssText = `
      line-height: 1.7em;
    `;

    let buttons = document.createElement('div');
    buttons.style.display = 'flex';
    this.appendCell_(container, buttons);

    let addButton = document.createElement('span');
    addButton.append('+');
    addButton.classList.add('row-button');
    addButton.onclick = async () => {
      let emptyRule = await this.createRule_();
      container.before(emptyRule);
    };
    buttons.append(addButton);

    let label = document.createElement('select');
    label.disabled = true;
    let option = document.createElement('option');
    option.append(Labels.Fallback);
    label.append(option);
    this.appendCell_(container, label);

    this.appendCell_(container, 'This label is applied when no filters match.');
    return container;
  }

  convertToFilterRule(obj: any) {
    let rule: CalendarRule = {
      label: obj.label,
      title: '',
      attendees: AttendeeCount.Any,
      frequency: Frequency.Either,
    };
    for (let key in obj) {
      let validField = setCalendarFilterStringField(rule, key, obj[key]);
      if (!validField) return null;
    }
    return rule;
  }

  async save_() {
    let rows = this.querySelectorAll('tbody > tr');
    let rules: CalendarRule[] = [];

    for (let row of rows) {
      if (row.hasAttribute('fallback')) continue;
      let query = (<HTMLElement>row.querySelector('.query')).textContent;
      if (!query) {
        alert('Rule field is empty. Not saving filters.');
        return;
      }
      let parsed = this.parseQuery_(query, true);
      let rule = this.convertToFilterRule(parsed);
      if (!rule) {
        alert('Rule has invalid field. Not saving filters.');
        return;
      }

      let label = <HTMLSelectElement>row.querySelector('select');
      rule.label = label.selectedOptions[0].value;

      if (rule.label === '') {
        alert('Filter rule has no label. Not saving filters.');
        return;
      }

      let frequency = <HTMLSelectElement>row.querySelector('.frequency');
      rule.frequency = Number(frequency.selectedOptions[0].value);

      let attendees = <HTMLSelectElement>row.querySelector('.attendees');
      rule.attendees = Number(attendees.selectedOptions[0].value);

      rules.push(rule);
    }
    await this.settings_.writeCalendarFilters(rules);

    defined(this.dialog_).remove();
  }

  cancel_() {
    // TODO: prompt if there are changes.
    defined(this.dialog_).remove();
  }

  appendCell_(container: HTMLElement, item: HTMLElement | string) {
    let td = document.createElement('td');
    td.append(item);
    container.append(td);
    return td;
  }

  async createRule_(rule?: CalendarRule, isBuiltIn?: boolean) {
    let container = document.createElement('tr');
    container.style.cssText = `
      line-height: 1.7em;
    `;

    if (isBuiltIn) {
      container.toggleAttribute('fallback');
      container.style.opacity = '0.5';
    }

    let buttons = document.createElement('div');
    buttons.style.display = 'flex';
    this.appendCell_(container, buttons);

    if (!isBuiltIn) {
      let addButton = document.createElement('span');
      addButton.append('+');
      addButton.classList.add('row-button');
      addButton.onclick = async () => {
        let emptyRule = await this.createRule_();
        container.before(emptyRule);
      };
      buttons.append(addButton);

      let minusButton = document.createElement('span');
      minusButton.append('-');
      minusButton.classList.add('row-button');
      minusButton.onclick = () => {
        container.remove();
      };
      buttons.append(minusButton);
    }

    // Add a "new label" option that prompts and then adds that option to all
    // the filter rows.
    let label = await this.getLabelSelect_();
    if (isBuiltIn) label.disabled = true;
    for (let option of label.options) {
      if (rule && option.value === rule.label) {
        option.selected = true;
        break;
      }
    }

    label.addEventListener('change', () => {
      // The last item is the "Create new" label option.
      if (label.selectedIndex !== label.options.length - 1) return;

      this.createLabel_();
      // createLabel_ prepends the new label as the first item.
      label.selectedIndex = 0;
    });
    this.appendCell_(container, label);

    let queryParts: any = {};
    if (rule) {
      for (const [field, value] of Object.entries(rule)) {
        if (!Settings.CALENDAR_RULE_DIRECTIVES.includes(field)) {
          continue;
        }
        queryParts[field] = value;
      }
    }

    let editor = this.createQueryEditor_(queryParts, isBuiltIn);
    editor.classList.add('query');
    this.appendCell_(container, editor);

    this.appendSelect_(container, 'frequency', Frequency, rule && rule.frequency, isBuiltIn);
    this.appendSelect_(container, 'attendees', AttendeeCount, rule && rule.attendees, isBuiltIn);

    return container;
  }

  // TODO: Fix the types. Getting the types right proved to be really hard.
  appendSelect_(
    container: HTMLElement,
    className: string,
    types: any,
    value: any,
    isDisabled?: boolean,
  ) {
    let attendees = document.createElement('select');
    if (isDisabled) attendees.disabled = true;
    attendees.classList.add(className);
    for (let item of Object.values(types)) {
      if (isNaN(Number(item))) continue;

      let option = document.createElement('option');
      option.value = item as any;
      option.append(types[item as any]);
      if (value === item) option.selected = true;

      attendees.append(option);
    }
    this.appendCell_(container, attendees);
  }

  createLabel_() {
    let newLabel = prompt(`Type the new label name`);
    if (!newLabel) return;

    newLabel = newLabel.replace(/\s+/g, '');
    if (!newLabel) return;

    let option = document.createElement('option');
    option.append(newLabel);

    // Add to the template so that newly created rows get the new label as well.
    defined(this.labelSelect_).prepend(option.cloneNode(true));

    let allLabels = this.querySelectorAll('.label');
    for (let label of allLabels) {
      label.prepend(option.cloneNode(true));
    }
  }

  appendWithSentinel_(container: HTMLElement, text: string) {
    let index = text.indexOf(CURSOR_SENTINEL);
    if (index == -1) {
      container.append(text);
      return;
    }

    container.append(text.substring(0, index));
    this.appendSentinelElement_(container);
    container.append(text.substring(index + CURSOR_SENTINEL.length));
  }

  appendSentinelElement_(container: HTMLElement) {
    this.cursorSentinelElement_ = document.createElement('span');
    container.append(this.cursorSentinelElement_);
  }

  appendQueryParts_(container: HTMLElement, queryParts: any) {
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
      if (!Settings.CALENDAR_RULE_DIRECTIVES.includes(fieldTextWithoutSentinel))
        fieldElement.classList.add('invalid-directive');

      this.appendWithSentinel_(fieldElement, fieldText);
      container.append(fieldElement);

      let value = queryParts[field];
      previousEndedInWhiteSpace = value && value.charAt(value.length - 1) == space;
      if (value) {
        fieldElement.append(DIRECTIVE_SEPARATOR_);
        this.appendValue_(container, value);
      }
    }
  }

  appendValue_(container: HTMLElement, value: string) {
    let valueElement = document.createElement('span');
    valueElement.style.cssText = `
      padding: 1px 2px;
      text-decoration: underline var(--dim-text-color);
    `;
    this.appendWithSentinel_(valueElement, value);
    container.append(valueElement);
  }

  parseQuery_(query: string, trimWhitespace: boolean) {
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
      }

      if (hasColon && !value) field = field + DIRECTIVE_SEPARATOR_;
      queryParts[field] = value;
    }
    return queryParts;
  }

  setEditorText_(editor: HTMLElement, text: string, trimWhitespace: boolean) {
    editor.textContent = '';
    let newParts = this.parseQuery_(text, trimWhitespace);
    this.appendQueryParts_(editor, newParts);
  }

  setEditorTextAndSelectSentinel_(editor: HTMLElement, text: string) {
    this.setEditorText_(editor, text, false);
    notNull(window.getSelection()).selectAllChildren(defined(this.cursorSentinelElement_));
  }

  insertSentinelText_() {
    let range = notNull(window.getSelection()).getRangeAt(0);
    let node = new Text(CURSOR_SENTINEL);
    range.insertNode(node);
    return node;
  }

  getEditorTextContentWithSentinel_(editor: HTMLElement) {
    let sentinel = this.insertSentinelText_();
    let content = editor.textContent;
    sentinel.remove();
    return content;
  }

  createQueryEditor_(queryParts: any, isDisabled?: boolean) {
    let editor = document.createElement('div');
    editor.style.cssText = `
      border: 1px solid var(--border-and-hover-color);
      padding: 1px;
      font-family: system-ui;
      white-space: pre-wrap;
      word-break: break-word;
    `;
    this.appendQueryParts_(editor, queryParts);

    if (isDisabled) {
      if (!editor.textContent) editor.textContent = '\xA0';
      return editor;
    }

    editor.contentEditable = 'plaintext-only';

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
      // TODO: Only do metaKey on mac and ctrlKey on non-mac.
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

  createOption_(value: string) {
    let option = document.createElement('option');
    option.value = value;
    option.append(value);
    return option;
  }
}

window.customElements.define('mt-calendar-filters', CalendarFiltersView);
