import {notNull} from './Base.js';
import { Compose} from './Compose.js';
import {Contacts} from './Contacts.js';
import { AutoCompleteEntry } from './AutoComplete.js';

const SEPARATOR = ' ';

// TODO: Merge this with Compose now that it's the only subclass.
export class EmailCompose extends Compose {
  private autocompleteRange_: Range|null;

  constructor(
      contacts: Contacts, isSingleline?: boolean, putMenuAbove?: boolean) {
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
