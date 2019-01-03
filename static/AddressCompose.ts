import {AutoCompleteEntry, Compose} from './Compose.js';

const SEPARATOR = ',';
const CURSOR_SENTINEL = '!!!!!!!!';

interface ParsedAddress {
  name?: string, email: string, selected?: boolean
}

// TODO: This code and the Filters rich text code have too much code
// duplication. Find a way to factor that out. Probably need a mixin?
export class AddressCompose extends Compose {
  private autocompleteStartRange_: Range|undefined;
  private autocompleteCursorRange_: Range|undefined;

  constructor(contacts: any, opt_isMultiline?: boolean) {
    super(contacts, opt_isMultiline);
    this.content.style.padding = '4px';
    // Need to always have some text in the field for the flexbox
    // baseline computation to work right. #sigh.
    this.placeholder = '\xa0';
  }

  getAutocompleteRange() {
    if (!this.autocompleteStartRange_)
      throw 'This should never happen.';
    return this.autocompleteStartRange_;
  }

  clearAutocompleteRange() {
    this.autocompleteStartRange_ = undefined;
    this.autocompleteCursorRange_ = undefined;
  }

  isStillAutoCompleting() {
    return !!this.autocompleteStartRange_;
  }

  handleInput(_e: InputEvent) {
    this.setTextAndSelectSentinel_();
    this.renderAutocomplete();
  }

  insertSentinelText_() {
    let range = window.getSelection().getRangeAt(0);
    let node = new Text(CURSOR_SENTINEL);
    range.insertNode(node);
    return node;
  }

  setAutocompleteStartRange_(text: Text) {
    this.autocompleteStartRange_ = this.createRangeAtStart_(text);
  }

  setAutocompleteCursorRange_(text: Text) {
    this.autocompleteCursorRange_ = this.createRangeAtStart_(text);
  }

  createRangeAtStart_(text: Text) {
    let range = new Range();
    range.selectNodeContents(text);
    range.collapse(true);
    return range;
  }

  appendHandlingSentinel_(container: HTMLElement, text: string) {
    let index = text.indexOf(CURSOR_SENTINEL);
    if (index == -1) {
      container.append(text);
      return;
    }

    this.autocompleteStartRange_ = new Range();
    this.autocompleteStartRange_.selectNodeContents(container);
    this.autocompleteStartRange_.collapse(false);

    let startNode = new Text(text.substring(0, index));
    this.setAutocompleteStartRange_(startNode);
    container.append(startNode);

    let endNode = new Text(text.substring(index + CURSOR_SENTINEL.length));
    this.setAutocompleteCursorRange_(endNode);
    container.append(endNode);
  }

  serializeAddress_(address: ParsedAddress|AutoCompleteEntry) {
    if (address.name)
      return `${address.name} <${address.email}>`;
    return address.email;
  }

  setTextAndSelectSentinel_(selectedItem?: AutoCompleteEntry) {
    let addresses = this.parse_(true);

    this.content.textContent = '';
    let separator = SEPARATOR + ' ';

    for (let i = 0; i < addresses.length; i++) {
      let address = addresses[i];

      let serialized;
      if (selectedItem && address.selected) {
        serialized =
            this.serializeAddress_(selectedItem) + separator + CURSOR_SENTINEL;
      } else {
        serialized = this.serializeAddress_(address);
        if (i != (addresses.length - 1))
          serialized += separator;
      }

      this.appendHandlingSentinel_(this.content, serialized);
    }

    if (!this.autocompleteCursorRange_)
      throw 'Something went wrong. This should never happen.';
    let selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(this.autocompleteCursorRange_.cloneRange());
  }

  parse_(keepSentinelText?: boolean) {
    let sentinel = this.insertSentinelText_();
    let parts = this.content.textContent.split(SEPARATOR);
    sentinel.remove();

    let out: ParsedAddress[] = [];
    for (let part of parts) {
      out.push(this.parseAddress_(part, keepSentinelText));
    }
    return out;
  }

  // Parse "user@foo.com" and "User Name <user@foo.com>".
  parseAddress_(address: string, keepSentinelText?: boolean) {
    let trimmed = address.trim();

    let selected = trimmed.includes(CURSOR_SENTINEL);
    if (!keepSentinelText && selected)
      trimmed = trimmed.replace(CURSOR_SENTINEL, '');

    let out: ParsedAddress = {
      selected: selected,
      email: trimmed,
    }

    let split = trimmed.split('<');
    if (split.length == 1)
      return out;

    let email = split.pop();
    if (email === undefined)
      throw 'This should never happen';
    // Strip the trailing '>'.
    if (email.charAt(email.length - 1) == '>')
      email = email.substring(0, email.length - 1);
    out.email = email.trim();

    // Can there be multiple '<' in an email address, e.g. can there be a '<' in
    // the name?
    out.name = split.join('<').trim();
    return out;
  }

  autocompleteText() {
    let parsed = this.parse_();
    let selected = parsed.find(x => !!x.selected);
    if (!selected)
      throw 'This should never happen.';
    return selected.email;
  }

  selectedEntry(selectedItem: AutoCompleteEntry) {
    return new Text(this.serializeAddress_(selectedItem));
  }

  insertAddress(selectedItem: AutoCompleteEntry) {
    this.setTextAndSelectSentinel_(selectedItem);
  }
}

window.customElements.define('mt-address-compose', AddressCompose);
