class Labels {
  async fetch() {
    var response = await gapiFetch(gapi.client.gmail.users.labels.list, {
      'userId': USER_ID
    });

    this.labelToId_ = {};
    this.idToLabel_ = {};
    this.makeTimeLabelIds_ = [];
    this.triagedLabels_ = [];
    this.priorityLabels_ = [];

    for (let label of response.result.labels) {
      this.addLabel_(label.name, label.id);
    }
  }

  addLabel_(name, id) {
    this.labelToId_[name] = id;
    this.idToLabel_[id] = name;
    if (Labels.isMakeTimeLabel(name)) {
      this.makeTimeLabelIds_.push(id);
      if (name.startsWith(Labels.TRIAGED_LABEL + '/'))
        this.triagedLabels_.push(name);
      else if (name.startsWith(Labels.PRIORITY_LABEL + '/'))
        this.priorityLabels_.push(name);
    }
  }

  getName(id) {
    return this.idToLabel_[id];
  }

  async createLabel_(labelName) {
    let resp = await gapiFetch(gapi.client.gmail.users.labels.create, {
      userId: USER_ID,
      name: labelName,
      messageListVisibility: 'show',
      labelListVisibility: 'labelShow',
    });
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
    return this.makeTimeLabelIds_;
  }

  getTriagedLabelNames() {
    return this.triagedLabels_;
  }

  getPriorityLabelNames() {
    return this.priorityLabels_;
  }

  labelResultComparator_(a, b) {
    if (a.name < b.name)
      return -1;
    if (a.name > b.name)
      return 1;
    return 0;
  }

  async getTheadCountForLabels(labelFilter) {
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
    return labelsWithThreads.sort(this.labelResultComparator_);
  }
}

(function() {

function compareSubLabels(a, b) {
  if (a < b)
    return -1;
  if (a > b)
    return 1;
  return 0;
}

Labels.compare = (a, b) => {
  if (a == b)
    return 0;
  if (!a)
    return -1;
  if (!b)
    return 1;

  let aParts = Labels.removeMakeTimePrefix(a).split('/');
  let bParts = Labels.removeMakeTimePrefix(b).split('/');
  let aHasQueue = aParts.length > 2;
  let bHasQueue = bParts.length > 2;

  if (aHasQueue && bHasQueue) {
    let aQueue = aParts[1].toLowerCase();
    let bQueue = bParts[1].toLowerCase();
    let aSubLabel = aParts[2];
    let bSubLabel = bParts[2];
    if (aQueue == bQueue)
      return compareSubLabels(aSubLabel, bSubLabel);
    let aOrder = QUEUE_ORDER[aQueue] || 0;
    let bOrder = QUEUE_ORDER[bQueue] || 0;
    return aOrder - bOrder;
  }

  if (!aHasQueue && bHasQueue)
    return -1;
  if (aHasQueue && !bHasQueue)
    return 1;

  if (a < b)
    return -1;
  if (a > b)
    return 1;
  return 0;
}

function removeLabelPrefix(labelName, prefix) {
  return labelName.replace(new RegExp(`^${prefix}/`), '');
}

Labels.addMakeTimePrefix = (labelName) => {
  return Labels.MAKE_TIME_PREFIX + '/' + labelName;
}

Labels.removeMakeTimePrefix = (labelName) => {
  return removeLabelPrefix(labelName, Labels.MAKE_TIME_PREFIX);
}

Labels.isMakeTimeLabel = (labelName) => {
  return labelName.startsWith(Labels.MAKE_TIME_PREFIX + '/');
}

Labels.triagedLabel = (labelName) => {
  return `${Labels.TRIAGED_LABEL}/${labelName}`;
}

Labels.removeTriagedPrefix = (labelName) => {
  return removeLabelPrefix(labelName, Labels.TRIAGED_LABEL);
}

Labels.needsTriageLabel = (labelName) => {
  return `${Labels.NEEDS_TRIAGE_LABEL}/${labelName}`;
}

Labels.removeNeedsTriagePrefix = (labelName) => {
  return removeLabelPrefix(labelName, Labels.NEEDS_TRIAGE_LABEL);
}

Labels.addQueuedPrefix = (labelName) => {
  return Labels.QUEUED_LABEL + "/" + labelName;
}

Labels.addPriorityPrefix = (labelName) => {
  return Labels.PRIORITY_LABEL + "/" + labelName;
}

Labels.removePriorityPrefix = (labelName) => {
  return removeLabelPrefix(labelName, Labels.PRIORITY_LABEL);
}

Labels.MAKE_TIME_PREFIX = 'maketime';
Labels.FALLBACK_LABEL = 'needsfilter';

Labels.DAILY_QUEUE_PREFIX = 'daily';
Labels.WEEKLY_QUEUE_PREFIX = 'weekly';
Labels.MONTHLY_QUEUE_PREFIX = 'monthly';

let QUEUE_ORDER = {};
QUEUE_ORDER[Labels.DAILY_QUEUE_PREFIX] = 1;
QUEUE_ORDER[Labels.WEEKLY_QUEUE_PREFIX] = 2;
QUEUE_ORDER[Labels.MONTHLY_QUEUE_PREFIX] = 3;

Labels.UNPROCESSED_LABEL = Labels.addMakeTimePrefix('unprocessed');
Labels.TRIAGED_LABEL = Labels.addMakeTimePrefix('triaged');
Labels.NEEDS_TRIAGE_LABEL = Labels.addMakeTimePrefix('needstriage');
Labels.QUEUED_LABEL = Labels.addMakeTimePrefix('queued');
Labels.PRIORITY_LABEL = Labels.addMakeTimePrefix('priority');

Labels.READ_LATER_LABEL = Labels.triagedLabel('tldr');
Labels.NEEDS_REPLY_LABEL = Labels.triagedLabel('needsreply');
Labels.BANKRUPT_LABEL = Labels.triagedLabel('bankrupt');
Labels.MUTED_LABEL = Labels.triagedLabel('supermuted');
Labels.ACTION_ITEM_LABEL = Labels.triagedLabel('actionitem');

Labels.BLOCKED_LABEL = Labels.addQueuedPrefix('blocked');

Labels.MUST_DO_LABEL = Labels.addPriorityPrefix('must-do');
Labels.IMPORTANT_AND_URGENT_LABEL = Labels.addPriorityPrefix('important-and-urgent');
Labels.URGENT_AND_NOT_IMPORTANT_LABEL = Labels.addPriorityPrefix('urgent-and-not-important');
Labels.IMPORTANT_AND_NOT_URGENT_LABEL = Labels.addPriorityPrefix('important-and-not-urgent');

Labels.LABEL_TO_COLOR = {};
Labels.LABEL_TO_COLOR[Labels.MUST_DO_LABEL] = 'red';
Labels.LABEL_TO_COLOR[Labels.IMPORTANT_AND_URGENT_LABEL] = 'red';
Labels.LABEL_TO_COLOR[Labels.URGENT_AND_NOT_IMPORTANT_LABEL] = 'darkolivegreen';
Labels.LABEL_TO_COLOR[Labels.IMPORTANT_AND_NOT_URGENT_LABEL] = 'grey';

})();
