class AutoCompleteEntry extends HTMLElement {
  constructor() {
    super();
    this.name = '';
    this.email = '';
  }
}
window.customElements.define('mt-auto-complete-entry', AutoCompleteEntry);

export class Compose extends HTMLElement {
  constructor(contacts, opt_isMultiline) {
    super();

    this.style.display = 'flex';

    this.contacts_ = contacts;

    this.separator_ = '';

    this.content_ = document.createElement('div');
    this.content_.style.cssText = `
      flex: 1;
      overflow: auto;
      border: 1px solid;
      padding: 8px;
      outline: none;
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

  prepareAutocomplete(_e) {
    throw 'TODO: Make this an abstract method once converted to TypeScript';
  };

  isStillAutoCompleting() {
    throw 'TODO: Make this an abstract method once converted to TypeScript';
    return false;
  };

  updatePlaceholder_() {
    if (this.content_.textContent.length) {
      this.content_.removeAttribute('placeholder');
      this.content_.style.color = '';
    } else {
      this.content_.setAttribute('placeholder', this.placeholder_ || '');
      this.content_.style.color = 'grey';
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
    let range = this.cursor_();
    range.setStart(this.autocompleteRange_.endContainer, this.autocompleteRange_.endOffset);
    return range.toString();
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
      }
      entry.onclick = () => {
        this.submitAutocomplete_(entry);
      }
      entry.style.cssText = `padding: 4px;`;
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

    let rect = this.autocompleteRange_.getBoundingClientRect();
    this.autocompleteContainer_.style.left = `${rect.left}px`;
    this.autocompleteContainer_.style.bottom = `${document.documentElement.offsetHeight - rect.top}px`;
  }

  adjustAutocompleteIndex(adjustment) {
    let newIndex = Math.max(0, Math.min(this.autocompleteIndex_ + adjustment, this.autocompleteContainer_.children.length - 1));
    this.selectAutocompleteItem_(newIndex);
  }

  selectAutocompleteItem_(index) {
    this.autocompleteIndex_ = index;
    for (let i = 0; i < this.autocompleteContainer_.children.length; i++) {
      // TODO: Give this a proper type.
      /** @type {any} */
      let child = this.autocompleteContainer_.children[i];
      child.style.backgroundColor = (i == index) ? '#6677dd' : 'white';
      child.style.color = (i == index) ? 'white' : 'black';
    }
  }

  getAutocompleteCandidates_() {
    let results = [];

    let search = this.autocompleteText_();
    if (!search)
      return results;

    search = search.toLowerCase();

    let hasFullSearch = false;
    for (let contact of this.contacts_) {
      if (contact.name && contact.name.toLowerCase().includes(search)) {
        for (let email of contact.emails) {
          results.push({name: contact.name, email: email});
        }
      } else {
        for (let email of contact.emails) {
          let lowerCaseEmail = email.toLowerCase();
          if (!hasFullSearch && lowerCaseEmail == search)
            hasFullSearch = true;
          if (lowerCaseEmail.split('@')[0].includes(search))
            results.push({name: contact.name, email: email});
        }
      }
    }

    // Include whatever the user is typing in case it's not in their contacts or if
    // the contacts API is down.
    if (!hasFullSearch)
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
    this.autocompleteContainer_.remove()
    this.autocompleteContainer_ = null;
  }

  cancelAutocomplete_() {
    this.autocompleteRange_ = null;
    this.hideAutocompleteMenu_();
  }

  selectedEntry(_selectedItem) {
    throw 'Abstract method not overridden.';
    return null;
  }

  submitAutocomplete_(opt_selectedItem) {
    let selectedItem = opt_selectedItem || this.autocompleteContainer_.children[this.autocompleteIndex_];

    let range = this.cursor_();
    range.setStart(this.autocompleteRange_.startContainer, this.autocompleteRange_.startOffset);
    range.deleteContents();

    let selectedEntry = this.selectedEntry(selectedItem);
    range.insertNode(selectedEntry);

    let separator = document.createTextNode(this.separator_);
    range.collapse();
    range.insertNode(separator);
    window.getSelection().collapse(separator, separator.length);

    this.cancelAutocomplete_();
    this.dispatchEvent(new Event('email-added'));
  }

  getEmails() {
    let links = this.content_.querySelectorAll('a');
    let results = [];
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
    return this.content_.innerHTML;
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
