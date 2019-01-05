import {parseAddress, ParsedAddress, serializeAddress} from './Base.js';
import {AutoCompleteEntry, Compose} from './Compose.js';

const SEPARATOR = ',';
const CURSOR_SENTINEL = '!!!!!!!!';

interface SelectableParsedAddress extends ParsedAddress {
  selected?: boolean
}

export const autocompleteItemSelectedEventName = 'autocomplete-item-selected';

// TODO: This code and the Filters rich text code have too much code
// duplication. Find a way to factor that out. Probably need a mixin?
export class AddressCompose extends Compose {
  private autocompleteStartRange_: Range|undefined;
  private autocompleteCursorRange_: Range|undefined;

  constructor(contacts: any) {
    super(contacts, true);
    this.content.style.padding = '4px';
    this.content.setAttribute('inputmode', 'email');
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

  setTextAndSelectSentinel_(selectedItem?: AutoCompleteEntry) {
    let addresses = this.parse_(true);

    this.content.textContent = '';
    let separator = SEPARATOR + ' ';

    for (let i = 0; i < addresses.length; i++) {
      let address = addresses[i];

      let serialized;
      if (selectedItem && address.selected) {
        serialized =
            serializeAddress(selectedItem) + separator + CURSOR_SENTINEL;
      } else {
        serialized = serializeAddress(address);
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

    let out: SelectableParsedAddress[] = [];
    for (let part of parts) {
      out.push(this.parseAddress_(part, keepSentinelText));
    }
    return out;
  }

  // Parse "user@foo.com" and "User Name <user@foo.com>".
  parseAddress_(address: string, keepSentinelText?: boolean) {
    let selected = address.includes(CURSOR_SENTINEL);
    if (!keepSentinelText && selected)
      address = address.replace(CURSOR_SENTINEL, '');

    let out: SelectableParsedAddress = parseAddress(address);
    out.selected = selected;
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
    return new Text(serializeAddress(selectedItem));
  }

  insertAddress(selectedItem: AutoCompleteEntry) {
    this.setTextAndSelectSentinel_(selectedItem);
    this.dispatchEvent(new Event(autocompleteItemSelectedEventName));
  }
}

window.customElements.define('mt-address-compose', AddressCompose);
