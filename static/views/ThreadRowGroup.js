class ThreadRowGroup extends HTMLElement {
  constructor(queue) {
    super();
    this.style.display = 'block';

    this.queue_ = queue;

    let queueContainer = document.createElement('span')
    queueContainer.style.cssText = `
      font-weight: bold;
      font-size: 18px;
    `;
    queueContainer.append(queue);

    let header = document.createElement('div');
    header.append(
      queueContainer,
      ' select ',
      this.createSelector_('all', this.selectAll_),
      this.createSelector_('none', this.selectNone_)
    );

    header.style.cssText = `
      margin-left: 5px;
      padding-top: 10px;
    `;

    this.rowContainer_ = document.createElement('div');
    this.append(header, this.rowContainer_);
  }

  hasRows() {
    return !!this.rowContainer_.children.length;
  }

  push(row, opt_nextSibling) {
    if (opt_nextSibling && opt_nextSibling.parentNode == this.rowContainer_)
      opt_nextSibling.before(row);
    else
      this.rowContainer_.append(row);
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

