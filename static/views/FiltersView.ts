import {defined, showDialog} from '../Base.js';
import {Labels} from '../Labels.js';
import {FilterRule, HEADER_FILTER_PREFIX, HeaderFilterRule, isHeaderFilterField, setFilterStringField, Settings} from '../Settings.js';

import {HelpDialog} from './HelpDialog.js';

const CSV_FIELDS = ['from', 'to'];
const CURSOR_SENTINEL = '!!!!!!!!';
const DIRECTIVE_SEPARATOR_ = ':';
const QUERY_SEPARATOR_ = '&&';
export const HELP_TEXT = `<b>Help</b>
Every thread has exactly one filter that applies to it (i.e. gets exactly one label). The filter can apply a label, or archive it (put "${
    Labels
        .Archive}" as the label). This is achieved by having filters be first one wins instead of gmail's filtering where all filters apply. A nice side effect of this is that you can do richer filtering by taking advantage of ordering, e.g. I can have emails to me from my team show up in my inbox immediately, but emails to me from others only show up once a day.

 - Directives separated by "&&" must all apply in order for the rule to match. There is currently no "OR" value and no "NOT" value (patches welcome!).
 - "${
    Labels
        .Archive}" is a special label that removes the unprocessed label from a message, but does not put it in the inbox.
 - Use ctrl+up/down or cmd+up/down to reorder the focused row. Hold shift to move 10 rows at a time.
 - The first rule that matches is the one that applies, so order matters.
 - Label is the label that will apply qhen the rule matches. This is *not* the full label name. The full label name gets prefixed as maketime/.../labelname. Put just the last bit here.
 - Rule is the rule to match.
 - Match All Messages will required the rule to match all the messages in the thread to be considered a match. Otherwise, any message in the thread matching will mean the whole thread matches.
 - No List-ID matches messages that are not sent to an email list.
 - No CCs matches messages that have exactly one email address in the union of the to/cc/bcc fields.
 - Make-time matches all messages in the thread each time the thread is processed, unlike gmail filters which only match the new message.
 - If none of your filters apply to a thread, then make-time will apply a "${
    Labels
        .Fallback}" label. This lets you ensure all mail gets appropriate filters, e.g. when you sign up for a new mailing list, they'll go here until you add a filter rule for the list.

<b>Rule directives</b>
 - <b>$anything:</b> Matches the raw email header "anything". So, $from matches the From header as plain text instead of the structure match that "from:" below does. You can view raw email headers in gmail by going to a message and opening "Show Original" from the "..." menu.
 - <b>to:</b> Matches the to/cc/bcc fields of the email. "foo" will match foo+anything@anything.com, "foo@gmail.com" will match foo@gmail.com and foo+anything@gmail.com, "gmail.com" will match anything@gmail.com.
 - <b>from:</b> Matches the from field of the email. Same matching rules as the "to" directive.
 - <b>subject:</b> Matches if the subject of the email includes this text.
 - <b>plaintext:</b> Matches if the plain text of the email includes this text.
 - <b>htmlcontent:</b> Matches if the HTML of the email includes this text.
`;

export class FiltersView extends HTMLElement {
  // TODO: Stop using an element for maintaining cursor position. Do what
  // AddressCompose does with Ranges instead.
  private cursorSentinelElement_: HTMLElement|undefined;
  private dialog_: HTMLDialogElement|undefined;

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

  moveRow_(direction: string, move10: boolean) {
    // TODO: Put a proper type on this.
    let focused = <any>document.activeElement;

    let row = focused.parentElement;
    while (row && row.tagName != 'TR') {
      row = row.parentElement;
    }
    if (!row)
      return;

    let parent = row.parentElement;
    while (parent && parent != this) {
      parent = parent.parentElement;
    }
    if (!parent)
      return;

    let count = move10 ? 10 : 1;

    if (direction == 'ArrowUp') {
      while (count-- && row.previousSibling) {
        row.previousSibling.before(row);
      }
    } else if (direction == 'ArrowDown') {
      while (count-- && row.nextSibling &&
             !row.nextSibling.hasAttribute('fallback')) {
        row.nextSibling.after(row);
      }
    } else {
      throw `Tried to move row in invalid direction: ${direction}`;
    }

    focused.focus();
  }

  async render_() {
    let rules = await this.settings_.getFilters();

    let container = document.createElement('table');
    container.style.cssText = `font-size: 13px;`;

    let header = document.createElement('thead');
    header.innerHTML =
        `<th></th><th>Label</th><th style="width:100%">Rule</th><th>Match All Messages</th><th>No List-ID</th><th>No CCs</th>`;
    container.append(header);

    let body = document.createElement('tbody');
    for (let rule of rules) {
      body.append(this.createRule_(rule));
    }

    // Ensure there's at least one row since there's no other way to add the
    // first row.
    if (!rules.length)
      body.append(this.createRule_({}));

    body.append(this.createUnfileredRule_());
    container.append(body);

    let scrollable = document.createElement('div');
    scrollable.style.cssText = `
      overflow: auto;
      flex: 1;
    `;
    scrollable.append(container);
    this.append(scrollable);

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
    addButton.onclick = () => {
      let emptyRule = this.createRule_({});
      container.before(emptyRule);
    };
    buttons.append(addButton);

    let label = document.createElement('input');
    label.disabled = true;
    label.classList.add('label');
    label.style.cssText = `width: 50px;`;
    label.value = Labels.Fallback;
    this.appendCell_(container, label);

    this.appendCell_(container, 'This label is applied when no filters match.');
    return container;
  }

  convertToFilterRule(obj: any) {
    let rule: FilterRule = {
      label: obj.label,
    };
    let headerRules: HeaderFilterRule[] = [];
    for (let key in obj) {
      if (isHeaderFilterField(key)) {
        headerRules.push({name: key.substring(1), value: String(obj[key])});
      } else {
        let validField = setFilterStringField(rule, key, obj[key]);
        if (!validField)
          return null;
      }
    }
    if (headerRules.length)
      rule.header = headerRules;
    return rule;
  }

  async save_() {
    let rows = this.querySelectorAll('tbody > tr');
    let rules: FilterRule[] = [];

    for (let row of rows) {
      if (row.hasAttribute('fallback'))
        continue;
      let query = (<HTMLElement>row.querySelector('.query')).textContent;
      let parsed = this.parseQuery_(query, true);
      let rule = this.convertToFilterRule(parsed);
      if (!rule) {
        alert('Rule has invalid field. Not saving filters.');
        return;
      }

      let label = <HTMLInputElement>row.querySelector('.label');

      rule.label = label.value;

      if (rule.label === '') {
        alert('Filter rule has no label. Not saving filters.');
        return;
      }

      let matchAll = <HTMLInputElement>row.querySelector('.matchallmessages');
      if (matchAll.checked)
        rule.matchallmessages = true;

      let noListId = <HTMLInputElement>row.querySelector('.nolistid');
      if (noListId.checked)
        rule.nolistid = true;

      let noCc = <HTMLInputElement>row.querySelector('.nocc');
      if (noCc.checked)
        rule.nocc = true;

      rules.push(rule);
    }
    await this.settings_.writeFilters(rules);

    defined(this.dialog_).close();
  }

  cancel_() {
    // TODO: prompt if there are changes.
    defined(this.dialog_).close();
  }

  appendCell_(container: HTMLElement, item: HTMLElement|string) {
    let td = document.createElement('td');
    td.append(item);
    container.append(td);
    return td;
  }

  createRule_(rule: any) {
    let container = document.createElement('tr');
    container.style.cssText = `
      line-height: 1.7em;
    `;

    let buttons = document.createElement('div');
    buttons.style.display = 'flex';
    this.appendCell_(container, buttons);

    let addButton = document.createElement('span');
    addButton.append('+');
    addButton.classList.add('row-button');
    addButton.onclick = () => {
      let emptyRule = this.createRule_({});
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

    let label = document.createElement('input');
    label.classList.add('label');
    label.style.cssText = `width: 50px;`;
    if (rule.label)
      label.value = rule.label;
    this.appendCell_(container, label);

    let queryParts: any = {};
    for (let field in rule) {
      if (!Settings.FILTERS_RULE_DIRECTIVES.includes(field))
        continue;
      if (field == 'header') {
        let headers = <HeaderFilterRule[]>rule[field];
        for (let header of headers) {
          queryParts[`${HEADER_FILTER_PREFIX}${header.name}`] = header.value;
        }
      } else {
        queryParts[field] = rule[field];
      }
    }

    let editor = this.createQueryEditor_(queryParts);
    editor.classList.add('query');
    this.appendCell_(container, editor);

    this.appendCheckbox_(container, 'matchallmessages', rule.matchallmessages);
    this.appendCheckbox_(container, 'nolistid', rule.nolistid);
    this.appendCheckbox_(container, 'nocc', rule.nocc);

    return container;
  }

  appendCheckbox_(container: HTMLElement, className: string, checked: boolean) {
    let checkbox = document.createElement('input');
    checkbox.classList.add(className);
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    let cell = this.appendCell_(container, checkbox);
    cell.style.textAlign = 'center';
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
        if (!previousEndedInWhiteSpace)
          container.append(space);
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
        color: white;
        background-color: darkolivegreen;
        padding: 1px 2px;
        margin-right: 2px;
        border-radius: 3px;
      `;

      let fieldTextWithoutSentinel =
          fieldText.replace(CURSOR_SENTINEL, '').trim();
      if (!isHeaderFilterField(fieldTextWithoutSentinel) &&
          !Settings.FILTERS_RULE_DIRECTIVES.includes(fieldTextWithoutSentinel))
        fieldElement.classList.add('invalid-directive');

      this.appendWithSentinel_(fieldElement, fieldText);
      container.append(fieldElement);

      let value = queryParts[field];
      previousEndedInWhiteSpace =
          value && value.charAt(value.length - 1) == space;
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

  appendValue_(container: HTMLElement, value: string) {
    let valueElement = document.createElement('span');
    valueElement.style.cssText = `
      background-color: lightgrey;
      padding: 1px 2px;
      border-radius: 3px;
    `;
    this.appendWithSentinel_(valueElement, value);
    container.append(valueElement);
  }

  parseQuery_(query: string, trimWhitespace: boolean) {
    let queryParts: any = {};
    query = query.replace(/[\n\r]/g, '');
    let directives = query.split(QUERY_SEPARATOR_);
    for (let directive of directives) {
      if (!directive)
        continue;

      let colonIndex = directive.indexOf(DIRECTIVE_SEPARATOR_);
      let hasColon = colonIndex != -1;
      let field = hasColon ? directive.substring(0, colonIndex) : directive;
      let value = hasColon ? directive.substring(colonIndex + 1) : '';

      if (trimWhitespace) {
        field = field.trim();
        value = value.trim();
        if (CSV_FIELDS.includes(field))
          value = value.split(',').map(x => x.trim()).join(',');
      }

      if (hasColon && !value)
        field = field + DIRECTIVE_SEPARATOR_;
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
    window.getSelection().selectAllChildren(
        defined(this.cursorSentinelElement_));
  }

  insertSentinelText_() {
    let range = window.getSelection().getRangeAt(0);
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

  createQueryEditor_(queryParts: any) {
    let editor = document.createElement('div');
    editor.contentEditable = 'plaintext-only';
    editor.style.cssText = `
      border: 1px solid #eee;
      padding: 1px;
      font-family: system-ui;
      white-space: pre-wrap;
      word-break: break-word;
    `;
    this.appendQueryParts_(editor, queryParts);

    let undoStack: string[] = [];
    let redoStack_: string[] = [];

    editor.addEventListener('beforeinput', (e) => {
      if (e.inputType == 'historyUndo' || e.inputType == 'historyRedo')
        return;

      redoStack_ = [];
      undoStack.push(this.getEditorTextContentWithSentinel_(editor));
    });

    editor.oninput = (e) => {
      if (e.inputType == 'historyUndo' || e.inputType == 'historyRedo')
        return;

      let content = this.getEditorTextContentWithSentinel_(editor);
      this.setEditorTextAndSelectSentinel_(editor, content);
    };

    editor.onkeydown = (e) => {
      // TODO: Only do metaKey on mac and ctrlKey on non-mac.
      if (e.key == 'z' && (e.metaKey || e.ctrlKey)) {
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
      this.setEditorText_(editor, editor.textContent, true)
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

window.customElements.define('mt-filters', FiltersView);
