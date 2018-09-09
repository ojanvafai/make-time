class ThreadRowGroup extends HTMLElement {
  constructor(queue) {
    super();
    this.style.display = 'block';

    this.queue_ = queue;

    let queueSpan = document.createElement('b')
    queueSpan.append(queue);

    let queueContainer = document.createElement('div');
    queueContainer.append(
      'Select ',
      this.createSelector_('all', this.selectAll_),
      this.createSelector_('none', this.selectNone_),
      `in `,
      queueSpan);

    queueContainer.style.marginRight = '6px';

    this.rowContainer_ = document.createElement('div');
    this.append(queueContainer, this.rowContainer_);
  }

  hasRows() {
    return !!this.rowContainer_.children.length;
  }

  push(thread) {
    this.rowContainer_.append(new ThreadRow(thread));
  }

  createSelector_(textContent, callback) {
    let selector = document.createElement('span');
    selector.textContent = textContent;
    selector.style.textDecoration = 'underline';
    selector.style.marginRight = '4px';
    selector.onclick = callback.bind(this);
    return selector;
  }

  selectAll_() {
    this.selectRows_(true);
  }

  selectNone_() {
    this.selectRows_(false);
  }

  selectRows_(value) {
    for (let child of this.rowContainer_.children) {
      child.checked = value;
    }
  }

  get queue() {
    return this.queue_;
  }
}
window.customElements.define('mt-thread-row-group', ThreadRowGroup);

