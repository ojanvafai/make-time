// Rolling hash taken from https://gist.github.com/i-e-b/b892d95ac7c0cf4b70e4.
let MINIMUM_HASH_LENGTH = 10;
let MINIMUM_ELIDE_LENGTH = 100;
let TOGGLER;

export class QuoteElidedMessage {
  constructor(currentMessage, previousMessage) {
    this.computeHashes_(currentMessage);
    if (!previousMessage)
      return;

    this.elideAllMatches_(previousMessage);
    this.expandToNonTextSiblings_();
    this.undoNestedElides_();
    this.insertToggleButtons_();
    this.updateAllStyling_();
  }

  elideAllMatches_(previousMessage) {
    let previousHashes = previousMessage.getQuoteElidedMessage().getHashes();
    for (let entry of this.hashes_) {
      if (previousHashes.has(entry[0])) {
        for (let match of entry[1]) {
          setElidedState(match, 'hidden');
        }
      }
    }
  }

  hasEmptyTextContent_(node) {
    return node && node.nodeType == Node.ELEMENT_NODE && !this.quoteStrippedText_(node);
  }

  expandToNonTextSiblings_() {
    for (let match of this.dom_.querySelectorAll('[mk-elide]')) {
      let previous = match;
      // TODO: Include "XXX wrote" prefixes here as well.
      // TODO: Hash the outerHTML of the element to make sure it has at least
      // a corresponding thing in the previous message. Or maybe just exclude images?
      while (this.hasEmptyTextContent_(previous.previousSibling)) {
        setElidedState(previous.previousSibling, 'hidden');
        previous = previous.previousSibling;
      }

      let next = match;
      while (this.hasEmptyTextContent_(next.nextSibling)) {
        setElidedState(next.nextSibling, 'hidden');
        next = next.nextSibling;
      }
    }
  }

  undoNestedElides_() {
    for (let element of this.dom_.querySelectorAll('[mk-elide]')) {
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

  elidesHaveMinimumLength_(element) {
    let length = 0;
    while (length < MINIMUM_ELIDE_LENGTH && element && element.nodeType == Node.ELEMENT_NODE) {
      if (!element.hasAttribute('mk-elide'))
        return false;
      length += element.textContent.length;
      element = element.nextSibling;
    }
    return length >= MINIMUM_ELIDE_LENGTH;
  }

  removeAdjacentElides_(element) {
    // TODO: move the attribute name into a constant.
    while (element && element.nodeType == Node.ELEMENT_NODE && element.hasAttribute('mk-elide')) {
      element.removeAttribute('mk-elide');
      element = element.nextSibling;
    }
  }

  insertToggleButtons_() {
    for (let match of this.dom_.querySelectorAll('[mk-elide]')) {
      if (!this.isElided_(match.previousSibling)) {
        if (this.elidesHaveMinimumLength_(match)) {
          match.before(this.getToggler_());
        } else {
          this.removeAdjacentElides_(match);
        }
      }
    }
  }

  updateAllStyling_() {
    for (let match of this.dom_.querySelectorAll('[mk-elide]')) {
      updateStyling(match);
    }
  }

  getToggler_() {
    if (!TOGGLER) {
      TOGGLER = document.createElement('div');
      // Gross hack to render centered-ish elipsis without using an image.
      TOGGLER.style.overflow = 'hidden';
      TOGGLER.innerHTML = `<div style="margin-top:-7px"><div class="toggler">...</div></div>`;
    }
    let toggler = TOGGLER.cloneNode(true);
    toggler.querySelector('.toggler').onclick = function(e) {
      toggleElided(e, this);
    };
    return toggler;
  }

  getHashes() {
    if (!this.hashes_)
      throw 'Tried to return hashes before they were computed.';
    return this.hashes_;
  }

  getDom() {
    if (!this.dom_)
      throw 'Tried to return dom before it was generated.';
    return this.dom_;
  }

  computeHashes_(message) {
    // Store diff hashes on the message as a performance optimization since we need to compute once
    // for the current message and once for the previous message == 2x for almost every message.
    this.dom_ = document.createElement('div');
    this.dom_.innerHTML = message;
    let elements = this.dom_.querySelectorAll('*');
    this.hashes_ = new Map();
    for (let element of elements) {
      let text = this.quoteStrippedText_(element);
      if (text.length > MINIMUM_HASH_LENGTH) {
        let list = this.hashes_.get(text);
        if (!list) {
          list = [];
          this.hashes_.set(text, list);
        }
        list.push(element);
      }
    }
  }

  isQuoteCharacter_(char) {
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

  quoteStrippedText_(element) {
    if (!element.strippedText) {
      let nonQuoteIndex = 0;
      let text = element.textContent;
      while (nonQuoteIndex < text.length && this.isQuoteCharacter_(text.charAt(nonQuoteIndex))) {
        nonQuoteIndex++;
      }
      element.strippedText = text.substring(nonQuoteIndex);
    }
    return element.strippedText;
  }

  isElided_(element) {
    return element && element.hasAttribute && element.hasAttribute('mk-elide');
  }
}

function updateStyling(element) {
  // Ideally we'd use clipping instead of display:none so that the toggler doesn't jump around
  // when the contents of the elided region are shown, but for threads with a lot of eliding,
  // display none is considerably faster at recalc and layout since we skip whole subtrees.
  element.style.display = element.getAttribute('mk-elide') == 'hidden' ? 'none' : '';
}

function setElidedState(element, state) {
  element.setAttribute('mk-elide', state);
}

function toggleElided(e, element) {
  e.preventDefault();

  while (!element.nextElementSibling || !element.nextElementSibling.hasAttribute('mk-elide')) {
    element = element.parentNode;
  }

  while (element.nextElementSibling && element.nextElementSibling.hasAttribute('mk-elide')) {
    element = element.nextElementSibling;
    let newState = element.getAttribute('mk-elide') == 'visible' ? 'hidden' : 'visible';
    setElidedState(element, newState);
    updateStyling(element);
  }
}
