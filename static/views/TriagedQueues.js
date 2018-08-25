class TriagedQueues extends HTMLElement {
  constructor(allLabels) {
    super();
    this.allLabels_ = allLabels;
    this.render_();
  }

  async render_() {
    let labels = await this.allLabels_.getTheadCountForLabels((labelName) => {
      return labelName != Labels.MUTED_LABEL && labelName.startsWith(Labels.TRIAGED_LABEL + '/');
    });

    for (let label of labels) {
      let link = document.createElement('a');
      link.className = 'label-button';
      link.href = `https://mail.google.com/mail/#label/${label.name}`;
      link.textContent = `${Labels.removeTriagedPrefix(label.name)} (${label.count})`;
      this.append(link);
    }
  }
}

window.customElements.define('mt-triaged-queues', TriagedQueues);
