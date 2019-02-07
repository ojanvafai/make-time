import {AsyncOnce} from './AsyncOnce.js';
import {defined, USER_ID} from './Base.js';
import {gapiFetch} from './Net.js';

interface LabelResource {
  name: string;
  messageListVisibility: string;
  labelListVisibility: string;
  id: string;
  userId: string;
}

let labelFetchers_: Map<string, AsyncOnce<gapi.client.gmail.Label>> = new Map();

export class Labels {
  static isUserLabel = (id: string) => {
    return id.startsWith('Label_');
  };

  static removeLabelPrefix = (labelName: string, prefix: string) => {
    return labelName.replace(new RegExp(`^${prefix}/`), '');
  };

  static addMakeTimePrefix = (labelName: string) => {
    return Labels.MAKE_TIME_PREFIX + '/' + labelName;
  };

  static removeMakeTimePrefix = (labelName: string) => {
    return Labels.removeLabelPrefix(labelName, Labels.MAKE_TIME_PREFIX);
  };

  static isMakeTimeLabel = (labelName: string) => {
    return labelName.startsWith(Labels.MAKE_TIME_PREFIX + '/');
  };

  static triagedLabel = (labelName: string) => {
    return `${Labels.TRIAGED_LABEL}/${labelName}`;
  };

  static needsTriageLabel = (labelName: string) => {
    return `${Labels.NEEDS_TRIAGE_LABEL}/${labelName}`;
  };

  static removeNeedsTriagePrefix = (labelName: string) => {
    return Labels.removeLabelPrefix(labelName, Labels.NEEDS_TRIAGE_LABEL);
  };

  static isNeedsTriageLabel = (labelName: string) => {
    return labelName.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/');
  };

  static addQueuedPrefix = (labelName: string) => {
    return Labels.QUEUED_LABEL + '/' + labelName;
  };

  static addPriorityPrefix = (labelName: string) => {
    return Labels.PRIORITY_LABEL + '/' + labelName;
  };

  static removePriorityPrefix = (labelName: string) => {
    return Labels.removeLabelPrefix(labelName, Labels.PRIORITY_LABEL);
  };

  static isPriorityLabel = (labelName: string) => {
    return labelName.startsWith(Labels.PRIORITY_LABEL + '/');
  };

  static addBankruptPrefix = (labelName: string) => {
    return Labels.BANKRUPT_LABEL + '/' + labelName;
  };

  // TODO: This should be uppercase to match gmail.
  static INBOX_LABEL = 'inbox';
  static MAKE_TIME_PREFIX = 'mt';
  static FALLBACK_LABEL = 'unfiltered';
  static ARCHIVE_LABEL = 'archive';
  static BLOCKED_SUFFIX = 'blocked';

  static TRIAGED_LABEL = Labels.addMakeTimePrefix('z');
  static NEEDS_TRIAGE_LABEL = Labels.addMakeTimePrefix('tri');
  static QUEUED_LABEL = Labels.addMakeTimePrefix('que');
  static PRIORITY_LABEL = Labels.addMakeTimePrefix('pri');
  static UNPROCESSED_LABEL = Labels.addMakeTimePrefix('unprocessed');

  static BANKRUPT_LABEL = Labels.triagedLabel('bankrupt');
  static PROCESSED_LABEL = Labels.triagedLabel('processed');
  static PROCESSED_ARCHIVE_LABEL = Labels.triagedLabel('archivebyfilter');
  static MUTED_LABEL = Labels.triagedLabel('mute');

  static BLOCKED_LABEL = Labels.addQueuedPrefix(Labels.BLOCKED_SUFFIX);

  static MUST_DO = 'must-do';
  static URGENT = 'urgent';
  static BACKLOG = 'backlog';
  static NEEDS_FILTER = 'needs-filter';

  static SORTED_PRIORITIES =
      [Labels.NEEDS_FILTER, Labels.MUST_DO, Labels.URGENT, Labels.BACKLOG];

  static MUST_DO_LABEL = Labels.addPriorityPrefix(Labels.MUST_DO);
  static URGENT_LABEL = Labels.addPriorityPrefix(Labels.URGENT);
  static BACKLOG_LABEL = Labels.addPriorityPrefix(Labels.BACKLOG);
  static NEEDS_FILTER_LABEL = Labels.addPriorityPrefix(Labels.NEEDS_FILTER);

  static HIDDEN_LABELS = [
    Labels.UNPROCESSED_LABEL,
    Labels.TRIAGED_LABEL,
    Labels.BANKRUPT_LABEL,
    Labels.PROCESSED_LABEL,
    Labels.PROCESSED_ARCHIVE_LABEL,
    Labels.MUTED_LABEL,
  ];

  // TODO: Delete these one all users have migrated.
  static OLD_MAKE_TIME_PREFIX = 'maketime';
  static OLD_TRIAGED_LABEL = Labels.addMakeTimePrefix('triaged');
  static OLD_PRIORITY_LABEL = Labels.addMakeTimePrefix('priority');
  static OLD_NEEDS_TRIAGE_LABEL = Labels.addMakeTimePrefix('needstriage');
  static OLD_MUTED_LABEL = Labels.triagedLabel('supermuted');
  static OLD_PROCESSED_LABEL = Labels.addMakeTimePrefix('processed');
  static OLD_QUEUED_LABEL = Labels.addMakeTimePrefix('queued');

  // TODO: These can be undefined if fetch hasn't finished. Make the code
  // robust to that and remove the !'s
  private labelToId_!: Map<string, string>;
  private idToLabel_!: Map<string, string>;
  private makeTimeLabelIds_!: Set<string>;
  private makeTimeLabelNames_!: Set<string>;
  private needsTriageLabelNames_!: Set<string>;
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
    this.makeTimeLabelIds_ = new Set();
    this.makeTimeLabelNames_ = new Set();
    this.needsTriageLabelNames_ = new Set();
    this.priorityLabels_ = new Set();

    for (let label of labels) {
      this.addLabel_(defined(label.name), defined(label.id));
    }
  }

  addLabel_(name: string, id: string) {
    this.labelToId_.set(name, id);
    this.idToLabel_.set(id, name);
    if (Labels.isMakeTimeLabel(name)) {
      this.makeTimeLabelIds_.add(id);
      this.makeTimeLabelNames_.add(name);
      if (name.startsWith(Labels.PRIORITY_LABEL + '/'))
        this.priorityLabels_.add(name);
      else if (name.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/'))
        this.needsTriageLabelNames_.add(name);
    }
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

  labelResource_(name: string) {
    let isHidden = Labels.HIDDEN_LABELS.includes(name);
    return <LabelResource>{
      name: name,
      messageListVisibility: isHidden ? 'hide' : 'show',
      labelListVisibility: isHidden ? 'labelHide' : 'labelShow',
    };
  }

  async createLabel_(name: string) {
    // createLabel_ can be called while an existing createLabel_ network request
    // for that label is in progress. Ensure that it doesn't do another network
    // request since gmail will return an error for trying to create a label
    // that already exists.
    let fetcher = labelFetchers_.get(name);
    if (!fetcher) {
      fetcher = new AsyncOnce<gapi.client.gmail.Label>(async () => {
        let resource = this.labelResource_(name);
        resource.userId = USER_ID;
        let resp =
            await gapiFetch(gapi.client.gmail.users.labels.create, resource);
        return resp.result;
      });
      labelFetchers_.set(name, fetcher);
    }
    return await fetcher.do();
  }

  async getId(name: string): Promise<string> {
    let id = this.labelToId_.get(name);
    if (id)
      return id;

    // For built-in labels, both the ID and the name are uppercased.
    id = this.labelToId_.get(name.toUpperCase());
    if (id)
      return id;

    await this.fetch();
    var parts = name.split('/');

    // Create all the parent labels as well as the final label.
    var labelSoFar = '';
    for (var part of parts) {
      var prefix = labelSoFar ? '/' : '';
      labelSoFar += prefix + part;
      // creating a label 409's if the label already exists.
      // Technically we should handle the race if the label
      // gets created in between the start of the create call and this line.
      // Meh.
      if (this.labelToId_.get(labelSoFar))
        continue;

      var result = await this.createLabel_(labelSoFar);
      this.addLabel_(labelSoFar, defined(result.id));
    }

    id = this.labelToId_.get(name);
    if (!id)
      throw `Something went wrong creating label: ${name}`;
    return id;
  }

  getMakeTimeLabelIds() {
    return Array.from(this.makeTimeLabelIds_);
  }

  getMakeTimeLabelNames() {
    return Array.from(this.makeTimeLabelNames_);
  }

  getNeedsTriageLabelNames() {
    return Array.from(this.needsTriageLabelNames_);
  }

  getPriorityLabelNames() {
    return Array.from(this.priorityLabels_);
  }
}
