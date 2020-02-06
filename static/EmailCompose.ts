import {Action, Actions, Shortcut} from './Actions.js';
import {AutoComplete, AutoCompleteEntry, EntrySelectedEvent} from './AutoComplete.js';
import {notNull, ParsedAddress, sandboxedDom} from './Base.js';

const SEPARATOR = ' ';
const EMAIL_CLASS_NAME = 'mk-email';

export const INSERT_LINK: Action = {
  key: new Shortcut('k', true, false),
  name: 'Insert link',
  description: 'Converts selected text to be a link.',
};

export const INSERT_LINK_HIDDEN = Object.assign({}, INSERT_LINK);
INSERT_LINK_HIDDEN.hidden = true;

const ACTIONS = [INSERT_LINK, INSERT_LINK_HIDDEN];

export class SubmitEvent extends Event {
  static NAME = 'submit';
  constructor() {
    super(SubmitEvent.NAME);
  }
}

export class CancelEvent extends Event {
  static NAME = 'cancel';
  constructor() {
    super(CancelEvent.NAME);
  }
}

export class EmailCompose extends HTMLElement {
  private autocompleteRange_: Range|null;
  private autoComplete_: AutoComplete;
  private bubble_: HTMLElement|null;
  protected content: HTMLElement;
  private placeholder_: string|undefined;
  private boundSelectionChange_: () => void;
  static EMAIL_CLASS_NAME: string;

  constructor(private isSingleline_?: boolean) {
    super();

    this.style.cssText = `
      display: flex;
      margin: 4px;
    `;

    this.autocompleteRange_ = null;

    this.autoComplete_ = new AutoComplete();
    this.autoComplete_.addEventListener(
        EntrySelectedEvent.NAME,
        (e) => this.submitAutocomplete_((<EntrySelectedEvent>e).entry));
    this.append(this.autoComplete_);
    this.hideAutocompleteMenu_();

    this.bubble_ = null;

    this.content = document.createElement('div');
    // Put contain:content so things inside the email can't be positioned
    // outside of it.
    this.content.style.cssText = `
      background-color: var(--nested-background-color);
      contain: content;
      flex: 1;
      min-width: 200px;
      overflow: auto;
      padding: 8px;
      outline: none;
      word-break: break-word;
      /* Match gmail default style of tiny text in compose to avoid different sizes on copy-paste. */
      font-family: Arial, Helvetica, sans-serif;
      font-size: small;
    `;
    this.content.contentEditable = 'true';
    this.content.addEventListener('blur', this.cancelAutocomplete_.bind(this));
    this.content.addEventListener('click', (e) => this.handleClick_(e));
    this.append(this.content);

    this.addEventListener('keydown', (e) => this.handleKeyDown_(e));
    this.addEventListener('input', async (e: Event) => {
      this.handleInput(<InputEvent>e);
      this.updatePlaceholder_();
    });

    this.boundSelectionChange_ = this.handleSelectionChange_.bind(this);
  }

  connectedCallback() {
    document.addEventListener('selectionchange', this.boundSelectionChange_);
  }

  disconnectedCallback() {
    document.removeEventListener('selectionchange', this.boundSelectionChange_);
  }

  handleClick_(e: MouseEvent) {
    // The contentEditable=false on mailto links makes them clickable again.
    if (this.getContainingLink_(e.target as Node))
      e.preventDefault();
  }

  bubbleIsFocused_() {
    if (!this.bubble_)
      return false;
    let node = document.activeElement;
    while (node) {
      if (node === this.bubble_)
        return true;
      node = node.parentElement;
    }
    return false;
  }

  isInsideContent_(node: Node) {
    let parent = node.parentNode;
    while (parent) {
      if (parent === this.content)
        return true;
      parent = parent.parentNode;
    }
    return false;
  }

  handleSelectionChange_() {
    if (this.bubbleIsFocused_())
      return;

    if (this.bubble_)
      this.bubble_.remove();

    let selection = notNull(window.getSelection());
    if (selection.rangeCount === 0)
      return;
    let range = selection.getRangeAt(0);
    let link = this.getContainingLink_(range.commonAncestorContainer);
    if (!link || !this.isInsideContent_(link))
      return;

    this.showLinkBubble_(link);
  }

  showLinkBubble_(link: HTMLAnchorElement) {
    this.bubble_ = document.createElement('div');
    this.bubble_.className = 'link-bubble';
    this.bubble_.style.cssText = `
      position: fixed;
      white-space: nowrap;
      box-shadow: 2px 2px 10px 1px var(--border-and-hover-color);
      background-color: var(--overlay-background-color);
      z-index: 100;
    `;

    let input = document.createElement('input');
    input.value = link.href;
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        let selection = notNull(window.getSelection());
        selection.selectAllChildren(link);
        selection.collapseToEnd();
        e.preventDefault();
        e.stopPropagation();
      }
    });
    input.addEventListener('change', () => {
      notNull(link).href = input.value;
      this.dispatchEvent(new Event('input'));
    });

    let deleteButton = document.createElement('a');
    // Make this focusable so that clicking on it keeps focus inside the link
    // bubble and bubbleIsFocused_ returns true on the selection change from the
    // mousedown to prevent the bubble being closed before the click is
    // completed.
    deleteButton.tabIndex = -1;
    deleteButton.textContent = '[remove]';
    deleteButton.addEventListener('click', () => {
      link = notNull(link);
      link.before(link.textContent);
      link.remove();
      notNull(this.bubble_).remove();
      this.dispatchEvent(new Event('input'));
    });

    this.bubble_.append('URL ', input, ' ', deleteButton);
    this.append(this.bubble_);

    let position =
        this.positionRelativeTo_(this.bubble_, link.getBoundingClientRect());
    this.bubble_.style.top = `${position.top}px`;
    this.bubble_.style.left = `${position.left}px`;
  }

  positionRelativeTo_(node: HTMLElement, rect: ClientRect) {
    let buffer = 4;
    let height = node.offsetHeight;
    let windowHeight = document.documentElement.offsetHeight;
    let putAbove = windowHeight < (rect.bottom + buffer + height);
    let top = putAbove ? rect.top - buffer - height : rect.bottom + buffer;

    let width = node.offsetWidth;
    let windowWidth = document.documentElement.offsetWidth;
    let shiftLeft = windowWidth < (rect.left + width)
    let left = shiftLeft ? windowWidth - width : rect.left;

    return {top: top, left: left};
  }

  async takeAction_(action: Action) {
    if (action == INSERT_LINK || action == INSERT_LINK_HIDDEN) {
      this.insertLink_();
      return;
    }

    throw new Error(`Invalid action: ${JSON.stringify(action)}`);
  }

  private async handleKeyDown_(e: KeyboardEvent) {
    let action = Actions.getMatchingAction(e, ACTIONS);
    if (action) {
      e.preventDefault();
      this.takeAction_(action);
    }

    switch (e.key) {
      case 'Escape':
        if (this.updateIsAutocompleting()) {
          this.cancelAutocomplete_();
        } else {
          this.dispatchEvent(new CancelEvent());
          // Prevent the escape in quick reply both closing quick reply and
          // taking you back to the threadlist.
          // TODO: Technically we should only do this if stopPropagation is
          // called on the dispatched cancel event. We could make that work with
          // a class that wraps the KeyboardEvent and delgates the
          // stopPropagation call if needed.
          e.stopPropagation();
        }
        return;

      case 'Enter':
        if (e.altKey || e.metaKey || e.shiftKey)
          return;

        if (this.updateIsAutocompleting()) {
          this.submitAutocomplete_();
          e.preventDefault();
        } else if (this.isSingleline_) {
          this.dispatchEvent(new SubmitEvent());
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
  }

  private getContainingLink_(node: Node|null) {
    while (node) {
      if (node.nodeName === 'A')
        return node as HTMLAnchorElement;
      node = node.parentNode;
    }
    return null;
  }

  private insertLink_() {
    let selection = notNull(window.getSelection());
    if (selection.rangeCount === 0)
      return;

    let range = selection.getRangeAt(0);
    if (this.getContainingLink_(range.commonAncestorContainer)) {
      alert('Selection is already in a link.');
      return;
    }

    if (selection.isCollapsed) {
      alert('Not supported. Select some text to insert a link.');
    } else {
      let contents = range.extractContents();
      let link = document.createElement('a');
      link.append(contents);
      range.insertNode(link);
      this.showLinkBubble_(link);
      notNull(notNull(this.bubble_).querySelector('input')).focus();
    }
  }

  private updatePlaceholder_() {
    let content = this.content;
    if (content.textContent.length) {
      content.removeAttribute('placeholder');
      content.style.color = '';
    } else {
      content.setAttribute('placeholder', this.placeholder_ || '');
      content.style.color = 'var(--dim-text-color)';
    }
  }

  protected updateIsAutocompleting() {
    let isAutoCompleting = this.isStillAutoCompleting();
    if (!isAutoCompleting)
      this.cancelAutocomplete_();
    return isAutoCompleting;
  }

  protected cursor() {
    return notNull(window.getSelection()).getRangeAt(0).cloneRange();
  }

  protected renderAutocomplete() {
    this.autoComplete_.style.display = '';
    let candidates = this.autoComplete_.render(this.autocompleteText());

    // If there's only one candidate, that means there were no matches in
    // contacts as we always add a single fallback. If that candidate includes
    // a space, then we know the user isn't typing an email address and we
    // should cancel the autocomplete entirely.
    if (candidates.length == 1 &&
        (candidates[0].address.includes(' ') ||
         candidates[0].name.includes(' '))) {
      this.cancelAutocomplete_();
      return;
    }

    let range = notNull(this.getAutocompleteRange());
    let rect = range.getBoundingClientRect();
    let position = this.positionRelativeTo_(this.autoComplete_, rect);
    this.autoComplete_.setPosition(position.left, position.top);
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

  getEmails() {
    let links = <NodeListOf<HTMLLinkElement>>this.content.querySelectorAll(
        `a.${EMAIL_CLASS_NAME}`);
    let results: ParsedAddress[] = [];
    for (let link of links) {
      let name = link.textContent;
      // Remove the leading +.
      name = name.substring(1, name.length);
      let address = link.href.replace('mailto:', '');
      // TODO: This needs to use serializeAddress so it correclty quotes the
      // name if it has a comma.
      results.push(name.includes('@') ? {name: '', address} : {name, address});
    }
    return results;
  }

  get plainText() {
    return this.content.textContent;
  }

  get rawValue() {
    return this.content.innerHTML;
  }

  get value() {
    let cloned = <HTMLElement>this.content.cloneNode(true);
    let emails = cloned.querySelectorAll(`a.${EMAIL_CLASS_NAME}`);
    for (let email of emails) {
      email.removeAttribute('class');
      email.removeAttribute('contentEditable');
      email.removeAttribute('tabIndex');
    }
    // Need to use innerHTML, but need to be careful never to write this
    // innerHTML in a non-sandboed context since it could be a reply to an
    // unsafe email.
    // Compose is white - space: pre - wrap and shift + enter inserts \n's.
    // Convert them to BRs so they render when shown in white-space:normal
    // contexts.
    return cloned.innerHTML.replace('\n', '<br>');
  }

  set value(value) {
    // TODO: There's probably a more robust thing we should be doing here. If
    // you end up copy-pasting out of make-time, then the elements pasted into
    // the contentEditable region will instantiate actual components and break
    // the page.
    // TODO: Technically we only need to do this on paste.
    // TODO: Probably need to do this for rendering threads as well since
    // someone could technicall sent maketime components in an email.
    value = value.replace(/\<mt-/g, '<inert-mt-');
    value = value.replace(/\<\/mt-/g, '</inert-mt-');

    this.content.textContent = '';
    let newContent = sandboxedDom(value);
    this.content.append(...newContent.childNodes);

    this.updatePlaceholder_();
    if (this.bubble_)
      this.bubble_.remove();
  }

  get placeholder() {
    return this.placeholder_;
  }

  set placeholder(text) {
    this.placeholder_ = text;
    this.updatePlaceholder_();
  }

  setEnterKeyHintSend() {
    this.content.setAttribute('enterkeyhint', 'send');
  }

  focus() {
    return this.content.focus();
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
    link.className = EMAIL_CLASS_NAME;
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

    // If the next character is the separator, don't include it, but still
    // move the cursor after it.
    let separator = document.createTextNode(SEPARATOR);
    range.collapse();
    range.insertNode(separator);
    notNull(window.getSelection()).collapse(separator, separator.length);
  }
}

window.customElements.define('mt-email-compose', EmailCompose);
