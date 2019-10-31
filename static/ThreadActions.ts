import {Action, Shortcut, ActionGroup} from './Actions.js';
import {assert} from './Base.js';
import {TinyDatePicker} from './third_party/tiny-date-picker/DatePicker.js';
import {BACKLOG_PRIORITY_NAME, MUST_DO_PRIORITY_NAME, NEEDS_FILTER_PRIORITY_NAME, PINNED_PRIORITY_NAME, Priority, QUICK_PRIORITY_NAME, Thread, URGENT_PRIORITY_NAME, ICEBOX_PRIORITY_NAME} from './Thread.js';

export let ARCHIVE_ACTION = {
  name: `Archive`,
  description: `Archive and remove from the current group.`,
  key: 'a',
  actionGroup: ActionGroup.Ignore,
};

export let PIN_ACTION = {
  name: PINNED_PRIORITY_NAME,
  description: `Pins to the top at the top of todo.`,
  key: 'x',
  actionGroup: ActionGroup.Prioritize,
};

export let ICEBOX_ACTION = {
  name: ICEBOX_PRIORITY_NAME,
  description: `Move to icebox.`,
  key: 'i',
  actionGroup: ActionGroup.Prioritize,
};

export let QUICK_ACTION = {
  name: QUICK_PRIORITY_NAME,
  description: `Quick to take action on.`,
  key: 'q',
  actionGroup: ActionGroup.Prioritize,
};

export let MUST_DO_ACTION = {
  name: MUST_DO_PRIORITY_NAME,
  description: `Must do today. Literally won't go home till it's done.`,
  key: '1',
  actionGroup: ActionGroup.Prioritize,
};

export let URGENT_ACTION = {
  name: URGENT_PRIORITY_NAME,
  description: `Needs to happen ASAP.`,
  key: '2',
  actionGroup: ActionGroup.Prioritize,
};

export let BACKLOG_ACTION = {
  name: BACKLOG_PRIORITY_NAME,
  description: `Important but can be done when I get to it.`,
  key: '3',
  actionGroup: ActionGroup.Prioritize,
};

export let NEEDS_FILTER_ACTION = {
  name: NEEDS_FILTER_PRIORITY_NAME,
  description:
      `Needs a new/different filter, but don't want to interrupt triaging to do that now.`,
  key: 'f',
  actionGroup: ActionGroup.Prioritize,
};

export let MUTE_ACTION = {
  name: `Mute`,
  description: `Only appear for triage again if filters apply a new label.`,
  key: 'm',
  actionGroup: ActionGroup.Ignore,
};

export let SOFT_MUTE_ACTION = {
  name: `Soft Mute`,
  description: `Mute for 7 days.`,
  key: 's',
  actionGroup: ActionGroup.Ignore,
};

export let REPEAT_ACTION = {
  name: 'Repeats',
  description: `Makes this task repeat daily.`,
  key: 't',
  actionGroup: ActionGroup.Date,
};

let BLOCKED_1D_ACTION = {
  name: '1 day',
  description:
      `Block on action from someone else. Shows up tomorrow to retriage.`,
  key: '5',
  actionGroup: ActionGroup.Date,
};

let BLOCKED_2D_ACTION = {
  name: '2 days',
  description:
      `Block on action from someone else. Shows up in 2 days to retriage.`,
  key: '6',
  actionGroup: ActionGroup.Date,
};

let BLOCKED_7D_ACTION = {
  name: '7 days',
  description:
      `Block on action from someone else. Shows up in 7 days to retriage.`,
  key: '7',
  actionGroup: ActionGroup.Date,
};

let BLOCKED_14D_ACTION = {
  name: '14 days',
  description:
      `Block on action from someone else. Shows up in 14 days to retriage.`,
  key: '8',
  actionGroup: ActionGroup.Date,
};

let BLOCKED_30D_ACTION = {
  name: '30 days',
  description:
      `Block on action from someone else. Shows up in 30 days to retriage.`,
  key: '9',
  actionGroup: ActionGroup.Date,
};

let BLOCKED_CUSTOM_ACTION = {
  name: 'Stuck',
  description: `Block on action from someone else. Pick a date to retriage.`,
  key: '0',
  actionGroup: ActionGroup.Date,
}

let BLOCKED_NONE_ACTION = {
  name: 'Clear',
  description: `Removes the stuck date.`,
  key: '-',
  actionGroup: ActionGroup.Date,
};

export let BLOCKED_ACTIONS = [
  BLOCKED_CUSTOM_ACTION,
  BLOCKED_1D_ACTION,
  BLOCKED_2D_ACTION,
  BLOCKED_7D_ACTION,
  BLOCKED_14D_ACTION,
  BLOCKED_30D_ACTION,
  BLOCKED_NONE_ACTION,
  REPEAT_ACTION,
];

let DUE_1D_ACTION = {
  name: '1 day',
  description: `Shows up tomorrow to retriage.`,
  key: new Shortcut('5', false, true, 'Digit5'),
  actionGroup: ActionGroup.Date,
};

let DUE_2D_ACTION = {
  name: '2 days',
  description: `Shows up in 2 days to retriage.`,
  key: new Shortcut('6', false, true, 'Digit6'),
  actionGroup: ActionGroup.Date,
};

let DUE_7D_ACTION = {
  name: '7 days',
  description: `Shows up in 7 days to retriage.`,
  key: new Shortcut('7', false, true, 'Digit7'),
  actionGroup: ActionGroup.Date,
};

let DUE_14D_ACTION = {
  name: '14 days',
  description: `Shows up in 14 days to retriage.`,
  key: new Shortcut('8', false, true, 'Digit8'),
  actionGroup: ActionGroup.Date,
};

let DUE_30D_ACTION = {
  name: '30 days',
  description: `Shows up in 30 days to retriage.`,
  key: new Shortcut('9', false, true, 'Digit9'),
  actionGroup: ActionGroup.Date,
};

let DUE_CUSTOM_ACTION = {
  name: 'Due',
  description: `Pick a due date to retriage.`,
  key: new Shortcut('0', false, true, 'Digit0'),
  actionGroup: ActionGroup.Date,
};

let DUE_NONE_ACTION = {
  name: 'Clear',
  description: `Removes the due date.`,
  key: new Shortcut('-', false, true, 'Minus'),
  actionGroup: ActionGroup.Date,
};

export let DUE_ACTIONS = [
  DUE_CUSTOM_ACTION,
  DUE_1D_ACTION,
  DUE_2D_ACTION,
  DUE_7D_ACTION,
  DUE_14D_ACTION,
  DUE_30D_ACTION,
  DUE_NONE_ACTION,
];

export let BASE_THREAD_ACTIONS = [
  [
    QUICK_ACTION,
    NEEDS_FILTER_ACTION,
    PIN_ACTION,
  ],
  MUST_DO_ACTION,
  URGENT_ACTION,
  [
    BACKLOG_ACTION,
    ICEBOX_ACTION,
  ],
  BLOCKED_ACTIONS,
  DUE_ACTIONS,
];

function destinationToPriority(destination: Action) {
  switch (destination) {
    case PIN_ACTION:
      return Priority.Pin;

    case QUICK_ACTION:
      return Priority.Quick;

    case ICEBOX_ACTION:
      return Priority.Icebox;

    case MUST_DO_ACTION:
      return Priority.MustDo;

    case URGENT_ACTION:
      return Priority.Urgent;

    case BACKLOG_ACTION:
      return Priority.Backlog;

    case NEEDS_FILTER_ACTION:
      return Priority.NeedsFilter;

    default:
      return null;
  }
}

export async function pickDate(destination: Action):
    Promise<Date|undefined|null> {
  if (destination === BLOCKED_CUSTOM_ACTION ||
      destination === DUE_CUSTOM_ACTION) {
    let datePicker = new TinyDatePicker({mode: 'dp-modal'});
    return new Promise((resolve) => {
      datePicker.addEventListener('select', async () => {
        resolve(datePicker.state.selectedDate);
      });
      datePicker.addEventListener('cancel', async () => {
        resolve(null);
      });
    });
  }
  return;
}

export async function takeAction(
    thread: Thread, destination: Action, moveToInbox?: boolean) {
  let date = await pickDate(destination);
  // Null means that this is a date action, but no date was selected.
  if (date === null)
    return;
  let update = date ?
      await createDateUpdate(thread, destination, date, moveToInbox) :
      await createUpdate(thread, destination, moveToInbox);
  if (!update)
    return;
  await thread.updateMetadata(update);
}

export function createDateUpdate(
    thread: Thread, destination: Action, date: Date, moveToInbox?: boolean) {
  if (destination === BLOCKED_CUSTOM_ACTION)
    return thread.stuckUpdate(date, moveToInbox);

  if (destination === DUE_CUSTOM_ACTION)
    return thread.dueUpdate(date, moveToInbox);

  assert(false, 'This should never happen.');
  return;
}

export function createUpdate(
    thread: Thread, destination: Action, moveToInbox?: boolean,
    needsMessageTriage?: boolean) {
  let priority = destinationToPriority(destination);
  if (priority) {
    return thread.priorityUpdate(priority, moveToInbox, needsMessageTriage);
  } else {
    switch (destination) {
      case REPEAT_ACTION:
        return thread.repeatUpdate();

      case ARCHIVE_ACTION:
        return thread.archiveUpdate();

      case BLOCKED_NONE_ACTION:
        return thread.clearStuckUpdate(moveToInbox);

      // TODO: Remove some of the duplication between BLOCKED and DUE.
      case BLOCKED_1D_ACTION:
        return thread.stuckDaysUpdate(1, moveToInbox);

      case BLOCKED_2D_ACTION:
        return thread.stuckDaysUpdate(2, moveToInbox);

      case BLOCKED_7D_ACTION:
        return thread.stuckDaysUpdate(7, moveToInbox);

      case BLOCKED_14D_ACTION:
        return thread.stuckDaysUpdate(14, moveToInbox);

      case BLOCKED_30D_ACTION:
        return thread.stuckDaysUpdate(30, moveToInbox);

      case DUE_NONE_ACTION:
        return thread.clearDueUpdate(moveToInbox);

      case DUE_1D_ACTION:
        return thread.dueDaysUpdate(1, moveToInbox);

      case DUE_2D_ACTION:
        return thread.dueDaysUpdate(2, moveToInbox);

      case DUE_7D_ACTION:
        return thread.dueDaysUpdate(7, moveToInbox);

      case DUE_14D_ACTION:
        return thread.dueDaysUpdate(14, moveToInbox);

      case DUE_30D_ACTION:
        return thread.dueDaysUpdate(30, moveToInbox);

      case MUTE_ACTION:
        return thread.muteUpdate();

      case SOFT_MUTE_ACTION:
        return thread.softMuteUpdate();
    }
  }
  assert(false, 'This should never happen.');
  return;
}
