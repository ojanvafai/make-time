import { Settings } from '../Settings.js';
import { showDialog } from '../main.js';

export class FiltersView extends HTMLElement {
  constructor(settings) {
    super();
    this.style.cssText = `
      display: flex;
      flex-direction: column;
      width: 800px;
      max-width: 95vw;
    `;
    this.settings_ = settings;
    this.cursorSentinel_ = '!!!!!!!!';
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

  moveRow_(direction, move10) {
    // TODO: Put a proper type on this.
    /** @type {any} */
    let focused = document.activeElement;

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
      while (count-- && row.nextSibling) {
        row.nextSibling.after(row);
      }
    } else {
      throw `Tried to move row in invalid direction: ${direction}`;
    }

    focused.focus();
  }

  async render_() {
    let filters = await this.settings_.getFilters();
    let rules = filters.rules;

    let container = document.createElement('table');
    container.style.cssText = `font-size: 13px;`;

    let header = document.createElement('thead');
    header.innerHTML = `<th></th><th>Label</th><th style="width:100%">Rule</th><th>Match All Messages</th><th>No List-ID</th>`;
    container.append(header);

    let body = document.createElement('tbody');
    for (let rule of rules) {
      body.append(this.createRule_(rule));
    }

    // Ensure there's at least one row since there's no other way to add the first row.
    if (!rules.length)
      body.append(this.createRule_({}));

    container.append(body);

    let scrollable = document.createElement('div');
    scrollable.style.cssText = `
      overflow: auto;
      flex: 1;
    `;
    scrollable.append(container);
    this.append(scrollable);

    let help = document.createElement('div');
    help.style.cssText = `
      flex: 1;
      white-space: pre-wrap;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-top: 4px;
      font-size: 13px;
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

  async save_() {
    let rows = this.querySelectorAll('tbody > tr');
    let rules = [];
    for (let row of rows) {
      let query = row.querySelector('.query').textContent;
      let rule = this.parseQuery_(query, true);

      /** @type {HTMLInputElement}*/
      let label = row.querySelector('.label');
      rule.label = label.value;

      /** @type {HTMLInputElement}*/
      let matchAll = row.querySelector('.matchallmessages');
      if (matchAll.checked)
        rule.matchallmessages = 'yes';

      /** @type {HTMLInputElement}*/
      let noListId = row.querySelector('.nolistid')
      if (noListId.checked)
        rule.nolistid = true;

      rules.push(rule);
    }
    await this.settings_.writeFilters(rules);
    this.dialog_.close();
  }

  cancel_() {
    // TODO: prompt if there are changes.
    this.dialog_.close();
  }

  appendCell_(container, item) {
    let td = document.createElement('td');
    td.append(item);
    container.append(td);
    return td;
  }

  createRule_(rule) {
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
    minusButton.onclick = () => { container.remove(); };
    buttons.append(minusButton);

    let label = document.createElement('input');
    label.classList.add('label');
    label.style.cssText = `width: 50px;`;
    if (rule.label)
      label.value = rule.label;
    this.appendCell_(container, label);

    let queryParts = {};
    for (let field in rule) {
      if (!Settings.FILTERS_RULE_DIRECTIVES.includes(field))
        continue;
      queryParts[field] = rule[field];
    }

    let editor = this.createQueryEditor_(queryParts);
    editor.classList.add('query');
    this.appendCell_(container, editor);

    this.appendCheckbox_(container, 'matchallmessages', rule.matchallmessages);
    this.appendCheckbox_(container, 'nolistid', rule.nolistid);

    return container;
  }

  appendCheckbox_(container, className, value) {
    let checkbox = document.createElement('input');
    checkbox.classList.add(className);
    checkbox.type = 'checkbox';
    checkbox.checked = value == 'yes' || value == 'true';
    let cell = this.appendCell_(container, checkbox);
    cell.style.textAlign = 'center';
  }

  appendWithSentinel_(container, text) {
    let index = text.indexOf(this.cursorSentinel_);
    if (index == -1) {
      container.append(text);
      return;
    }

    container.append(text.substring(0, index));
    this.appendSentinelElement_(container);
    container.append(text.substring(index + this.cursorSentinel_.length));
  }

  appendSentinelElement_(container) {
    this.cursorSentinelElement_ = document.createElement('span');
    container.append(this.cursorSentinelElement_);
  }

  appendQueryParts_(container, queryParts) {
    let isFirst = true;
    let previousEndedInWhiteSpace = false;
    let space = ' ';

    for (let field in queryParts) {
      let fieldText = field;
      if (!isFirst) {
        if (!previousEndedInWhiteSpace)
          container.append(space);
        container.append(FiltersView.QUERY_SEPARATOR_);
        if (fieldText.charAt(0) == space) {
          container.append(space);
          fieldText = fieldText.substring(1);
        } else if (field != this.cursorSentinel_) {
          container.append(space);
        }
      }
      isFirst = false;

      if (field == this.cursorSentinel_) {
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

      let fieldTextWithoutSentinel = fieldText.replace(this.cursorSentinel_, '').trim();
      if (!Settings.FILTERS_RULE_DIRECTIVES.includes(fieldTextWithoutSentinel))
        fieldElement.classList.add('invalid-directive');

      this.appendWithSentinel_(fieldElement, fieldText);
      container.append(fieldElement);

      let value = queryParts[field];
      previousEndedInWhiteSpace = value && value.charAt(value.length - 1) == space;
      if (value) {
        fieldElement.append(FiltersView.DIRECTIVE_SEPARATOR_);

        let valueElement = document.createElement('span');
        valueElement.style.cssText = `
          background-color: lightgrey;
          padding: 1px 2px;
          border-radius: 3px;
        `;
        this.appendWithSentinel_(valueElement, value);
        container.append(valueElement);
      }
    }
  }

  parseQuery_(query, trimWhitespace) {
    let queryParts = {};
    query = query.replace(/[\n\r]/g, '');
    let directives = query.split(FiltersView.QUERY_SEPARATOR_);
    for (let directive of directives) {
      if (!directive)
        continue;

      let colonIndex = directive.indexOf(FiltersView.DIRECTIVE_SEPARATOR_);
      let hasColon = colonIndex != -1;
      let field = hasColon ? directive.substring(0, colonIndex) : directive;
      let value = hasColon ? directive.substring(colonIndex + 1) : '';

      if (trimWhitespace) {
        field = field.trim();
        value = value.trim();
      }

      if (hasColon && !value)
        field = field + FiltersView.DIRECTIVE_SEPARATOR_;
      queryParts[field] = value;
    }
    return queryParts;
  }

  setEditorText_(editor, text, trimWhitespace) {
    editor.textContent = '';
    let newParts = this.parseQuery_(text, trimWhitespace);
    this.appendQueryParts_(editor, newParts);
  }

  setEditorTextAndSelectSentinel_(editor, text) {
    this.setEditorText_(editor, text, false);
    window.getSelection().selectAllChildren(this.cursorSentinelElement_);
  }

  insertSentinelText_() {
    let range = window.getSelection().getRangeAt(0);
    let node = document.createTextNode(this.cursorSentinel_);
    range.insertNode(node);
    return node;
  }

  getEditorTextContentWithSentinel_(editor) {
    let sentinel = this.insertSentinelText_();
    let content = editor.textContent;
    sentinel.remove();
    return content;
  }

  createQueryEditor_(queryParts) {
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

    let undoStack = [];
    let redoStack_ = [];

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

  createOption_(value) {
    let option = document.createElement('option');
    option.value = value;
    option.append(value);
    return option;
  }
}

FiltersView.DIRECTIVE_SEPARATOR_ = ':';
FiltersView.QUERY_SEPARATOR_ = '&&';
FiltersView.HELP_TEXT_ = `<b>Help</b> <a>show more</a>
Every thread has exactly one filter that applies to it (i.e. gets exactly one label). The filter can apply a label, or archive it (put "archive" as the label). This is achieved by having filters be first one wins instead of gmail's filtering where all filters apply. A nice side effect of this is that you can do richer filtering by taking advantage of ordering, e.g. I can have emails to me from my team show up in my inbox immediately, but emails to me from others only show up once a day.

 - Directives separated by "&&" must all apply in order for the rule to match. There is currently no "OR" value and no "NOT" value (patches welcome!).
 - "archive" is a special label that removes the unprocessed label from a message, but does not put it in the inbox.
 - Use ctrl+up/down or cmd+up/down to reorder the focused row. Hold shift to move 10 rows at a time.
 - The first rule that matches is the one that applies, so order matters.
 - Label is the label that will apply qhen the rule matches. This is *not* the full label name. The full label name gets prefixed as maketime/.../labelname. Put just the last bit here.
 - Rule is the rule to match.
 - Match All Messages will required the rule to match all the messages in the thread to be considered a match. Otherwise, any message in the thread matching will mean the whole thread matches.
 - No List-ID matches messages that are not sent to an email list.
 - Gmail filters match only the newly incoming message. make-time matches all messages in the thread each time the thread is processed.
 - Every thread in the unprocessed queue gets exactly one needstriage label applied. If none of your filters apply to a thread, then make-time will apply a "needsfilter" label. This lets you ensure all mail gets appropriate filters, e.g. when you sign up for a new mailing list, they'll go here until you add a filter rule for the list.

<b>Rule directives</b>
 - <b>to:</b> Matches the to/cc/bcc fields of the email. "foo" will match foo+anything@anything.com, "foo@gmail.com" will match foo@gmail.com and foo+anything@gmail.com, "gmail.com" will match anything@gmail.com.
 - <b>from:</b> Matches the from field of the email. Same matching rules as the "to" directive.
 - <b>subject:</b> Matches if the subject of the email includes this text.
 - <b>plaintext:</b> Matches if the plain text of the email includes this text.
 - <b>htmlcontent:</b> Matches if the HTML of the email includes this text.
 - <b>header:</b> Matches arbitrary email headers. You can see the email headers by going to gmail and clicking "Show original" for a given a message. The format is "header:value" where "header" is the name of the mail header and "value" is the value to search for in that mail header. For example, "X-Autoreply:yes" is a filter gmail (and probably other) vacation autoresponders as they put an X-Autoreply header on autoresponse messages.

If there's a bug in the filtering code, emails should remain in the unprocessed label.
`;

window.customElements.define('mt-filters', FiltersView);
