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
  protected content: HTMLElement;
  private placeholder_: string|undefined;
  static EMAIL_CLASS_NAME: string;

  constructor(isSingleline?: boolean, private putMenuAbove_?: boolean) {
    super();

    this.style.display = 'flex';

    this.autocompleteRange_ = null;

    this.autoComplete_ = new AutoComplete();
    this.autoComplete_.addEventListener(
        EntrySelectedEvent.NAME,
        (e) => this.submitAutocomplete_((<EntrySelectedEvent>e).entry));
    this.append(this.autoComplete_);
    this.hideAutocompleteMenu_();

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
    this.content.contentEditable = isSingleline ? 'plaintext-only' : 'true';
    this.content.addEventListener('blur', this.cancelAutocomplete_.bind(this));
    this.append(this.content);

    this.addEventListener('keydown', async (e) => {
      switch (e.key) {
        case 'Escape':
          if (this.updateIsAutocompleting())
            this.cancelAutocomplete_();
          else
            this.dispatchEvent(new Event('cancel'));
          return;

        case 'Enter':
          if (e.altKey || e.metaKey || e.shiftKey)
            return;

          if (this.updateIsAutocompleting()) {
            this.submitAutocomplete_();
            e.preventDefault();
          } else if (isSingleline) {
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
    });

    this.addEventListener('input', async (e: Event) => {
      this.handleInput(<InputEvent>e);
      this.updatePlaceholder_();
    });
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
    // contacts as we always add a single fallback. If that candidate includes a
    // space, then we know the user isn't typing an email address and we should
    // cancel the autocomplete entirely.
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

    // If the next character is the separator, don't include it, but still move
    // the cursor after it.
    let separator = document.createTextNode(SEPARATOR);
    range.collapse();
    range.insertNode(separator);
    window.getSelection().collapse(separator, separator.length);
  }
}

window.customElements.define('mt-email-compose', EmailCompose);
