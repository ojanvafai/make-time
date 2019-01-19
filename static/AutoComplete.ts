import {Contacts} from './Contacts.js';

export class EntrySelectedEvent extends Event {
  static NAME = 'auto-complete-submit';

  constructor(public entry: AutoCompleteEntry) {
    super(EntrySelectedEvent.NAME);
  }
}

export class AutoCompleteEntry extends HTMLElement {
  name: string;
  address: string;

  constructor() {
    super();
    this.name = '';
    this.address = '';
  }
}
window.customElements.define('mt-auto-complete-entry', AutoCompleteEntry);

export class AutoComplete extends HTMLElement {
  private index_: number;

  constructor(private contacts_: Contacts) {
    super();
    // TODO: Fix box shadow to respect whether the menu is above or below.
    this.style.cssText = `
      background-color: white;
      position: fixed;
      border: 1px solid;
      box-shadow: 2px -2px 10px 1px lightgrey;
    `;
    this.index_ = 0;
  }

  getCandidates(search: string) {
    let results: {name: string, address: string}[] = [];

    if (!search)
      return results;

    search = search.toLowerCase();

    for (let contact of this.contacts_.getAll()) {
      if (contact.name && contact.name.toLowerCase().includes(search)) {
        for (let address of contact.emails) {
          results.push({name: contact.name, address: address});
        }
      } else {
        for (let address of contact.emails) {
          if (address.includes(search))
            results.push({name: contact.name, address: address});
        }
      }
    }

    // Include whatever the user is typing in case it's not in their contacts or
    // if the contacts API is down.
    results.push({name: '', address: search});

    // TODO: Sort the results to put +foo address after the main ones.
    // Prefer things that start with the search text over substring matching.
    // Sort by usage?
    results = results.splice(0, 4);
    return results;
  }

  render(search: string) {
    if (this.contacts_.getAll().length)
      this.classList.remove('no-contacts');
    else
      this.classList.add('no-contacts');

    let candidates = this.getCandidates(search);

    this.textContent = '';
    for (let candidate of candidates) {
      let entry = new AutoCompleteEntry();
      // Prevent clicking on the menu losing cursor position.
      entry.onmousedown = (e) => {
        e.preventDefault();
      };
      entry.onclick = () => {
        this.dispatchEvent(new EntrySelectedEvent(entry));
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
      text += candidate.address;
      entry.textContent = text
      entry.address = candidate.address;
      this.append(entry);
    }

    this.selectAutocompleteItem_(0);

    return candidates;
  }

  clear() {
    this.textContent = '';
  }

  selected() {
    return <AutoCompleteEntry>this.children[this.index_];
  }

  adjustIndex(adjustment: number) {
    let newIndex = Math.max(
        0, Math.min(this.index_ + adjustment, this.children.length - 1));
    this.selectAutocompleteItem_(newIndex);
  }

  selectAutocompleteItem_(index: number) {
    this.index_ = index;
    for (let i = 0; i < this.children.length; i++) {
      let child = <AutoCompleteEntry>this.children[i];
      child.style.backgroundColor = (i == index) ? '#6677dd' : 'white';
      child.style.color = (i == index) ? 'white' : 'black';
    }
  }
}
window.customElements.define('mt-auto-complete', AutoComplete);
