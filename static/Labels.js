class Labels {
  async fetch() {
    var response = await gapiFetch(gapi.client.gmail.users.labels.list, {
      'userId': USER_ID
    });

    this.labelToId_ = {};
    this.idToLabel_ = {};
    this.makeTimeLabelIds_ = [];
    this.triagedLabels_ = [];

    for (let label of response.result.labels) {
      this.labelToId_[label.name] = label.id;
      this.idToLabel_[label.id] = label.name;
      if (Labels.isMakeTimeLabel(label.name)) {
        this.makeTimeLabelIds_.push(label.id);
        if (label.name.startsWith(Labels.TRIAGED_LABEL + '/'))
          this.triagedLabels_.push(label.name);
      }
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
      var id = result.id;
      this.labelToId_[labelSoFar] = id;
      this.idToLabel_[id] = labelSoFar;
    }

    return this.labelToId_[labelName];
  }

  getMakeTimeLabelIds() {
    return this.makeTimeLabelIds_;
  }

  getTriagedLabelNames() {
    return this.triagedLabels_;
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

let queueOrder = {
  daily: 1,
  weekly: 2,
  monthly: 3,
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
    let aOrder = queueOrder[aQueue] || 0;
    let bOrder = queueOrder[bQueue] || 0;
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

Labels.removeLabelerPrefix = (labelName) => {
  return removeLabelPrefix(labelName, Labels.LABELER_PREFIX);
}

Labels.addQueuedPrefix = (labelName) => {
  return Labels.addMakeTimePrefix(Labels.QUEUED_PREFIX + "/" + labelName);
}

Labels.BASE_TRIAGED_LABEL = 'triaged';
Labels.BASE_NEEDS_TRIAGE_LABEL = 'needstriage';
Labels.MAKE_TIME_PREFIX = 'maketime';
Labels.QUEUED_PREFIX = 'queued';
Labels.BASE_UNPROCESSED_LABEL = 'unprocessed';
Labels.UNPROCESSED_LABEL = Labels.addMakeTimePrefix(Labels.BASE_UNPROCESSED_LABEL);
Labels.TRIAGED_LABEL = Labels.addMakeTimePrefix(Labels.BASE_TRIAGED_LABEL);
Labels.NEEDS_TRIAGE_LABEL = Labels.addMakeTimePrefix(Labels.BASE_NEEDS_TRIAGE_LABEL);
Labels.READ_LATER_LABEL = Labels.triagedLabel('tldr');
Labels.NEEDS_REPLY_LABEL = Labels.triagedLabel('needsreply');
Labels.BLOCKED_LABEL_SUFFIX = 'blocked';
Labels.MUTED_LABEL = Labels.triagedLabel('supermuted');
Labels.ACTION_ITEM_LABEL = Labels.triagedLabel('actionitem');
Labels.LABELER_PREFIX = 'labeler';
Labels.FALLBACK_LABEL = 'needsfilter';

})();
