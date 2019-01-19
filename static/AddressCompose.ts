import parseAddressList from '../deps/emailjs-addressparser/addressparser.js';

import {AutoComplete, EntrySelectedEvent} from './AutoComplete.js';
import {assert, defined, ParsedAddress, serializeAddress} from './Base.js';
import {Contacts} from './Contacts.js';

// TODO: Handle mouse drag selections + copy + paste + delete + backspace +
// arrows.

export class AddressCompose extends HTMLElement {
  private preventAutoComplete_: boolean;
  private autoComplete_: AutoComplete;
  private input_: HTMLInputElement;
  private addressContainer_: HTMLElement;

  constructor(contacts: Contacts, disabled?: boolean) {
    super();

    this.style.cssText = `
      line-height: 1em;
      border: 1px solid;
      padding: 1px;
      word-break: break-word;

      /* Match gmail default style of tiny text in compose to avoid different sizes on copy-paste. */
      font-family: Arial, Helvetica, sans-serif;
      font-size: small;
    `;

    this.preventAutoComplete_ = false;
    this.autoComplete_ = new AutoComplete(contacts);

    this.addressContainer_ = document.createElement('div');
    this.addressContainer_.style.cssText = `
      display: flex;
      flex-wrap: wrap;
    `;
    this.append(this.addressContainer_);

    this.input_ = document.createElement('input');
    this.addressContainer_.append(this.input_);

    if (disabled) {
      this.style.border = '0';
      this.style.color = 'grey';
      this.input_.style.display = 'none';
      return;
    }

    this.style.backgroundColor = 'white';

    this.cancelAutoComplete_();
    this.autoComplete_.addEventListener(
        EntrySelectedEvent.NAME,
        (e) => this.submitAutoComplete_((<EntrySelectedEvent>e).entry));
    this.append(this.autoComplete_);

    this.input_.style.cssText = `
      border: 0;
      outline: 0;
      margin: 2px;
      width: 100%;
    `;
    this.input_.setAttribute('inputmode', 'email');
    this.input_.addEventListener(
        'input', (e) => this.handleInput_(<InputEvent>e));
    this.input_.addEventListener('keydown', (e) => this.handleyKeyDown_(e));
  }

  get value() {
    let values = [];
    for (let child of this.addressContainer_.children) {
      if (child === this.input_)
        values.push(this.input_.value);
      else
        values.push(child.textContent);
    }
    return values.join(',');
  }

  set value(value: string) {
    for (let chip of this.addressContainer_.querySelectorAll('.chip')) {
      chip.remove();
    }

    let addresses = parseAddressList(value);
    for (let address of addresses) {
      this.input_.before(this.createChip_(address));
    }
  }

  getSelectedAddress_() {
    let selected: ParsedAddress = this.autoComplete_.selected();
    if (!selected && this.input_.value) {
      let addresses = parseAddressList(this.input_.value);
      assert(addresses.length === 1);
      selected = addresses[0];
    }
    return selected;
  }

  submitAutoComplete_(selectedItem?: ParsedAddress) {
    this.preventAutoComplete_ = false;

    selectedItem = selectedItem || this.getSelectedAddress_();
    // This happens when you arrow to edit a chip and there's no text in
    // this.input_.
    if (!selectedItem)
      return;

    let chip = this.createChip_(selectedItem);
    this.input_.before(chip);
    this.setInputValue_('');

    this.dispatchEvent(new Event('input'));

    this.cancelAutoComplete_();
  }

  createChip_(address: ParsedAddress) {
    let outer = document.createElement('span');
    outer.className = 'chip';
    outer.style.cssText = `
      font-size: .75rem;
      border: 1px solid #dadce0;
      border-radius: 10px;
      box-sizing: border-box;
      display: inline-block;
      height: 20px;
      margin: 2px;
      background-color: white;
    `;
    outer.addEventListener('click', () => this.selectChip_(outer));
    outer.addEventListener(
        'mouseenter', () => outer.style.backgroundColor = 'lightgrey');
    outer.addEventListener(
        'mouseleave', () => outer.style.backgroundColor = 'white');

    let inner = document.createElement('span');
    inner.style.cssText = `
      height: 20px;
      max-width: 325px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin: 2px 6px;
      display: inline-block;
    `;

    inner.append(serializeAddress(address));
    outer.append(inner);
    return outer;
  }

  cancelAutoComplete_() {
    this.autoComplete_.style.display = 'none';
    this.autoComplete_.clear();
  }

  setInputValue_(value: string) {
    this.input_.value = value;
    this.updateAutoComplete_();
  }

  updateAutoComplete_() {
    if (this.preventAutoComplete_)
      return;

    let addresses = parseAddressList(this.input_.value);
    if (!addresses.length) {
      this.cancelAutoComplete_();
      return;
    }

    this.autoComplete_.style.display = '';

    assert(addresses.length === 1);
    let address = addresses[0];
    this.autoComplete_.render(address.address || address.name);

    let rect = this.input_.getBoundingClientRect();
    this.autoComplete_.style.left = `${rect.left}px`;
    this.autoComplete_.style.top = `${rect.bottom + 4}px`;
  }

  handleInput_(e: InputEvent) {
    if (e.data === ',') {
      this.submitAutoComplete_();
      return;
    }

    let addresses = parseAddressList(this.input_.value);
    if (!addresses.length) {
      this.cancelAutoComplete_();
      return;
    }

    let lastAddress = defined(addresses.pop());
    if (addresses.length) {
      this.setInputValue_(serializeAddress(lastAddress));
      for (let address of addresses) {
        this.input_.before(this.createChip_(address));
      }
    } else {
      this.updateAutoComplete_();
    }
  }

  isCursorAtEnd_() {
    let end = this.input_.value.length;
    return this.input_.selectionStart === end &&
        this.input_.selectionEnd === end;
  }

  isCursorAtStart_() {
    return this.input_.selectionStart === 0 && this.input_.selectionEnd === 0;
  }

  removeChip_(chip: HTMLElement) {
    chip.remove();
    this.dispatchEvent(new Event('input'));
  }

  selectChip_(chip: HTMLElement) {
    this.submitAutoComplete_();
    chip.before(this.input_);
    this.removeChip_(chip);
    this.setInputValue_(chip.textContent);
    this.input_.focus();

    this.input_.selectionStart = 0;
    this.input_.selectionEnd = this.input_.value.length;
  }

  handleyKeyDown_(e: KeyboardEvent) {
    switch (e.key) {
      case 'Delete':
        if (this.isCursorAtEnd_()) {
          let chip = this.input_.nextSibling as HTMLElement;
          if (chip)
            this.removeChip_(chip);
        }
        return;

      case 'Backspace':
        if (this.isCursorAtStart_()) {
          let chip = this.input_.previousSibling as HTMLElement;
          if (chip)
            this.removeChip_(chip);
        }
        return;

      case 'Escape':
        this.preventAutoComplete_ = true;
        this.cancelAutoComplete_();
        return;

      case 'Enter':
        this.submitAutoComplete_();
        return;

      case 'ArrowUp':
        this.autoComplete_.adjustIndex(-1);
        return;

      case 'ArrowDown':
        this.autoComplete_.adjustIndex(1);
        return;

      case 'ArrowLeft':
        if (this.isCursorAtStart_()) {
          let chip = this.input_.previousSibling as HTMLElement;
          if (chip) {
            this.selectChip_(chip);
            e.preventDefault();
          } else {
            this.submitAutoComplete_();
          }
        }
        return;

      case 'ArrowRight':
        if (this.isCursorAtEnd_()) {
          let chip = this.input_.nextSibling as HTMLElement;
          if (chip) {
            this.selectChip_(chip);
          } else {
            this.submitAutoComplete_();
          }
          e.preventDefault();
        }
        return;
    }
  }
}

window.customElements.define('mt-address-compose', AddressCompose);
