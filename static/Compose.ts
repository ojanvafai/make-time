import { Contacts } from "./Contacts";

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

export class SubmitEvent extends Event {
  constructor(public ctrlKey: boolean) {
    super('submit');
  }
}

export abstract class Compose extends HTMLElement {
  protected content: HTMLElement;
  private placeholder_: string|undefined;
  private autocompleteContainer_: HTMLElement|null = null;
  private autocompleteIndex_: number|undefined;
  static EMAIL_CLASS_NAME: string;

  abstract isStillAutoCompleting(): boolean|null;
  abstract autocompleteText(): string;
  abstract selectedEntry(selectedItem: any): any;
  protected abstract getAutocompleteRange(): Range|null;
  protected abstract clearAutocompleteRange(): void;
  protected abstract insertAddress(selectedItem: AutoCompleteEntry): void;
  protected abstract handleInput(e: InputEvent): void;

  constructor(
      private contacts_: Contacts, private valueIsPlainText_: boolean,
      isSingleline?: boolean, private putMenuAbove_?: boolean) {
    super();

    this.style.display = 'flex';

    this.content = document.createElement('div');
    this.content.style.cssText = `
      flex: 1;
      overflow: auto;
      border: 1px solid;
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
            this.adjustAutocompleteIndex(-1);
          }
          return;

        case 'ArrowDown':
          if (this.updateIsAutocompleting()) {
            e.preventDefault();
            this.adjustAutocompleteIndex(1);
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
    if (!this.autocompleteContainer_) {
      this.autocompleteContainer_ = document.createElement('div');
      this.autocompleteContainer_.style.cssText = `
        background-color: white;
        position: fixed;
        border: 1px solid;
        box-shadow: 2px -2px 10px 1px lightgrey;
      `;
      // Fix box shadow to respect menu position
      this.append(this.autocompleteContainer_);
    }

    if (this.contacts_.getAll().length)
      this.autocompleteContainer_.classList.remove('no-contacts');
    else
      this.autocompleteContainer_.classList.add('no-contacts');

    let candidates = this.getAutocompleteCandidates_();

    // If there's only one candidate, that means there were no matches in
    // contacts as we always add a single fallback. If that candidate includes a
    // space, then we know the user isn't typing an email address and we should
    // cancel the autocomplete entirely.
    if (candidates.length == 1 && candidates[0].email.includes(' ')) {
      this.cancelAutocomplete_();
      return;
    }

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

    let range = this.getAutocompleteRange();
    if (!range)
      throw 'This should never happen.';
    let rect = range.getBoundingClientRect();
    this.autocompleteContainer_.style.left = `${rect.left}px`;
    if (this.putMenuAbove_) {
      this.autocompleteContainer_.style.bottom =
          `${document.documentElement.offsetHeight - rect.top}px`;
    } else {
      this.autocompleteContainer_.style.top = `${rect.bottom + 4}px`;
    }
  }

  adjustAutocompleteIndex(adjustment: number) {
    if (this.autocompleteIndex_ === undefined)
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

    let search = this.autocompleteText();
    if (!search)
      return results;

    search = search.toLowerCase();

    for (let contact of this.contacts_.getAll()) {
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
    this.clearAutocompleteRange();
    this.hideAutocompleteMenu_();
  }

  submitAutocomplete_(selectedItem?: AutoCompleteEntry) {
    if (this.autocompleteIndex_ === undefined)
      throw 'Attempted to submit autocomplete without a selected entry.';
    if (!this.autocompleteContainer_)
      throw 'This should never happen';

    if (!selectedItem) {
      selectedItem = <AutoCompleteEntry>this.autocompleteContainer_
                         .children[this.autocompleteIndex_];
    }
    this.insertAddress(selectedItem);

    this.cancelAutocomplete_();
    this.dispatchEvent(new Event('email-added'));
  }

  // TODO: Return and pass around ParsedAddresses instead of strings.
  getEmails() {
    let links = <NodeListOf<HTMLLinkElement>>this.content.querySelectorAll(
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
    return this.content.textContent;
  }

  get value() {
    if (this.valueIsPlainText_)
      return this.content.textContent;

    let cloned = <HTMLElement>this.content.cloneNode(true);
    let emails = cloned.querySelectorAll(`a.${Compose.EMAIL_CLASS_NAME}`);
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
    if (this.valueIsPlainText_)
      this.content.textContent = value;
    else
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
}

window.customElements.define('mt-compose', Compose);

Compose.EMAIL_CLASS_NAME = 'mk-email';
