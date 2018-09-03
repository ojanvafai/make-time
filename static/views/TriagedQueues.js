class TriagedQueues extends HTMLElement {
  constructor(allLabels, bestEffortThreads, bestEffortCallback) {
    super();
    this.allLabels_ = allLabels;
    this.bestEffortThreads_ = bestEffortThreads;
    this.bestEffortCallback_ = bestEffortCallback;
  }

  async connectedCallback() {
    this.labelData_ = await this.allLabels_.getTheadCountForLabels((labelName) => {
      return labelName != Labels.MUTED_LABEL && labelName.startsWith(Labels.TRIAGED_LABEL + '/');
    });

    this.render_();
  }

  update() {
    if (this.parentNode)
      this.render_();
  }

  async render_() {
    this.textContent = '';

    if (this.bestEffortThreads_.length) {
      let link = document.createElement('a');
      link.className = 'label-button';
      link.textContent = `Triage ${this.bestEffortThreads_.length} best effort threads`;
      link.onclick = this.bestEffortCallback_;
      this.append(link);
    }

    for (let label of this.labelData_) {
      let link = document.createElement('a');
      link.className = 'label-button';
      link.href = `https://mail.google.com/mail/#label/${label.name}`;
      link.textContent = `${Labels.removeTriagedPrefix(label.name)} (${label.count})`;
      this.append(link);
    }
  }
}

window.customElements.define('mt-triaged-queues', TriagedQueues);
