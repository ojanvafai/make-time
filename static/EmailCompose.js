import { Compose } from './Compose.js';

export class EmailCompose extends Compose {
  constructor(contacts, opt_isMultiline) {
    super(contacts, opt_isMultiline);
    this.separator_ = ' ';
  }

  isStillAutoCompleting() {
    return this.autocompleteRange_ && this.autocompleteRange_.toString() == '+';
  }

  prepareAutocomplete(inputEvent) {
    if (inputEvent.data != '+')
      return;

    // TODO: Only start auto complete at start of line or after a whitespace
    let cursor = this.cursor_();
    let container = cursor.startContainer;
    let offset = cursor.startOffset;
    let nextChar = container.textContent.substring(offset, offset + 1);
    if (!nextChar || nextChar == ' ') {
      this.autocompleteRange_ = cursor;
      this.autocompleteRange_.setStart(container, offset - 1);
    }
  }

  selectedEntry(selectedItem) {
    let link = document.createElement('a');
    link.href = `mailto:${selectedItem.email}`;
    link.textContent = `+${selectedItem.name || selectedItem.email}`;
    link.tabIndex = -1;
    link.contentEditable = 'false';
    return link;
  }
}

window.customElements.define('mt-email-compose', EmailCompose);
