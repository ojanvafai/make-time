import {createCircle, createSvgContainer, defined, linkify, notNull, sandboxedDom} from './Base.js';
import {Message} from './Message.js';

// Rolling hash taken from https://gist.github.com/i-e-b/b892d95ac7c0cf4b70e4.
let MINIMUM_HASH_LENGTH = 10;
let MINIMUM_ELIDE_LENGTH = 100;
let TOGGLER: SVGElement;
let strippedTextMap = new WeakMap();

export class QuoteElidedMessage extends HTMLElement {
  // These are initialized in computeHashes_, which is always called from the
  // constructor.
  private hashes_!: Map<string, Element[]>;

  constructor(currentMessage: string, previousMessage: Message|undefined) {
    super();

    // Someone got a message with the following image in the message body that
    // would cause gmail to log the user out!
    // <img
    // src="https://mail.google.com/mail/u/0/?ik=8aab3eccbe&amp;view=snatt">
    // Gmail turns this into a googleusercontent.com url that still 404s, so
    // until we see a reason to do otherwise, just mangle the URL to make it
    // 404. It needs both the ik and view parameters to force the logout.
    currentMessage =
        currentMessage.replace(/src="https:\/\/mail\.google\.com\//g, 'src="');

    // Body elements get stripped by sandboxedDom. This matters for cases where
    // there is inline styling on the body element (e.g. a background color).
    // Convert them to divs first. This matches gmail's behavior, although this
    // specific code for it is pretty hacky. Don't need to bother with the
    // closing tag since the HTML parser will insert it and drop the </body>.
    currentMessage = currentMessage.replace(/<body/g, '<div');

    this.append(sandboxedDom(currentMessage));

    this.sanitizeContent_();
    linkify(this);

    this.computeHashes_();

    if (previousMessage)
      this.processQuoteElides_(previousMessage);
  }

  async processQuoteElides_(previousMessage: Message) {
    await this.elideAllMatches_(previousMessage);
    this.expandToNonTextSiblings_();
    this.undoNestedElides_();
    this.insertToggleButtons_();
    this.updateAllStyling_();
  }

  async elideAllMatches_(previousMessage: Message) {
    let previousHashes =
        (await previousMessage.getQuoteElidedMessage()).getHashes();
    for (let entry of this.hashes_) {
      if (previousHashes.has(entry[0])) {
        for (let match of entry[1]) {
          setElidedState(match, 'hidden');
        }
      }
    }
  }

  hasEmptyTextContent_(node: ChildNode|null) {
    return node && !this.quoteStrippedText_(node);
  }

  expandToNonTextSiblings_() {
    for (let match of this.querySelectorAll('[mk-elide]')) {
      let previous = <ChildNode>match;
      // TODO: Include "XXX wrote" prefixes here as well.
      // TODO: Hash the outerHTML of the element to make sure it has at least
      // a corresponding thing in the previous message. Or maybe just exclude
      // images?
      while (previous.previousSibling &&
             this.hasEmptyTextContent_(<ChildNode>previous.previousSibling)) {
        setElidedState(<ChildNode>previous.previousSibling, 'hidden');
        previous = <ChildNode>previous.previousSibling;
      }

      let next = <ChildNode>match;
      while (next.nextSibling &&
             this.hasEmptyTextContent_(<ChildNode>next.nextSibling)) {
        setElidedState(<ChildNode>next.nextSibling, 'hidden');
        next = <ChildNode>next.nextSibling;
      }
    }
  }

  undoNestedElides_() {
    for (let element of this.querySelectorAll('[mk-elide]')) {
      let parent = element.parentElement;
      while (parent) {
        if (parent.hasAttribute('mk-elide')) {
          element.removeAttribute('mk-elide');
          break;
        }
        parent = parent.parentElement;
      }
    }
  }

  elidesHaveMinimumLength_(element: Element|null) {
    let length = 0;
    while (length < MINIMUM_ELIDE_LENGTH && element) {
      if (!element.hasAttribute('mk-elide'))
        return false;
      length += element.textContent.length;
      // TODO: Is skipping text nodes correct?
      element = element.nextElementSibling;
    }
    return length >= MINIMUM_ELIDE_LENGTH;
  }

  removeAdjacentElides_(element: Element|null) {
    // TODO: move the attribute name into a constant.
    while (element && element.nodeType == Node.ELEMENT_NODE &&
           element.hasAttribute('mk-elide')) {
      element.removeAttribute('mk-elide');
      // TODO: Is skipping text nodes correct?
      element = element.nextElementSibling;
    }
  }

  insertToggleButtons_() {
    for (let match of this.querySelectorAll('[mk-elide]')) {
      if (!this.isElided_(match.previousElementSibling)) {
        if (this.elidesHaveMinimumLength_(match)) {
          match.before(this.getToggler_());
        } else {
          this.removeAdjacentElides_(match);
        }
      }
    }
  }

  updateAllStyling_() {
    for (let match of this.querySelectorAll('[mk-elide]')) {
      updateStyling(<HTMLElement>match);
    }
  }

  sanitizeContent_() {
    this.removeDisallowedElements_();
    this.preWrapElements_();
  }

  // This removes elements that break make-time rendering. This is not a
  // security feature.
  removeDisallowedElements_() {
    // Behaviors to disallow:
    // - meta can mess with the viewport and other things.
    // - title will update the tab title for make time.
    // - link rel=stylesheet and style modify maketime's UI.
    // - base causes maketime UI links to have a different base url.
    let tagNames = ['meta', 'title', 'link', 'style', 'script', 'base'];
    for (let tagName of tagNames) {
      for (let node of this.querySelectorAll(tagName)) {
        node.remove();
      }
    }
  }

  // gmail appears to rewrite white-space:pre to white-space:pre-wrap and some
  // content (e.g. crbug.com emails) seems to warrant this.
  preWrapElements_() {
    // TODO: Technically this can return non-HTMLElements.
    let nodes = this.querySelectorAll<HTMLElement>('*');
    for (let node of nodes) {
      // TODO: There are other tags that default to white-space:pre as well.
      if (node.tagName === 'PRE' || node.style.whiteSpace === 'pre')
        node.style.whiteSpace = 'pre-wrap';
    }
  }

  getToggler_() {
    if (!TOGGLER) {
      TOGGLER = createSvgContainer(
          '0 0 24 24',
          createCircle(5, 12, 2),
          createCircle(12, 12, 2),
          createCircle(19, 12, 2),
      );
      TOGGLER.classList.add('toggler');
      TOGGLER.style.cssText = `
        width: 16px;
        padding: 1px 4px;
        user-select: none;
        -webkit-user-select: none;
        fill: var(--thread-text-color);
      `;
    }
    let toggler = <SVGSVGElement>TOGGLER.cloneNode(true);
    toggler.addEventListener('click', toggleElided);
    return toggler;
  }

  getHashes() {
    return defined(this.hashes_);
  }

  computeHashes_() {
    // Store diff hashes on the message as a performance optimization since we
    // need to compute once for the current message and once for the previous
    // message == 2x for almost every message.
    let elements = this.querySelectorAll('*');
    this.hashes_ = new Map();
    for (let element of elements) {
      let text = this.quoteStrippedText_(element);
      if (text.length > MINIMUM_HASH_LENGTH) {
        let list: Element[]|undefined = this.hashes_.get(text);
        if (!list) {
          list = [];
          this.hashes_.set(text, list);
        }
        list.push(element);
      }
    }
  }

  isQuoteCharacter_(char: string) {
    switch (char) {
      case '[':
      case '>':
      case '<':
      case ']':
      case '"':
      case ' ':
        return true;
      default:
        return false;
    }
  }

  quoteStrippedText_(node: ChildNode|CharacterData) {
    let result = strippedTextMap.get(node);
    if (!result) {
      let nonQuoteIndex = 0;
      let text = node.textContent || '';
      while (nonQuoteIndex < text.length &&
             this.isQuoteCharacter_(text.charAt(nonQuoteIndex))) {
        nonQuoteIndex++;
      }
      result = text.substring(nonQuoteIndex);
      strippedTextMap.set(node, result);
    }
    return result;
  }

  isElided_(element: Element|null) {
    return element && element.hasAttribute && element.hasAttribute('mk-elide');
  }
}
window.customElements.define('mt-quote-elided-message', QuoteElidedMessage);

function updateStyling(element: HTMLElement) {
  // Ideally we'd use clipping instead of display:none so that the toggler
  // doesn't jump around when the contents of the elided region are shown, but
  // for threads with a lot of eliding, display none is considerably faster at
  // recalc and layout since we skip whole subtrees.
  element.style.display =
      element.getAttribute('mk-elide') == 'hidden' ? 'none' : '';
}

function setElidedState(node: ChildNode, state: string) {
  let element;
  if (node.nodeType == Node.ELEMENT_NODE) {
    element = <Element>node;
  } else {
    // Need to wrap text nodes in a span so we can toggle their display.
    element = document.createElement('span');
    element.textContent = node.textContent || '';
    node.replaceWith(element);
  }
  element.setAttribute('mk-elide', state);
}

function toggleElided(e: Event) {
  e.preventDefault();

  let element = e.target as Element;
  while (!element.nextElementSibling ||
         !element.nextElementSibling.hasAttribute('mk-elide')) {
    element = notNull(element.parentElement);
  }

  while (element.nextElementSibling &&
         element.nextElementSibling.hasAttribute('mk-elide')) {
    element = element.nextElementSibling;
    let newState =
        element.getAttribute('mk-elide') == 'visible' ? 'hidden' : 'visible';
    setElidedState(element, newState);
    updateStyling(<HTMLElement>element);
  }
}
