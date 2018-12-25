import {AutoCompleteEntry, Compose} from './Compose.js';

export class EmailCompose extends Compose {
  constructor(contacts: any, opt_isMultiline?: boolean) {
    super(contacts, opt_isMultiline);
    this.separator = ' ';
  }

  isStillAutoCompleting() {
    return this.autocompleteRange && this.autocompleteRange.toString() == '+';
  }

  prepareAutocomplete(inputEvent: InputEvent) {
    if (inputEvent.data != '+')
      return;

    // TODO: Only start auto complete at start of line or after a whitespace
    let cursor = this.cursor_();
    let container = <CharacterData|Element>cursor.startContainer;
    let offset = cursor.startOffset;
    let nextChar = container.textContent.substring(offset, offset + 1);
    if (!nextChar || nextChar == ' ') {
      this.autocompleteRange = cursor;
      this.autocompleteRange.setStart(container, offset - 1);
    }
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
}

window.customElements.define('mt-email-compose', EmailCompose);
