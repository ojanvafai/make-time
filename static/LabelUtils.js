// TODO: Use modules.
let LabelUtils = {};

// TODO: Move these into LabelUtils properly.
let TRIAGED_LABEL = 'triaged';
let TO_TRIAGE_LABEL = 'needstriage';

let LABELER_PREFIX = 'labeler';
let QUEUED_PREFIX = 'queued';

function triagerLabel(labelName) {
  return `${TRIAGED_LABEL}/${labelName}`;
}

function removeTriagedPrefix(label) {
  if (!label)
    return 'inbox';
  return label.replace(new RegExp('^' + TO_TRIAGE_LABEL + '/'), '');
}

function needsTriageLabel(labelName) {
  return `${TO_TRIAGE_LABEL}/${labelName}`;
}

function addLabelerPrefix(labelName) {
  return LABELER_PREFIX + '/' + labelName;
}

function addQueuedPrefix(labelName) {
  return this.addLabelerPrefix(QUEUED_PREFIX + "/" + labelName);
}

let UNPROCESSED_LABEL = 'unprocessed';
let FALLBACK_LABEL = 'needsfilter';
let READ_LATER_LABEL = triagerLabel('tldr');
let NEEDS_REPLY_LABEL = triagerLabel('needsreply');
let BLOCKED_LABEL_SUFFIX = 'blocked';
let MUTED_LABEL = triagerLabel('supermuted');
let ACTION_ITEM_LABEL = triagerLabel('actionitem');

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

function compareLabels(a, b) {
  if (a == b)
    return 0;
  if (!a)
    return -1;
  if (!b)
    return 1;

  let aParts = a.split('/');
  let bParts = b.split('/');
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

LabelUtils.compareLabels = compareLabels;
})();