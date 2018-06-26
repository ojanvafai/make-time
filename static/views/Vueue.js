class Vueue extends HTMLElement {
  constructor(threads, cleanupDelegate) {
    super();
    this.style.display = 'block';

    this.threads_ = threads;
    this.recentlyProcessed_ = new ThreadList();
    this.cleanupDelegate_ = cleanupDelegate;

    // I will never truly love javascript
    this.handleDone_ = this.handleDone_.bind(this);
  }

  async dispatchShortcut(key) {
  }

  async connectedCallback() {
    this.initialThreadsView_ = document.createElement('div');

    let currentRowGroup;
    for (let thread of this.threads_) {
      let queue = await thread.getDisplayableQueue();

      if (!currentRowGroup || queue != currentRowGroup.queue) {
        currentRowGroup = new VueueRowGroup_(queue);
        this.initialThreadsView_.append(currentRowGroup);
      }

      currentRowGroup.push(thread);
    }

    this.append(this.initialThreadsView_);

    let footer = document.createElement('div');
    footer.className = 'footer';
    this.doneBtn_ = document.createElement('button');
    this.doneBtn_.innerHTML = "Archive selected and begin triage";
    this.doneBtn_.addEventListener('click', this.handleDone_);
    footer.append(this.doneBtn_);

    this.append(footer);
  }

  handleDone_ () {
    let selectedThreads = [];
    let unselectedThreads = [];
    for (let child of this.initialThreadsView_.querySelectorAll('mt-vueue-row')) {
      let destination = child.checked ? selectedThreads : unselectedThreads;
      destination.push(child.thread);
    }

    let unprocessedThread = this.recentlyProcessed_.pop();
    while (unprocessedThread) {
      unselectedThreads.push(unprocessedThread);
      unprocessedThread = this.recentlyProcessed_.pop();
    }

    this.cleanupDelegate_(unselectedThreads, selectedThreads);
  }

  async push(thread) {
    this.recentlyProcessed_.push(thread);
  }

  async updateRecentlyProcessed_() {
    // TODO :D
  }
}
window.customElements.define('mt-vueue', Vueue);

class VueueRowGroup_ extends HTMLElement {
  constructor(queue) {
    super();
    this.style.display = 'block';

    this.queue_ = queue;

    // TODO: Make custom elements for queue container and row container so they
    // can be independently styled instead of using inline styling.
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

  push(thread) {
    this.rowContainer_.append(new VueueRow_(thread));
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
window.customElements.define('mt-vueue-row-group', VueueRowGroup_);

class VueueRow_ extends HTMLElement {
  constructor(thread) {
    super();
    this.style.display = 'flex';

    this.thread_ = thread;

    this.thread_.getSubject()
    .then(subject => {
      let label = document.createElement('label');

      this.checkBox_ = document.createElement('input');
      this.checkBox_.type = 'checkbox';
      label.append(this.checkBox_);
      let snippet = document.createElement('span');
      snippet.style.color = '#666';
      snippet.textContent = ` - ${this.thread_.snippet}`;
      label.append(subject, snippet);

      this.appendChild(label);
    });
  }

  get checked() {
    return this.checkBox_.checked;
  }

  set checked(value) {
    this.checkBox_.checked = value;
  }

  get thread() {
    return this.thread_;
  }
}
window.customElements.define('mt-vueue-row', VueueRow_);