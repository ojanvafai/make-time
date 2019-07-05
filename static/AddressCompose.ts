
import {AutoComplete, EntrySelectedEvent} from './AutoComplete.js';
import {assert, defined, parseAddressList, ParsedAddress, serializeAddress} from './Base.js';

export class AddressCompose extends HTMLElement {
  private preventAutoComplete_: boolean;
  private autoComplete_: AutoComplete;
  private input_: HTMLInputElement;
  private addressContainer_: HTMLElement;

  constructor(private disabled_?: boolean) {
    super();

    this.style.cssText = `
      line-height: 1em;
      padding: 1px;
      word-break: break-word;

      /* Match gmail default style of tiny text in compose to avoid different sizes on copy-paste. */
      font-family: Arial, Helvetica, sans-serif;
      font-size: small;
    `;

    this.preventAutoComplete_ = false;
    this.autoComplete_ = new AutoComplete();

    this.addressContainer_ = document.createElement('div');
    this.addressContainer_.style.cssText = `
      display: flex;
      flex-wrap: wrap;
    `;
    this.append(this.addressContainer_);

    this.input_ = document.createElement('input');
    this.addressContainer_.append(this.input_);

    if (disabled_) {
      this.style.border = '0';
      this.style.color = 'grey';
      this.input_.style.display = 'none';
      return;
    }

    this.style.backgroundColor = 'var(--nested-background-color)';
    this.tabIndex = 0;
    this.addEventListener('focus', (e) => this.handleFocus_(e));
    this.addEventListener('click', (e) => this.handleClick_(e));
    this.addEventListener('keydown', (e) => this.handleyKeyDown_(e));
    this.addEventListener('copy', (e) => this.handleCopy_(e));
    this.addEventListener('paste', (e) => this.handlePaste_(e));

    this.cancelAutoComplete_();
    this.autoComplete_.addEventListener(
        EntrySelectedEvent.NAME,
        (e) => this.submitAutoComplete_(false, (<EntrySelectedEvent>e).entry));
    this.append(this.autoComplete_);

    // Make box-sizing:content-box so we can set the width to the chip
    // offsetWidth when making chips editable and have them be the same width
    // without needing to do extra work.
    this.input_.style.cssText = `
      border: 0;
      outline: 0;
      margin: 2px;
      box-sizing: content-box;
      background: transparent;
    `;
    this.input_.setAttribute('inputmode', 'email');
    this.input_.addEventListener(
        'input', (e) => this.handleInput_(<InputEvent>e));
    this.input_.addEventListener(
        'blur', (e: Event) => this.handleBlurInput_(e));
  }

  containsNode_(node: Node) {
    let container: Element|null = (node.nodeType === Node.ELEMENT_NODE) ?
        node as Element :
        node.parentElement;

    while (container) {
      if (container === this)
        return true;
      container = container.parentElement;
    }
    return false;
  }

  getContainingChip_(node: Node) {
    let container: Element|null = (node.nodeType === Node.ELEMENT_NODE) ?
        node as Element :
        node.parentElement;

    while (container) {
      if (container.classList.contains('chip'))
        return container;
      container = container.parentElement;
    }
    return null;
  }

  get value() {
    return this.getText_(this.addressContainer_.children as Iterable<Node>);
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

  getText_(chips: Iterable<Node>) {
    let values = [];
    for (let child of chips) {
      if (child === this.input_)
        values.push(this.input_.value);
      else
        values.push(child.textContent);
    }
    // Filter out empty string values.
    return values.filter(x => x).join(', ');
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

  submitAutoComplete_(skipSetFocus?: boolean, selectedItem?: ParsedAddress) {
    this.preventAutoComplete_ = false;

    selectedItem = selectedItem || this.getSelectedAddress_();
    // This happens when you arrow to edit a chip and there's no text in
    // this.input_.
    if (!selectedItem)
      return;

    let chip = this.createChip_(selectedItem);
    this.input_.before(chip);
    this.setInputValue_('');

    // Put the input back at the end of the address container.
    this.addressContainer_.append(this.input_);
    this.input_.style.width = 'auto';
    this.input_.style.flex = '1';
    if (!skipSetFocus)
      this.focusInput_();

    this.dispatchEvent(new Event('input'));

    this.cancelAutoComplete_();
  }

  createChip_(address: ParsedAddress) {
    let outer = document.createElement('span');
    outer.className = 'chip';
    outer.style.cssText = `
      font-size: .75rem;
      background-color: var(--nested-background-color);
      border: 1px solid var(--border-and-hover-color);
      border-radius: 10px;
      box-sizing: border-box;
      display: inline-flex;
      height: 20px;
      margin: 2px;
    `;
    outer.addEventListener(
        'pointerover',
        () => outer.style.backgroundColor = 'var(--border-and-hover-color)');
    outer.addEventListener(
        'pointerout',
        () => outer.style.backgroundColor = 'var(--nested-background-color)');

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

    inner.addEventListener('click', () => this.makeChipEditable_(outer));

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
    this.preventAutoComplete_ = false;
    this.focusInput_();
    // Make sure the input has no horizontal scrolling. This has the downside of
    // never shrinking the input, but it will shrink whenever we select an item
    // since we make it 1px at that point.
    this.input_.style.width = `${this.input_.scrollWidth}px`;

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
      let serialized = serializeAddress(lastAddress).trim();
      if (e.inputType === 'insertFromPaste' &&
          serialized.charAt(serialized.length - 1) == '>') {
        addresses.push(lastAddress);
        this.setInputValue_('');
      } else {
        this.setInputValue_(serialized);
      }

      for (let address of addresses) {
        this.input_.before(this.createChip_(address));
      }
    } else {
      this.updateAutoComplete_();
    }
  }

  handleBlurInput_(e: Event) {
    let relatedTarget = (e as FocusEvent).relatedTarget;
    if (!relatedTarget || !this.containsNode_(relatedTarget as Node) ||
        this.getContainingChip_(relatedTarget as Node)) {
      this.submitAutoComplete_(true);
      this.input_.style.width = '1px';
    }
  }

  focusInput_() {
    if (this.input_.style.width === '1px')
      this.input_.style.width = 'auto';
    this.input_.focus();
  }

  isCursorAtEnd_() {
    let end = this.input_.value.length;
    return this.input_.selectionStart === end &&
        this.input_.selectionEnd === end;
  }

  isCursorAtStart_() {
    return this.input_.selectionStart === 0 && this.input_.selectionEnd === 0;
  }

  removeChips_(...chips: Element[]) {
    for (let chip of chips) {
      if (chip === this.input_)
        this.setInputValue_('');
      else
        chip.remove();
    }
    this.focusInput_();
    this.dispatchEvent(new Event('input'));
  }

  makeChipEditable_(chip: HTMLElement) {
    if (this.disabled_)
      return;

    this.submitAutoComplete_();
    chip.before(this.input_);

    this.input_.style.width = `${chip.offsetWidth}px`;
    this.input_.style.flex = '';

    this.removeChips_(chip);
    this.setInputValue_(chip.textContent);
    this.focusInput_();

    this.input_.selectionStart = 0;
    this.input_.selectionEnd = this.input_.value.length;
  }

  getSelectedChips_() {
    let sel = window.getSelection();
    if (sel.isCollapsed)
      return null;

    let range = sel.getRangeAt(0);
    let start = range.startContainer;
    let end = range.endContainer;
    if (!this.containsNode_(start) || !this.containsNode_(end))
      return null;

    let startChip = this.getContainingChip_(start);
    let endChip = this.getContainingChip_(end);
    let element = startChip;
    let selected = [];
    while (element) {
      selected.push(element);
      if (element === endChip)
        break;
      element = element.nextElementSibling;
    }

    return selected;
  }

  handleFocus_(_e: FocusEvent) {
    // If we have an autocomplete dropdown open when the user clicks in the to
    // field, submit it before focusing the new input.
    this.submitAutoComplete_();
    this.focusInput_();
  }

  handleClick_(e: Event) {
    if (window.getSelection().isCollapsed &&
        !this.getContainingChip_(e.target as Node))
      this.focusInput_();
  }

  handleyKeyDown_(e: KeyboardEvent) {
    let selected = this.getSelectedChips_();

    switch (e.key) {
      case 'Delete':
        if (selected) {
          this.removeChips_(...selected);
          return;
        }

        if (this.isCursorAtEnd_()) {
          let chip = this.input_.nextSibling as Element;
          if (chip)
            this.removeChips_(chip);
        }
        return;

      case 'Backspace':
        if (selected) {
          this.removeChips_(...selected);
          return;
        }

        if (this.isCursorAtStart_()) {
          let chip = this.input_.previousSibling as Element;
          if (chip)
            this.removeChips_(chip);
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
            this.makeChipEditable_(chip);
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
            this.makeChipEditable_(chip);
          } else {
            this.submitAutoComplete_();
          }
          e.preventDefault();
        }
        return;
    }
  }

  handlePaste_(_e: ClipboardEvent) {
    let selected = this.getSelectedChips_();
    if (selected)
      this.removeChips_(...selected);
    this.focusInput_();
  }

  handleCopy_(e: ClipboardEvent) {
    let selected = this.getSelectedChips_();
    if (!selected)
      return;
    let text = this.getText_(selected);
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  }
}

window.customElements.define('mt-address-compose', AddressCompose);
