import { gapiFetch } from './Net.js';
import { USER_ID } from './main.js';

export class Labels {
  async fetch() {
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
    return {
      name: name,
      messageListVisibility: isHidden ? 'hide' : 'show',
      labelListVisibility: isHidden ? 'labelHide' : 'labelShow',
    };
  }

  async updateVisibility(name) {
    let id = this.labelToId_[name];
    if (!id)
      return;

    let resource = this.labelResource_(name);
    resource.id = id;
    resource.userId = USER_ID;
    await gapiFetch(gapi.client.gmail.users.labels.update, resource);
  }

  async rename(oldName, newName) {
    let id = this.labelToId_[oldName];
    if (id) {
      if (this.labelToId_[newName]) {
        Error.log(`Can't rename ${oldName} to ${newName} because both labels already exist.`);
      } else {
        let resource = this.labelResource_(newName);
        resource.id = id;
        let body = {
          'userId': USER_ID,
          'id': id,
          'resource': resource,
        }
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

  async delete(name, opt_includeNested) {
    let id = this.labelToId_[name];
    if (id) {
    console.log(name);
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
    let batch = gapi.client.newBatch();

    let addedAny = false;
    for (let id in this.idToLabel_) {
      if (labelFilter(this.idToLabel_[id])) {
        addedAny = true;
        batch.add(gapi.client.gmail.users.labels.get({
          userId: USER_ID,
          id: id,
        }));
      }
    }

    let labelsWithThreads = [];

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

Labels.removeLabelPrefix = (labelName, prefix) => {
  return labelName.replace(new RegExp(`^${prefix}/`), '');
}

Labels.addMakeTimePrefix = (labelName) => {
  return Labels.MAKE_TIME_PREFIX + '/' + labelName;
}

Labels.removeMakeTimePrefix = (labelName) => {
  return Labels.removeLabelPrefix(labelName, Labels.MAKE_TIME_PREFIX);
}

Labels.isMakeTimeLabel = (labelName) => {
  return labelName.startsWith(Labels.MAKE_TIME_PREFIX + '/');
}

Labels.triagedLabel = (labelName) => {
  return `${Labels.TRIAGED_LABEL}/${labelName}`;
}

Labels.needsTriageLabel = (labelName) => {
  return `${Labels.NEEDS_TRIAGE_LABEL}/${labelName}`;
}

Labels.removeNeedsTriagePrefix = (labelName) => {
  return Labels.removeLabelPrefix(labelName, Labels.NEEDS_TRIAGE_LABEL);
}

Labels.isNeedsTriageLabel = (labelName) => {
  return labelName.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/');
}

Labels.addQueuedPrefix = (labelName) => {
  return Labels.QUEUED_LABEL + "/" + labelName;
}

Labels.addPriorityPrefix = (labelName) => {
  return Labels.PRIORITY_LABEL + "/" + labelName;
}

Labels.removePriorityPrefix = (labelName) => {
  return Labels.removeLabelPrefix(labelName, Labels.PRIORITY_LABEL);
}

Labels.isPriorityLabel = (labelName) => {
  return labelName.startsWith(Labels.PRIORITY_LABEL + '/');
}

Labels.addBankruptPrefix = (labelName) => {
  return Labels.BANKRUPT_LABEL + "/" + labelName;
}

// TODO: This should be uppercase to match gmail.
Labels.INBOX_LABEL = 'inbox';
Labels.MAKE_TIME_PREFIX = 'mt';
Labels.FALLBACK_LABEL = 'needsfilter';
Labels.ARCHIVE_LABEL = 'archive';
Labels.BLOCKED_SUFFIX = 'blocked';

Labels.TRIAGED_LABEL = Labels.addMakeTimePrefix('z');
Labels.NEEDS_TRIAGE_LABEL = Labels.addMakeTimePrefix('tri');
Labels.QUEUED_LABEL = Labels.addMakeTimePrefix('que');
Labels.PRIORITY_LABEL = Labels.addMakeTimePrefix('pri');
Labels.UNPROCESSED_LABEL = Labels.addMakeTimePrefix('unprocessed');

Labels.BANKRUPT_LABEL = Labels.triagedLabel('bankrupt');
Labels.PROCESSED_LABEL = Labels.triagedLabel('processed');
Labels.PROCESSED_ARCHIVE_LABEL = Labels.triagedLabel('archivebyfilter');
Labels.MUTED_LABEL = Labels.triagedLabel('mute');

Labels.BLOCKED_LABEL = Labels.addQueuedPrefix(Labels.BLOCKED_SUFFIX);

Labels.MUST_DO = 'must-do';
Labels.URGENT = 'urgent';
Labels.NOT_URGENT = 'not-urgent';
Labels.DELEGATE = 'delegate';

Labels.SORTED_PRIORITIES = [Labels.MUST_DO, Labels.URGENT, Labels.NOT_URGENT, Labels.DELEGATE];

Labels.MUST_DO_LABEL = Labels.addPriorityPrefix(Labels.MUST_DO);
Labels.URGENT_LABEL = Labels.addPriorityPrefix(Labels.URGENT);
Labels.NOT_URGENT_LABEL = Labels.addPriorityPrefix(Labels.NOT_URGENT);
Labels.DELEGATE_LABEL = Labels.addPriorityPrefix(Labels.DELEGATE);

Labels.HIDDEN_LABELS = [
  Labels.UNPROCESSED_LABEL,
  Labels.TRIAGED_LABEL,
  Labels.BANKRUPT_LABEL,
  Labels.PROCESSED_LABEL,
  Labels.PROCESSED_ARCHIVE_LABEL,
  Labels.MUTED_LABEL,
];

// TODO: Delete these one all users have migrated.
Labels.OLD_MAKE_TIME_PREFIX = 'maketime';
Labels.OLD_TRIAGED_LABEL = Labels.addMakeTimePrefix('triaged');
Labels.OLD_PRIORITY_LABEL = Labels.addMakeTimePrefix('priority');
Labels.OLD_NEEDS_TRIAGE_LABEL = Labels.addMakeTimePrefix('needstriage');
Labels.OLD_MUTED_LABEL = Labels.triagedLabel('supermuted');
Labels.OLD_PROCESSED_LABEL = Labels.addMakeTimePrefix('processed');
Labels.OLD_QUEUED_LABEL = Labels.addMakeTimePrefix('queued');
Labels.ACTION_ITEM_LABEL = Labels.triagedLabel('actionitem');
Labels.DAILY = Labels.needsTriageLabel('daily');
Labels.WEEKLY = Labels.needsTriageLabel('weekly');
Labels.MONTHLY = Labels.needsTriageLabel('monthly');
