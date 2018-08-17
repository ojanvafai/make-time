class Compose extends HTMLElement {
  constructor(contacts) {
    super();

    this.style.display = 'flex';

    this.contacts_ = contacts;
    this.content_ = document.createElement('div');
    this.content_.style.cssText = `
      flex: 1;
      white-space: pre-wrap;
      overflow: hidden;
      border: 1px solid;
      padding: 8px;
    `;
    this.content_.contentEditable = 'plaintext-only';
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

        if (this.updateIsAutocompleting_())
          this.submitAutocomplete_();
        else
          this.dispatchEvent(new Event('submit'));

        e.preventDefault();
        return;

      case 'ArrowLeft':
      case 'ArrowRight':
        this.cancelAutocomplete_();
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
      } else if (e.data == '+') {
        this.prepareAutocomplete_();
      }
      this.updatePlaceholder_();
    });
  }

  updatePlaceholder_() {
    if (this.content_.textContent.length) {
      this.content_.removeAttribute('placeholder');
      this.content_.style.color = '';
    } else {
      this.content_.setAttribute('placeholder', this.placeholder_);
      this.content_.style.color = 'grey';
    }
  }

  updateIsAutocompleting_() {
    if (this.autocompleteRange_ && this.autocompleteRange_.toString() == '+')
      return true;
    this.cancelAutocomplete_();
    return false;
  }

  cursor_() {
    return window.getSelection().getRangeAt(0).cloneRange();
  }

  prepareAutocomplete_() {
    // TODO: Only start auto complete at start of line or after a whitespace
    this.autocompleteRange_ = this.cursor_();
    this.autocompleteRange_.setStart(this.autocompleteRange_.startContainer, this.autocompleteRange_.startOffset - 1);
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

    let candidates = this.getAutocompleteCandidates_();
    if (!candidates.length) {
      this.hideAutocompleteMenu_();
      return;
    }

    this.autocompleteContainer_.size = candidates.length;
    this.autocompleteContainer_.textContent = '';
    for (let candidate of candidates) {
      let entry = document.createElement('div');
      // Prevent clicking on the menu losing cursor position.
      entry.onmousedown = (e) => {
        e.preventDefault();
      }
      entry.onclick = (e) => {
        this.submitAutocomplete_(entry);
      }
      entry.style.cssText = `padding: 4px;`;
      let text = '';
      if (candidate.name)
        text += `${candidate.name}: `;
      text += candidate.email;
      entry.textContent = text
      entry.email = candidate.email;
      entry.name = candidate.name;
      this.autocompleteContainer_.append(entry);
    }

    this.selectAutocompleteItem_(0);

    let rect = this.autocompleteRange_.getBoundingClientRect();
    this.autocompleteContainer_.style.left = `${rect.left}px`;
    this.autocompleteContainer_.style.bottom = `${document.body.offsetHeight - rect.top}px`;
  }

  adjustAutocompleteIndex(adjustment) {
    let newIndex = Math.max(0, Math.min(this.autocompleteIndex_ + adjustment, this.autocompleteContainer_.children.length - 1));
    this.selectAutocompleteItem_(newIndex);
  }

  selectAutocompleteItem_(index) {
    this.autocompleteIndex_ = index;
    for (let i = 0; i < this.autocompleteContainer_.children.length; i++) {
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

    for (let contact of this.contacts_) {
      if (contact.name && contact.name.toLowerCase().includes(search)) {
        for (let email of contact.emails) {
          results.push({name: contact.name, email: email});
        }
      } else {
        for (let email of contact.emails) {
          if (email.split('@')[0].toLowerCase().includes(search))
            results.push({name: contact.name, email: email});
        }
      }
    }

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

  submitAutocomplete_(opt_selectedItem, opt_savedCursor) {
    let selectedItem = opt_selectedItem || this.autocompleteContainer_.children[this.autocompleteIndex_];

    let range = this.cursor_();
    range.setStart(this.autocompleteRange_.startContainer, this.autocompleteRange_.startOffset);
    range.deleteContents();

    let link = document.createElement('a');
    link.href = `mailto:${selectedItem.email}`;
    link.textContent = `+${selectedItem.name || selectedItem.email}`;
    link.contentEditable = false;
    range.insertNode(link);

    let space = document.createTextNode(' ');
    range.collapse();
    range.insertNode(space);
    window.getSelection().collapse(space, space.length);

    this.cancelAutocomplete_();
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
