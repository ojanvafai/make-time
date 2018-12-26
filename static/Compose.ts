export class AutoCompleteEntry extends HTMLElement {
  name: string;
  email: string;

  constructor() {
    super();
    this.name = '';
    this.email = '';
  }
}
window.customElements.define('mt-auto-complete-entry', AutoCompleteEntry);

export abstract class Compose extends HTMLElement {
  separator: string;
  private content_: HTMLElement;
  private placeholder_: string|undefined;
  autocompleteRange: Range|null = null;
  private autocompleteContainer_: HTMLElement|null = null;
  private autocompleteIndex_: number|undefined;
  static EMAIL_CLASS_NAME: string;

  abstract prepareAutocomplete(e: Event): void;
  abstract isStillAutoCompleting(): boolean|null;
  abstract selectedEntry(selectedItem: any): any;

  constructor(private contacts_: any, opt_isMultiline?: boolean) {
    super();

    this.style.display = 'flex';
    this.separator = '';

    this.content_ = document.createElement('div');
    this.content_.style.cssText = `
      flex: 1;
      overflow: auto;
      border: 1px solid;
      padding: 8px;
      outline: none;

      /* Match gmail default style of tiny text in compose to avoid different sizes on copy-paste. */
      font-family: Arial, Helvetica, sans-serif;
      font-size: small;
    `;
    this.content_.contentEditable = opt_isMultiline ? 'true' : 'plaintext-only';
    this.content_.addEventListener('blur', this.cancelAutocomplete_.bind(this));
    this.append(this.content_);

    this.addEventListener('keydown', async (e) => {
      switch (e.key) {
        case 'Escape':
          if (this.updateIsAutocompleting_())
            this.cancelAutocomplete_();
          else
            this.dispatchEvent(new Event('cancel'));
          return;

        case 'Enter':
          if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)
            return;

          if (this.updateIsAutocompleting_()) {
            this.submitAutocomplete_();
            e.preventDefault();
          } else if (!opt_isMultiline) {
            this.dispatchEvent(new Event('submit'));
            e.preventDefault();
          }
          return;

        case 'ArrowUp':
          if (this.updateIsAutocompleting_()) {
            e.preventDefault();
            this.adjustAutocompleteIndex(-1);
          }
          return;

        case 'ArrowDown':
          if (this.updateIsAutocompleting_()) {
            e.preventDefault();
            this.adjustAutocompleteIndex(1);
          }
          return;
      }
    });

    this.addEventListener('input', async (e) => {
      if (this.updateIsAutocompleting_()) {
        this.renderAutocomplete_();
      } else {
        this.prepareAutocomplete(e);
      }
      this.updatePlaceholder_();
    });
  }

  updatePlaceholder_() {
    let content = this.content_;
    if (content.textContent.length) {
      content.removeAttribute('placeholder');
      content.style.color = '';
    } else {
      content.setAttribute('placeholder', this.placeholder_ || '');
      content.style.color = 'grey';
    }
  }

  updateIsAutocompleting_() {
    let isAutoCompleting = this.isStillAutoCompleting();
    if (!isAutoCompleting)
      this.cancelAutocomplete_();
    return isAutoCompleting;
  }

  cursor_() {
    return window.getSelection().getRangeAt(0).cloneRange();
  }

  autocompleteText_() {
    let cursor = this.cursor_();
    let range = <Range>this.autocompleteRange;
    cursor.setStart(range.endContainer, range.endOffset);
    return cursor.toString();
  }

  renderAutocomplete_() {
    if (!this.autocompleteContainer_) {
      this.autocompleteContainer_ = document.createElement('div');
      this.autocompleteContainer_.style.cssText = `
        background-color: white;
        position: fixed;
        border: 1px solid;
        box-shadow: 2px -2px 10px 1px lightgrey;
      `;
      this.append(this.autocompleteContainer_);
    }

    if (this.contacts_.length)
      this.autocompleteContainer_.classList.remove('no-contacts');
    else
      this.autocompleteContainer_.classList.add('no-contacts');

    let candidates = this.getAutocompleteCandidates_();

    this.autocompleteContainer_.textContent = '';
    for (let candidate of candidates) {
      let entry = new AutoCompleteEntry();
      // Prevent clicking on the menu losing cursor position.
      entry.onmousedown = (e) => {
        e.preventDefault();
      };
      entry.onclick = () => {
        this.submitAutocomplete_(entry);
      };
      entry.style.cssText = `
        display: block;
        padding: 4px;
      `;
      let text = '';
      if (candidate.name) {
        text += `${candidate.name}: `;
        entry.name = candidate.name;
      }
      text += candidate.email;
      entry.textContent = text
      entry.email = candidate.email;
      this.autocompleteContainer_.append(entry);
    }

    this.selectAutocompleteItem_(0);

    let range = <Range>this.autocompleteRange;
    let rect = range.getBoundingClientRect();
    this.autocompleteContainer_.style.left = `${rect.left}px`;
    this.autocompleteContainer_.style.bottom =
        `${document.documentElement.offsetHeight - rect.top}px`;
  }

  adjustAutocompleteIndex(adjustment: number) {
    if (!this.autocompleteIndex_)
      throw 'Something went wrong. This should never happen.';

    let container = <HTMLElement>this.autocompleteContainer_;
    let newIndex = Math.max(
        0,
        Math.min(
            this.autocompleteIndex_ + adjustment,
            container.children.length - 1));
    this.selectAutocompleteItem_(newIndex);
  }

  selectAutocompleteItem_(index: number) {
    let container = <HTMLElement>this.autocompleteContainer_;
    this.autocompleteIndex_ = index;
    for (let i = 0; i < container.children.length; i++) {
      let child = <AutoCompleteEntry>container.children[i];
      child.style.backgroundColor = (i == index) ? '#6677dd' : 'white';
      child.style.color = (i == index) ? 'white' : 'black';
    }
  }

  getAutocompleteCandidates_() {
    let results: {name: string, email: string}[] = [];

    let search = this.autocompleteText_();
    if (!search)
      return results;

    search = search.toLowerCase();

    for (let contact of this.contacts_) {
      if (contact.name && contact.name.toLowerCase().includes(search)) {
        for (let email of contact.emails) {
          results.push({name: contact.name, email: email});
        }
      } else {
        for (let email of contact.emails) {
          let lowerCaseEmail = email.toLowerCase();
          if (lowerCaseEmail.split('@')[0].includes(search))
            results.push({name: contact.name, email: email});
        }
      }
    }

    // Include whatever the user is typing in case it's not in their contacts or
    // if the contacts API is down.
    results.push({name: search.split('@')[0], email: search});

    // TODO: Sort the results to put +foo address after the main ones.
    // Prefer things that start with the search text over substring matching.
    // Sort by usage?
    results = results.splice(0, 4);
    return results;
  }

  hideAutocompleteMenu_() {
    if (!this.autocompleteContainer_)
      return;
    this.autocompleteContainer_.remove();
    this.autocompleteContainer_ = null;
  }

  cancelAutocomplete_() {
    this.autocompleteRange = null;
    this.hideAutocompleteMenu_();
  }

  submitAutocomplete_(opt_selectedItem?: HTMLElement) {
    if (!this.autocompleteIndex_) {
      throw 'Attempted to submit autocomplete without a selected entry.';
      return;
    }

    let container = <HTMLElement>this.autocompleteContainer_;
    let range = <Range>this.autocompleteRange;

    let selectedItem =
        opt_selectedItem || container.children[this.autocompleteIndex_];

    let cursor = this.cursor_();
    cursor.setStart(range.startContainer, range.startOffset);
    cursor.deleteContents();

    let selectedEntry = this.selectedEntry(selectedItem);
    cursor.insertNode(selectedEntry);

    let separator = document.createTextNode(this.separator);
    cursor.collapse();
    cursor.insertNode(separator);
    window.getSelection().collapse(separator, separator.length);

    this.cancelAutocomplete_();
    this.dispatchEvent(new Event('email-added'));
  }

  getEmails() {
    let links = <NodeListOf<HTMLLinkElement>>this.content_.querySelectorAll(
        `a.${Compose.EMAIL_CLASS_NAME}`);
    let results: string[] = [];
    for (let link of links) {
      let name = link.textContent;
      // Remove the leading +.
      name = name.substring(1, name.length);
      let email = link.href.replace('mailto:', '');
      results.push(name.includes('@') ? email : `${name} <${email}>`);
    }
    return results;
  }

  get plainText() {
    return this.content_.textContent;
  }

  get value() {
    let cloned = <HTMLElement>this.content_.cloneNode(true);
    let emails = cloned.querySelectorAll(`a.${Compose.EMAIL_CLASS_NAME}`);
    for (let email of emails) {
      email.removeAttribute('class');
      email.removeAttribute('contentEditable');
      email.removeAttribute('tabIndex');
    }
    return cloned.innerHTML;
  }

  set value(html) {
    this.content_.innerHTML = html;
  }

  get placeholder() {
    return this.placeholder_;
  }

  set placeholder(text) {
    this.placeholder_ = text;
    this.updatePlaceholder_();
  }

  focus() {
    return this.content_.focus();
  }
}

window.customElements.define('mt-compose', Compose);

Compose.EMAIL_CLASS_NAME = 'mk-email';
