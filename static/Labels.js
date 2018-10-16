class Labels {
  async fetch() {
    var response = await gapiFetch(gapi.client.gmail.users.labels.list, {
      'userId': USER_ID
    });

    this.labelToId_ = {};
    this.idToLabel_ = {};
    this.makeTimeLabelIds_ = [];
    this.makeTimeLabelNames_ = [];
    this.needsTriageLabelNames_ = [];
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
      this.makeTimeLabelNames_.push(name);
      if (name.startsWith(Labels.TRIAGED_LABEL + '/'))
        this.triagedLabels_.push(name);
      else if (name.startsWith(Labels.PRIORITY_LABEL + '/'))
        this.priorityLabels_.push(name);
      else if (name.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/'))
        this.needsTriageLabelNames_.push(name);
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

  getMakeTimeLabelNames() {
    return this.makeTimeLabelNames_;
  }

  getNeedsTriageLabelNames() {
    return this.needsTriageLabelNames_;
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

Labels.removeTriagedPrefix = (labelName) => {
  return Labels.removeLabelPrefix(labelName, Labels.TRIAGED_LABEL);
}

Labels.needsTriageLabel = (labelName) => {
  return `${Labels.NEEDS_TRIAGE_LABEL}/${labelName}`;
}

Labels.removeNeedsTriagePrefix = (labelName) => {
  return Labels.removeLabelPrefix(labelName, Labels.NEEDS_TRIAGE_LABEL);
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

Labels.addBankruptPrefix = (labelName) => {
  return Labels.BANKRUPT_LABEL + "/" + labelName;
}

// TODO: This should be uppercase to match gmail.
Labels.INBOX_LABEL = 'inbox';
Labels.MAKE_TIME_PREFIX = 'maketime';
Labels.FALLBACK_LABEL = 'needsfilter';
Labels.ARCHIVE_LABEL = 'archive';
Labels.BLOCKED_SUFFIX = 'blocked';

Labels.DAILY_QUEUE_PREFIX = 'daily';
Labels.WEEKLY_QUEUE_PREFIX = 'weekly';
Labels.MONTHLY_QUEUE_PREFIX = 'monthly';

let QUEUE_ORDER = {};
QUEUE_ORDER[Labels.DAILY_QUEUE_PREFIX] = 1;
QUEUE_ORDER[Labels.WEEKLY_QUEUE_PREFIX] = 2;
QUEUE_ORDER[Labels.MONTHLY_QUEUE_PREFIX] = 3;

Labels.TRIAGED_LABEL = Labels.addMakeTimePrefix('triaged');
Labels.NEEDS_TRIAGE_LABEL = Labels.addMakeTimePrefix('needstriage');
Labels.QUEUED_LABEL = Labels.addMakeTimePrefix('queued');
Labels.PRIORITY_LABEL = Labels.addMakeTimePrefix('priority');
Labels.BANKRUPT_LABEL = Labels.triagedLabel('bankrupt');

Labels.UNPROCESSED_LABEL = Labels.addMakeTimePrefix('unprocessed');
Labels.PROCESSED_ARCHIVE_LABEL = Labels.addMakeTimePrefix(Labels.ARCHIVE_LABEL);
Labels.MUTED_LABEL = Labels.triagedLabel('supermuted');
Labels.ACTION_ITEM_LABEL = Labels.triagedLabel('actionitem');
Labels.BLOCKED_LABEL = Labels.addQueuedPrefix(Labels.BLOCKED_SUFFIX);

Labels.MUST_DO_LABEL = Labels.addPriorityPrefix('must-do');
Labels.URGENT_LABEL = Labels.addPriorityPrefix('urgent');
Labels.NOT_URGENT_LABEL = Labels.addPriorityPrefix('not-urgent');
Labels.DELEGATE_LABEL = Labels.addPriorityPrefix('delegate');
