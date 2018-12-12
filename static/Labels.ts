import { fetchThreads, USER_ID } from './main.js';

async function gapiFetch(method, requestParams, opt_requestBody) {
  let fetcher = (await import('./Net.js')).gapiFetch;
  return fetcher(method, requestParams, opt_requestBody);
}

interface LabelResource {
  name: string;
  messageListVisibility: string;
  labelListVisibility: string;
  id: string;
  userId: string;
}

export class Labels {
  static isUserLabel = (id) => {
    return id.startsWith('Label_');
  }

  static removeLabelPrefix = (labelName, prefix) => {
    return labelName.replace(new RegExp(`^${prefix}/`), '');
  }

  static addMakeTimePrefix = (labelName) => {
    return Labels.MAKE_TIME_PREFIX + '/' + labelName;
  }

  static removeMakeTimePrefix = (labelName) => {
    return Labels.removeLabelPrefix(labelName, Labels.MAKE_TIME_PREFIX);
  }

  static isMakeTimeLabel = (labelName) => {
    return labelName.startsWith(Labels.MAKE_TIME_PREFIX + '/');
  }

  static triagedLabel = (labelName) => {
    return `${Labels.TRIAGED_LABEL}/${labelName}`;
  }

  static needsTriageLabel = (labelName) => {
    return `${Labels.NEEDS_TRIAGE_LABEL}/${labelName}`;
  }

  static removeNeedsTriagePrefix = (labelName) => {
    return Labels.removeLabelPrefix(labelName, Labels.NEEDS_TRIAGE_LABEL);
  }

  static isNeedsTriageLabel = (labelName) => {
    return labelName.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/');
  }

  static addQueuedPrefix = (labelName) => {
    return Labels.QUEUED_LABEL + "/" + labelName;
  }

  static addPriorityPrefix = (labelName) => {
    return Labels.PRIORITY_LABEL + "/" + labelName;
  }

  static removePriorityPrefix = (labelName) => {
    return Labels.removeLabelPrefix(labelName, Labels.PRIORITY_LABEL);
  }

  static isPriorityLabel = (labelName) => {
    return labelName.startsWith(Labels.PRIORITY_LABEL + '/');
  }

  static addBankruptPrefix = (labelName) => {
    return Labels.BANKRUPT_LABEL + "/" + labelName;
  }

  // TODO: This should be uppercase to match gmail.
  static INBOX_LABEL = 'inbox';
  static MAKE_TIME_PREFIX = 'mt';
  static FALLBACK_LABEL = 'needsfilter';
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
  static NOT_URGENT = 'not-urgent';
  static DELEGATE = 'delegate';

  static SORTED_PRIORITIES = [Labels.MUST_DO, Labels.URGENT, Labels.NOT_URGENT, Labels.DELEGATE];

  static MUST_DO_LABEL = Labels.addPriorityPrefix(Labels.MUST_DO);
  static URGENT_LABEL = Labels.addPriorityPrefix(Labels.URGENT);
  static NOT_URGENT_LABEL = Labels.addPriorityPrefix(Labels.NOT_URGENT);
  static DELEGATE_LABEL = Labels.addPriorityPrefix(Labels.DELEGATE);

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
  private labelToId_!: {};
  private idToLabel_!: {};
  private makeTimeLabelIds_!: Set<string>;
  private makeTimeLabelNames_!: Set<string>;
  private needsTriageLabelNames_!: Set<string>;
  private priorityLabels_!: Set<string>;

  async fetch() {
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    var response = await gapiFetch(gapi.client.gmail.users.labels.list, {
      'userId': USER_ID
    });

    this.labelToId_ = {};
    this.idToLabel_ = {};
    this.makeTimeLabelIds_ = new Set();
    this.makeTimeLabelNames_ = new Set();
    this.needsTriageLabelNames_ = new Set();
    this.priorityLabels_ = new Set();

    for (let label of response.result.labels) {
      if (Labels.isUserLabel(label.id)) {
        let shouldBeHidden = Labels.HIDDEN_LABELS.includes(label.name);
        if (shouldBeHidden !== (label.messageListVisibility == 'hide'))
          label = await this.updateVisibility_(label.name, label.id);
      }
      this.addLabel_(label.name, label.id);
    }
  }

  addLabel_(name, id) {
    this.labelToId_[name] = id;
    this.idToLabel_[id] = name;
    if (Labels.isMakeTimeLabel(name)) {
      this.makeTimeLabelIds_.add(id);
      this.makeTimeLabelNames_.add(name);
      if (name.startsWith(Labels.PRIORITY_LABEL + '/'))
        this.priorityLabels_.add(name);
      else if (name.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/'))
        this.needsTriageLabelNames_.add(name);
    }
  }

  removeLabel_(name) {
    let id = this.labelToId_[name];
    delete this.labelToId_[name];
    delete this.idToLabel_[id];
    this.makeTimeLabelIds_.delete(id);
    this.makeTimeLabelNames_.delete(name);
    this.needsTriageLabelNames_.delete(name);
    this.priorityLabels_.delete(name);
  }

  getName(id) {
    return this.idToLabel_[id];
  }

  isParentLabel(name) {
    let prefix = `${name}/`;
    for (let name in this.labelToId_) {
      if (name.startsWith(prefix))
        return true;
    }
    return false;
  }

  labelResource_(name) {
    let isHidden = Labels.HIDDEN_LABELS.includes(name);
    return <LabelResource> {
      name: name,
      messageListVisibility: isHidden ? 'hide' : 'show',
      labelListVisibility: isHidden ? 'labelHide' : 'labelShow',
    };
  }

  async updateVisibility_(name, id) {
    let resource = this.labelResource_(name);
    resource.id = id;
    resource.userId = USER_ID;
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let response = await gapiFetch(gapi.client.gmail.users.labels.update, resource);
    return response.result;
  }

  async migrateThreads(oldName, newName) {
    let addLabelIds = [this.labelToId_[newName]];
    let removeLabelIds = [this.labelToId_[oldName]];
    await fetchThreads(async thread => {
      await thread.modify(addLabelIds, removeLabelIds, true);
    }, {
      query: `in:${oldName}`,
    });
  }

  async rename(oldName, newName) {
    let id = this.labelToId_[oldName];
    if (id) {
      if (this.labelToId_[newName]) {
        await this.migrateThreads(oldName, newName);
        this.delete(oldName);
      } else {
        let resource = this.labelResource_(newName);
        resource.id = id;
        let body = {
          'userId': USER_ID,
          'id': id,
          'resource': resource,
        }
      // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
      await gapiFetch(gapi.client.gmail.users.labels.update, body);
        this.removeLabel_(oldName);
        this.addLabel_(newName, id);
      }
    }

    // Rename all the nested labels as well.
    // Do sub labels even if the parent label doesn't exist in case previous
    // renames failed partway through.
    let oldPrefix = `${oldName}/`;
    let newPrefix = `${newName}/`;
    for (let name in this.labelToId_) {
      if (name.startsWith(oldPrefix))
        await this.rename(name, name.replace(oldPrefix, newPrefix));
    }
  }

  async delete(name, opt_includeNested?) {
    let id = this.labelToId_[name];
    if (id) {
      // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
      await gapiFetch(gapi.client.gmail.users.labels.delete, {
        'userId': USER_ID,
        'id': id,
      });
      this.removeLabel_(name);
    }

    if (opt_includeNested) {
      let prefix = `${name}/`;
      for (let name in this.labelToId_) {
        if (name.startsWith(prefix))
          await this.delete(name, true);
      }
    }
  }

  async createLabel_(name) {
    let resource = this.labelResource_(name);
    resource.userId = USER_ID;
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let resp = await gapiFetch(gapi.client.gmail.users.labels.create, resource);
    return resp.result;
  }

  async getIds(names) {
    return await Promise.all(names.map(async (name) => await this.getId(name)));
  }

  async getId(labelName) {
    if (this.labelToId_[labelName])
      return this.labelToId_[labelName];

    // For built-in labels, both the ID and the name are uppercased.
    let uppercase = labelName.toUpperCase();
    if (this.labelToId_[uppercase])
      return this.labelToId_[uppercase];

    await this.fetch();
    var parts = labelName.split('/');

    // Create all the parent labels as well as the final label.
    var labelSoFar = '';
    for (var part of parts) {
      var prefix = labelSoFar ? '/' : '';
      labelSoFar += prefix + part;
      // creating a label 409's if the label already exists.
      // Technically we should handle the race if the label
      // gets created in between the start of the create call and this line. Meh.
      if (this.labelToId_[labelSoFar])
        continue;

      var result = await this.createLabel_(labelSoFar);
      this.addLabel_(labelSoFar, result.id);
    }

    return this.labelToId_[labelName];
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

  async getThreadCountForLabels(labelFilter) {
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let batch = gapi.client.newBatch();

    let addedAny = false;
    for (let id in this.idToLabel_) {
      if (labelFilter(this.idToLabel_[id])) {
        addedAny = true;
        // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
        batch.add(gapi.client.gmail.users.labels.get({
          userId: USER_ID,
          id: id,
        }));
      }
    }

    let labelsWithThreads: {name: string, count: number}[] = [];

    // If this is a first run, there may be no labels that match the filter rule
    // and gapi batching throws when you try to await a batch that has no entries.
    if (addedAny) {
      let labelDetails = await batch;
      for (let key in labelDetails.result) {
        let details = labelDetails.result[key].result;
        labelsWithThreads.push({
          name: details.name,
          count: details.threadsTotal,
        });
      }
    }
    return labelsWithThreads;
  }
}
