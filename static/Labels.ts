import {defined, USER_ID} from './Base.js';
import {gapiFetch} from './Net.js';

export class Labels {
  static addMakeTimePrefix = (labelName: string) => {
    return Labels.MAKE_TIME_PREFIX + '/' + labelName;
  };

  static triagedLabel = (labelName: string) => {
    return `${Labels.TRIAGED_LABEL}/${labelName}`;
  };

  static needsTriageLabel = (labelName: string) => {
    return `${Labels.NEEDS_TRIAGE_LABEL}/${labelName}`;
  };

  static isNeedsTriageLabel = (labelName: string) => {
    return labelName.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/');
  };

  static addQueuedPrefix = (labelName: string) => {
    return Labels.QUEUED_LABEL + '/' + labelName;
  };

  static isQueuedLabel = (labelName: string) => {
    return labelName.startsWith(Labels.QUEUED_LABEL + '/');
  };

  static addPriorityPrefix = (labelName: string) => {
    return Labels.PRIORITY_LABEL + '/' + labelName;
  };

  static isPriorityLabel = (labelName: string) => {
    return labelName.startsWith(Labels.PRIORITY_LABEL + '/');
  };

  static MAKE_TIME_PREFIX = 'mt';
  static FALLBACK_LABEL = 'unfiltered';
  static ARCHIVE_LABEL = 'archive';
  static BLOCKED_SUFFIX = 'blocked';

  static TRIAGED_LABEL = Labels.addMakeTimePrefix('z');
  static NEEDS_TRIAGE_LABEL = Labels.addMakeTimePrefix('tri');
  static QUEUED_LABEL = Labels.addMakeTimePrefix('que');
  static PRIORITY_LABEL = Labels.addMakeTimePrefix('pri');
  static UNPROCESSED_LABEL = Labels.addMakeTimePrefix('unprocessed');

  static PROCESSED_LABEL = Labels.triagedLabel('processed');
  static PROCESSED_ARCHIVE_LABEL = Labels.triagedLabel('archivebyfilter');
  static MUTED_LABEL = Labels.triagedLabel('mute');

  static BLOCKED_LABEL = Labels.addQueuedPrefix(Labels.BLOCKED_SUFFIX);

  static MUST_DO = 'must-do';
  static URGENT = 'urgent';
  static BACKLOG = 'backlog';
  static NEEDS_FILTER = 'needs-filter';

  static MUST_DO_LABEL = Labels.addPriorityPrefix(Labels.MUST_DO);
  static URGENT_LABEL = Labels.addPriorityPrefix(Labels.URGENT);
  static BACKLOG_LABEL = Labels.addPriorityPrefix(Labels.BACKLOG);
  static NEEDS_FILTER_LABEL = Labels.addPriorityPrefix(Labels.NEEDS_FILTER);

  // TODO: These can be undefined if fetch hasn't finished. Make the code
  // robust to that and remove the !'s
  private labelToId_!: Map<string, string>;
  private idToLabel_!: Map<string, string>;
  private needsTriageLabelNames_!: Set<string>;
  private queuedLabelNames_!: Set<string>;
  private priorityLabels_!: Set<string>;

  async fetch() {
    var response = await gapiFetch(
        gapi.client.gmail.users.labels.list, {'userId': USER_ID});
    this.updateLabelLists_(defined(response.result.labels));
  }

  // Make sure do to all the operations below synchronously to avoid exposing
  // an intermediary state to other code that's running.
  updateLabelLists_(labels: gapi.client.gmail.Label[]) {
    this.labelToId_ = new Map();
    this.idToLabel_ = new Map();
    this.needsTriageLabelNames_ = new Set();
    this.queuedLabelNames_ = new Set();
    this.priorityLabels_ = new Set();

    for (let label of labels) {
      this.addLabel_(defined(label.name), defined(label.id));
    }
  }

  addLabel_(name: string, id: string) {
    this.labelToId_.set(name, id);
    this.idToLabel_.set(id, name);
    if (name.startsWith(Labels.PRIORITY_LABEL + '/'))
      this.priorityLabels_.add(name);
    else if (name.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/'))
      this.needsTriageLabelNames_.add(name);
    else if (name.startsWith(Labels.QUEUED_LABEL + '/'))
      this.queuedLabelNames_.add(name);
  }

  async getName(id: string) {
    let name = this.idToLabel_.get(id);

    // A label may have been created since we last fetched the list of labels.
    // Refetch to make sure we have an up to date label list.
    if (!name) {
      await this.fetch();
      name = this.idToLabel_.get(id);
    }

    return name;
  }

  getId(name: string) {
    let id = this.labelToId_.get(name);
    if (id)
      return id;

    // For built-in labels, both the ID and the name are uppercased.
    return defined(this.labelToId_.get(name.toUpperCase()));
  }

  getNeedsTriageLabelNames() {
    return Array.from(this.needsTriageLabelNames_);
  }

  getPriorityLabelNames() {
    return Array.from(this.priorityLabels_);
  }

  getQueuedLabelNames() {
    return Array.from(this.queuedLabelNames_);
  }
}
