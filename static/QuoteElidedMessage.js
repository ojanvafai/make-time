// Rolling hash taken from https://gist.github.com/i-e-b/b892d95ac7c0cf4b70e4.
'use strict';

// TODO: Use ES Modules!
(function() {

let MINIMUM_LENGTH = 100;
let TOGGLER;

class QuoteElidedMessage {
  constructor(currentMessage, previousMessage) {
    this.computeHashes_(currentMessage);
    if (!previousMessage)
      return;

    this.elideAllMatches_(previousMessage);
    this.expandToNonTextSiblings_();
    this.undoNestedElides_();
    this.insertToggleButtons_();
  }

  elideAllMatches_(previousMessage) {
    let previousHashes = previousMessage.getQuoteElidedMessage().getHashes();
    let matches = new Set();
    for (let entry of this.hashes_) {
      if (previousHashes.has(entry[0])) {
        let match = entry[1];
        matches.add(match);
        QuoteElidedMessage.setElidedState_(match, 'hidden');
      }
    }
  }

  expandToNonTextSiblings_() {
    for (let match of this.dom_.querySelectorAll('[mk-elide]')) {
      let previous = match;
      // TODO: Include "XXX wrote" prefixes here as well.
      // TODO: Hash the outerHTML of the element to make sure it has at least
      // a corresponding thing in the previous message. Or maybe just exclude images?
      while (previous.previousSibling && !this.quoteStrippedText_(previous.previousSibling)) {
        QuoteElidedMessage.setElidedState_(previous.previousSibling, 'hidden');
        previous = previous.previousSibling;
      }

      let next = match;
      while (next.nextSibling && !this.quoteStrippedText_(next.nextSibling)) {
        QuoteElidedMessage.setElidedState_(next.nextSibling, 'hidden');
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

  insertToggleButtons_() {
    for (let match of this.dom_.querySelectorAll('[mk-elide]')) {
      QuoteElidedMessage.updateStyling_(match);
      if (!this.isElided_(match.previousSibling))
        match.before(this.getToggler_());
    }
  }

  getToggler_() {
    if (!TOGGLER) {
      TOGGLER = document.createElement('div');
      // Gross hack to render centered-ish elipsis without using an image.
      TOGGLER.style.overflow = 'hidden';
      TOGGLER.innerHTML = `<div style="margin-top:-7px"><div class="toggler" onclick="QuoteElidedMessage.toggleElided(event, this)">...</div></div>`;
    }
    return TOGGLER.cloneNode(true);
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
      if (text.length > MINIMUM_LENGTH)
        this.hashes_.set(text, element);
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

QuoteElidedMessage.updateStyling_ = (element) => {
  // Ideally we'd use clipping instead of display:none so that the toggler doesn't jump around
  // when the contents of the elided region are shown, but for threads with a lot of eliding,
  // display none is considerably faster at recalc and layout since we skip whole subtrees.
  element.style.display = element.getAttribute('mk-elide') == 'hidden' ? 'none' : '';
}

QuoteElidedMessage.setElidedState_ = (element, state) => {
  element.setAttribute('mk-elide', state);
}

QuoteElidedMessage.toggleElided = (e, element) => {
  e.preventDefault();

  while (!element.nextElementSibling || !element.nextElementSibling.hasAttribute('mk-elide')) {
    element = element.parentNode;
  }

  while (element.nextElementSibling && element.nextElementSibling.hasAttribute('mk-elide')) {
    element = element.nextElementSibling;
    let newState = element.getAttribute('mk-elide') == 'visible' ? 'hidden' : 'visible';
    QuoteElidedMessage.setElidedState_(element, newState);
    QuoteElidedMessage.updateStyling_(element);
  }
}

window.QuoteElidedMessage = QuoteElidedMessage;
})();
