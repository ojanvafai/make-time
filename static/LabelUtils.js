// TODO: Use modules.
let LabelUtils = {};

// TODO: Move these into LabelUtils properly.
var TRIAGED_LABEL = 'triaged';
var TO_TRIAGE_LABEL = 'needstriage';

function triagerLabel(labelName) {
  return `${TRIAGED_LABEL}/${labelName}`;
}

function removeTriagedPrefix(label) {
  return label.replace(new RegExp('^' + TO_TRIAGE_LABEL + '/'), '');
}

function needsTriageLabel(labelName) {
  return `${TO_TRIAGE_LABEL}/${labelName}`;
}

var READ_LATER_LABEL = triagerLabel('tldr');
var NEEDS_REPLY_LABEL = triagerLabel('needsreply');
var BLOCKED_LABEL = triagerLabel('blocked');
var MUTED_LABEL = triagerLabel('supermuted');
var ACTION_ITEM_LABEL = triagerLabel('actionitem');

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

LabelUtils.sort = (labels) => {
  labels.sort(compareLabels);
}
})();