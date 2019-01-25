import {AutoComplete, AutoCompleteEntry, EntrySelectedEvent} from './AutoComplete.js';
import {notNull} from './Base.js';

const SEPARATOR = ' ';
const EMAIL_CLASS_NAME = 'mk-email';

export class SubmitEvent extends Event {
  constructor(public ctrlKey: boolean) {
    super('submit');
  }
}

export class EmailCompose extends HTMLElement {
  private autocompleteRange_: Range|null;
  private autoComplete_: AutoComplete;
  private bubble_: HTMLElement|null;
  protected content: HTMLElement;
  private placeholder_: string|undefined;
  private boundSelectionChange_: () => void;
  static EMAIL_CLASS_NAME: string;

  constructor(
      private isSingleline_?: boolean, private putMenuAbove_?: boolean) {
    super();

    this.style.display = 'flex';

    this.autocompleteRange_ = null;

    this.autoComplete_ = new AutoComplete();
    this.autoComplete_.addEventListener(
        EntrySelectedEvent.NAME,
        (e) => this.submitAutocomplete_((<EntrySelectedEvent>e).entry));
    this.append(this.autoComplete_);
    this.hideAutocompleteMenu_();

    this.bubble_ = null;

    this.content = document.createElement('div');
    this.content.style.cssText = `
      flex: 1;
      overflow: auto;
      border: 1px solid;
      padding: 8px;
      outline: none;
      background-color: white;
      word-break: break-word;

      /* Match gmail default style of tiny text in compose to avoid different sizes on copy-paste. */
      font-family: Arial, Helvetica, sans-serif;
      font-size: small;
    `;
    this.content.contentEditable = 'true';
    this.content.addEventListener('blur', this.cancelAutocomplete_.bind(this));
    this.append(this.content);

    this.addEventListener('keydown', (e) => this.handleKeyDown_(e));
    this.addEventListener('input', async (e: Event) => {
      this.handleInput(<InputEvent>e);
      this.updatePlaceholder_();
    });

    this.boundSelectionChange_ = this.handleSelectionChange_.bind(this);
  }

  connectedCallback() {
    document.addEventListener('selectionchange', this.boundSelectionChange_);
  }

  disconnectedCallback() {
    document.removeEventListener('selectionchange', this.boundSelectionChange_);
  }

  bubbleIsFocused_() {
    if (!this.bubble_)
      return false;
    let node = document.activeElement;
    while (node) {
      if (node === this.bubble_)
        return true;
      node = node.parentElement;
    }
    return false;
  }

  isInsideContent_(node: Node) {
    let parent = node.parentNode;
    while (parent) {
      if (parent === this.content)
        return true;
      parent = parent.parentNode;
    }
    return false;
  }

  handleSelectionChange_() {
    if (this.bubbleIsFocused_())
      return;

    if (this.bubble_)
      this.bubble_.remove();

    let selection = window.getSelection();
    if (selection.rangeCount === 0)
      return;
    let range = selection.getRangeAt(0);
    let link = this.getContainingLink_(range.commonAncestorContainer);
    if (!link || !this.isInsideContent_(link))
      return;

    this.showLinkBubble_(link);
  }

  showLinkBubble_(link: HTMLAnchorElement) {
    let rect = link.getBoundingClientRect();

    this.bubble_ = document.createElement('div');
    this.bubble_.style.cssText = `
      position: fixed;
      top: ${rect.bottom}px;
      left: ${rect.left}px;
      white-space: nowrap;
      border: 1px solid;
      background-color: #eee;
      box-shadow: 2px 2px 10px 1px lightgrey;
      padding: 2px;
    `;
    let input = document.createElement('input');
    input.value = link.href;
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        notNull(this.bubble_).remove();
        let selection = window.getSelection();
        selection.selectAllChildren(link);
        selection.collapseToEnd();
        e.preventDefault();
        e.stopPropagation();
      }
    });
    input.addEventListener('change', () => {
      notNull(link).href = input.value;
      this.dispatchEvent(new Event('input'));
    });

    let deleteButton = document.createElement('span');
    deleteButton.textContent = '[remove]';
    deleteButton.addEventListener('click', () => {
      link = notNull(link);
      link.before(link.textContent);
      link.remove();
      this.dispatchEvent(new Event('input'));
    });

    this.bubble_.append('URL ', input, ' ', deleteButton);
    this.append(this.bubble_);
  }

  async handleKeyDown_(e: KeyboardEvent) {
    switch (e.key) {
      case 'k':
        // TODO: Just do metaKey on mac and ctrlKey elsewhere.
        if (e.ctrlKey || e.metaKey) {
          this.insertLink_();
          e.preventDefault();
        }
        return;

      case 'Escape':
        if (this.updateIsAutocompleting()) {
          this.cancelAutocomplete_();
        } else {
          this.dispatchEvent(new Event('cancel'));
          // Prevent the escape in quick reply both closing quick reply and
          // taking you back to the threadlist.
          // TODO: Technically we should only do this if stopPropagation is
          // called on the dispatched cancel event. We could make that work with
          // a class that wraps the KeyboardEvent and delgates the
          // stopPropagation call if needed.
          e.stopPropagation();
        }
        return;

      case 'Enter':
        if (e.altKey || e.metaKey || e.shiftKey)
          return;

        if (this.updateIsAutocompleting()) {
          this.submitAutocomplete_();
          e.preventDefault();
        } else if (this.isSingleline_) {
          this.dispatchEvent(new SubmitEvent(e.ctrlKey));
          e.preventDefault();
        }
        return;

      case 'ArrowUp':
        if (this.updateIsAutocompleting()) {
          e.preventDefault();
          this.autoComplete_.adjustIndex(-1);
        }
        return;

      case 'ArrowDown':
        if (this.updateIsAutocompleting()) {
          e.preventDefault();
          this.autoComplete_.adjustIndex(1);
        }
        return;

      case 'ArrowLeft':
      case 'ArrowRight':
        this.cancelAutocomplete_();
        return;
    }
  }

  getContainingLink_(node: Node) {
    let parent = node.parentNode;
    while (parent) {
      if (parent.nodeName === 'A')
        return parent as HTMLAnchorElement;
      parent = parent.parentNode;
    }
    return null;
  }

  insertLink_() {
    let selection = window.getSelection();
    if (selection.rangeCount === 0)
      return;

    let range = selection.getRangeAt(0);
    if (this.getContainingLink_(range.commonAncestorContainer)) {
      alert('Selection is already in a link.');
      return;
    }

    if (selection.isCollapsed) {
      alert('Not supported. Select some text to insert a link.');
    } else {
      let contents = range.extractContents();
      let link = document.createElement('a');
      link.append(contents);
      range.insertNode(link);
      this.showLinkBubble_(link);
      notNull(notNull(this.bubble_).querySelector('input')).focus();
    }
  }

  updatePlaceholder_() {
    let content = this.content;
    if (content.textContent.length) {
      content.removeAttribute('placeholder');
      content.style.color = '';
    } else {
      content.setAttribute('placeholder', this.placeholder_ || '');
      content.style.color = 'grey';
    }
  }

  protected updateIsAutocompleting() {
    let isAutoCompleting = this.isStillAutoCompleting();
    if (!isAutoCompleting)
      this.cancelAutocomplete_();
    return isAutoCompleting;
  }

  protected cursor() {
    return window.getSelection().getRangeAt(0).cloneRange();
  }

  protected renderAutocomplete() {
    this.autoComplete_.style.display = '';
    let candidates = this.autoComplete_.render(this.autocompleteText());

    // If there's only one candidate, that means there were no matches in
    // contacts as we always add a single fallback. If that candidate includes
    // a space, then we know the user isn't typing an email address and we
    // should cancel the autocomplete entirely.
    if (candidates.length == 1 &&
        (candidates[0].address.includes(' ') ||
         candidates[0].name.includes(' '))) {
      this.cancelAutocomplete_();
      return;
    }

    let range = notNull(this.getAutocompleteRange());
    let rect = range.getBoundingClientRect();
    this.autoComplete_.style.left = `${rect.left}px`;
    if (this.putMenuAbove_) {
      this.autoComplete_.style.bottom =
          `${document.documentElement.offsetHeight - rect.top}px`;
    } else {
      this.autoComplete_.style.top = `${rect.bottom + 4}px`;
    }
  }

  hideAutocompleteMenu_() {
    this.autoComplete_.style.display = 'none';
  }

  cancelAutocomplete_() {
    this.clearAutocompleteRange();
    this.hideAutocompleteMenu_();
  }

  submitAutocomplete_(selectedItem?: AutoCompleteEntry) {
    if (!selectedItem)
      selectedItem = this.autoComplete_.selected();
    this.insertAddress(selectedItem);

    this.cancelAutocomplete_();
    this.dispatchEvent(new Event('email-added'));
  }

  // TODO: Return and pass around ParsedAddresses instead of strings.
  getEmails() {
    let links = <NodeListOf<HTMLLinkElement>>this.content.querySelectorAll(
        `a.${EMAIL_CLASS_NAME}`);
    let results: string[] = [];
    for (let link of links) {
      let name = link.textContent;
      // Remove the leading +.
      name = name.substring(1, name.length);
      let email = link.href.replace('mailto:', '');
      // TODO: This needs to use serializeAddress so it correclty quotes the
      // name if it has a comma.
      results.push(name.includes('@') ? email : `${name} <${email}>`);
    }
    return results;
  }

  get plainText() {
    return this.content.textContent;
  }

  get rawValue() {
    return this.content.innerHTML;
  }

  get value() {
    let cloned = <HTMLElement>this.content.cloneNode(true);
    let emails = cloned.querySelectorAll(`a.${EMAIL_CLASS_NAME}`);
    for (let email of emails) {
      email.removeAttribute('class');
      email.removeAttribute('contentEditable');
      email.removeAttribute('tabIndex');
    }
    // Compose is white-space:pre-wrap and shift+enter inserts \n's. Convert
    // them to BRs so they render when shown in white-space:normal contexts.
    return cloned.innerHTML.replace('\n', '<br>');
  }

  set value(value) {
    this.content.innerHTML = value;
    this.updatePlaceholder_();
    if (this.bubble_)
      this.bubble_.remove();
  }

  get placeholder() {
    return this.placeholder_;
  }

  set placeholder(text) {
    this.placeholder_ = text;
    this.updatePlaceholder_();
  }

  focus() {
    return this.content.focus();
  }

  getAutocompleteRange() {
    return this.autocompleteRange_;
  }

  clearAutocompleteRange() {
    this.autocompleteRange_ = null;
  }

  handleInput(e: InputEvent) {
    if (this.updateIsAutocompleting()) {
      this.renderAutocomplete();
    } else {
      this.prepareAutocomplete(e);
    }
  }

  isStillAutoCompleting() {
    return this.autocompleteRange_ && this.autocompleteRange_.toString() == '+';
  }

  prepareAutocomplete(inputEvent: InputEvent) {
    if (inputEvent.data != '+')
      return;

    // TODO: Only start auto complete at start of line or after a whitespace
    let cursor = this.cursor();
    let container = <CharacterData|Element>cursor.startContainer;
    let offset = cursor.startOffset;
    let nextChar = container.textContent.substring(offset, offset + 1);
    if (!nextChar || nextChar == ' ') {
      this.autocompleteRange_ = cursor;
      this.autocompleteRange_.setStart(container, offset - 1);
    }
  }

  autocompleteText() {
    let cursor = this.cursor();
    let range = <Range>this.autocompleteRange_;
    cursor.setStart(range.endContainer, range.endOffset);
    return cursor.toString();
  }

  selectedEntry(selectedItem: AutoCompleteEntry) {
    let link = document.createElement('a');
    link.className = EMAIL_CLASS_NAME;
    link.href = `mailto:${selectedItem.address}`;
    link.textContent = `+${selectedItem.name || selectedItem.address}`;
    link.tabIndex = -1;
    link.contentEditable = 'false';
    return link;
  }

  insertAddress(selectedItem: AutoCompleteEntry) {
    let autocompleteRange = notNull(this.autocompleteRange_);
    let range = this.cursor();
    range.setStart(
        autocompleteRange.startContainer, autocompleteRange.startOffset);

    range.deleteContents();

    let selectedEntry = this.selectedEntry(selectedItem);
    range.insertNode(selectedEntry);

    // If the next character is the separator, don't include it, but still
    // move the cursor after it.
    let separator = document.createTextNode(SEPARATOR);
    range.collapse();
    range.insertNode(separator);
    window.getSelection().collapse(separator, separator.length);
  }
}

window.customElements.define('mt-email-compose', EmailCompose);
