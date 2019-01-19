import {AutoComplete, EntrySelectedEvent, AutoCompleteEntry} from './AutoComplete.js';
import {notNull} from './Base.js';
import {Contacts} from './Contacts.js';

export class SubmitEvent extends Event {
  constructor(public ctrlKey: boolean) {
    super('submit');
  }
}

export abstract class Compose extends HTMLElement {
  private autoComplete_: AutoComplete;
  protected content: HTMLElement;
  private placeholder_: string|undefined;
  static EMAIL_CLASS_NAME: string;

  abstract isStillAutoCompleting(): boolean|null;
  abstract autocompleteText(): string;
  abstract selectedEntry(selectedItem: AutoCompleteEntry): Node;
  protected abstract getAutocompleteRange(): Range|null;
  protected abstract clearAutocompleteRange(): void;
  protected abstract insertAddress(selectedItem: AutoCompleteEntry): void;
  protected abstract handleInput(e: InputEvent): void;

  constructor(
      contacts: Contacts, private valueIsPlainText_: boolean,
      isSingleline?: boolean, private putMenuAbove_?: boolean) {
    super();

    this.style.display = 'flex';

    this.autoComplete_ = new AutoComplete(contacts);
    this.autoComplete_.addEventListener(
        EntrySelectedEvent.NAME,
        (e) => this.submitAutocomplete_((<EntrySelectedEvent>e).entry));
    this.append(this.autoComplete_);

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
            this.autoComplete_.adjustIndex(-1);
          }
          return;

        case 'ArrowDown':
          if (this.updateIsAutocompleting()) {
            e.preventDefault();
            this.autoComplete_.adjustIndex(1);
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
    this.autoComplete_.style.display = '';
    let candidates = this.autoComplete_.render(this.autocompleteText());

    // If there's only one candidate, that means there were no matches in
    // contacts as we always add a single fallback. If that candidate includes a
    // space, then we know the user isn't typing an email address and we should
    // cancel the autocomplete entirely.
    if (candidates.length == 1 &&
        (candidates[0].address.includes(' ') ||
         candidates[0].name.includes(' '))) {
      this.cancelAutocomplete_();
      return;
    }

    let range = notNull(this.getAutocompleteRange());
    let rect = range.getBoundingClientRect();
    this.autoComplete_.style.left = `${rect.left}px`;
    if (this.putMenuAbove_) {
      this.autoComplete_.style.bottom =
          `${document.documentElement.offsetHeight - rect.top}px`;
    } else {
      this.autoComplete_.style.top = `${rect.bottom + 4}px`;
    }
  }

  hideAutocompleteMenu_() {
    this.autoComplete_.style.display = 'none';
  }

  cancelAutocomplete_() {
    this.clearAutocompleteRange();
    this.hideAutocompleteMenu_();
  }

  submitAutocomplete_(selectedItem?: AutoCompleteEntry) {
    if (!selectedItem)
      selectedItem = this.autoComplete_.selected();
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
      // TODO: This needs to use serializeAddress so it correclty quotes the
      // name if it has a comma.
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
