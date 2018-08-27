class FiltersView extends HTMLElement {
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
      this.moveRow_(e.key);
      break;

    case 'ArrowDown':
      this.moveRow_(e.key);
      break;
    }
  }

  moveRow_(direction) {
    let focused = document.activeElement;

    let row = focused.parentNode;
    while (row && row.tagName != 'TR') {
      row = row.parentNode;
    }
    if (!row)
      return;

    let parent = row.parentNode;
    while (parent && parent != this) {
      parent = parent.parentNode;
    }
    if (!parent)
      return;

    if (direction == 'ArrowUp') {
      if (row.previousSibling) {
        row.previousSibling.before(row);
        focused.focus();
      }
    } else if (direction == 'ArrowDown') {
      if (row.nextSibling) {
        row.nextSibling.after(row);
        focused.focus();
      }
    } else {
      throw `Tried to move row in invalid direction: ${direction}`;
    }
  }

  async render_() {
    let filters = await this.settings_.getFilters();
    let rules = filters.rules;
    let labels = filters.labels;

    let container = document.createElement('table');
    container.style.cssText = `font-size: 11px;`;

    let header = document.createElement('thead');
    header.innerHTML = `<th></th><th>Label</th><th style="width:100%">Rule</th><th>Match All Messages</th>`;
    container.append(header);

    let body = document.createElement('tbody');
    for (let rule of rules) {
      body.append(this.createRule_(rule));
    }
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
      rule.label = row.querySelector('.label').value;
      if (row.querySelector('.matchallmessages').checked)
        rule.matchallmessages = 'yes';
      rules.push(rule);
    }
    await this.settings_.writeFilters(rules);
  }

  cancel_() {
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

    let buttons = document.createElement('div');
    buttons.style.display = 'flex';
    this.appendCell_(container, buttons);

    let addButton = document.createElement('span');
    addButton.append('+');
    addButton.classList.add('row-button');
    addButton.onclick = () => {
      let emptyRule = this.createRule_({});
      container.after(emptyRule);
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
      if (field == 'label' || field == 'matchallmessages')
        continue;
      queryParts[field] = rule[field];
    }

    let editor = this.createQueryEditor_(queryParts);
    editor.classList.add('query');
    this.appendCell_(container, editor);

    let matchAllMessages = document.createElement('input');
    matchAllMessages.classList.add('matchallmessages');
    matchAllMessages.type = 'checkbox';
    if (rule.matchallmessages == 'yes')
      matchAllMessages.checked = true;
    let cell = this.appendCell_(container, matchAllMessages);
    cell.style.textAlign = 'center';

    return container;
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

      if (!Settings.FILTERS_RULE_DIRECTIVES.includes(fieldText.trim()))
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

    editor.undoStack_ = [];

    editor.addEventListener('beforeinput', (e) => {
      if (e.inputType == 'historyUndo' || e.inputType == 'historyRedo')
        return;

      editor.redoStack_ = [];
      editor.undoStack_.push(this.getEditorTextContentWithSentinel_(editor));
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

        let popStack = e.shiftKey ? editor.redoStack_ : editor.undoStack_;
        let pushStack = e.shiftKey ? editor.undoStack_ : editor.redoStack_;

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
 - Directives separated by "&&" must all apply in order for the rule to match. There is currently no "OR" value and no "NOT" value (patches welcome!).
 - Use ctrl+up/down or cmd+up/down to reorder the focused row.
 - The first rule that matches is the one that applies, so order matters.
 - Label is the label that will apply qhen the rule matches.
 - Rule is the rule to match.
 - Match All Messages will required the rule to match all the messages in the thread to be considered a match. Otherwise, any message in the thread matching will mean the whole thread matches.

<b>Rule directives</b>
 - <b>to:</b> Matches the to/cc/bcc fields of the email. "foo" will match foo+anything@anything.com, "foo@gmail.com" will match foo@gmail.com and foo+anything@gmail.com, "gmail.com" will match anything@gmail.com.
 - <b>from:</b> Matches the from field of the email. Same matching rules as the "to" directive.
 - <b>subject:</b> Matches if the subject of the email includes this text.
 - <b>plaintext:</b> Matches if the plain text of the email includes this text.
 - <b>htmlcontent:</b> Matches if the HTML of the email includes this text.
 - <b>header:</b> Matches arbitrary email headers. You can see the email headers by going to gmail and clicking "Show original" for a given a message. The format is "header:value" where "header" is the name of the mail header and "value" is the value to search for in that mail header. For example, "X-Autoreply:yes" is a filter gmail (and probably other) vacation autoresponders as they put an X-Autoreply header on autoresponse messages.
`;

window.customElements.define('mt-filters', FiltersView);
