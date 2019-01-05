import {AutoCompleteEntry, Compose} from './Compose.js';

const SEPARATOR = ' ';

export class EmailCompose extends Compose {
  private autocompleteRange_: Range|null;

  constructor(contacts: any, isSingleline?: boolean, putMenuAbove?: boolean) {
    super(contacts, false, isSingleline, putMenuAbove);
    this.autocompleteRange_ = null;
    this.content.style.padding = '8px';
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
    link.className = Compose.EMAIL_CLASS_NAME;
    link.href = `mailto:${selectedItem.email}`;
    link.textContent = `+${selectedItem.name || selectedItem.email}`;
    link.tabIndex = -1;
    link.contentEditable = 'false';
    return link;
  }

  insertAddress(selectedItem: AutoCompleteEntry) {
    if (!this.autocompleteRange_)
      throw 'This should never happen';

    let range = this.cursor();
    range.setStart(
        this.autocompleteRange_.startContainer,
        this.autocompleteRange_.startOffset);

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
