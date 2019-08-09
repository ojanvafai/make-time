import {Action, Shortcut} from './Actions.js';
import {assert} from './Base.js';
import {TinyDatePicker} from './third_party/tiny-date-picker/DatePicker.js';
import {BACKLOG_PRIORITY_NAME, MUST_DO_PRIORITY_NAME, NEEDS_FILTER_PRIORITY_NAME, PINNED_PRIORITY_NAME, Priority, QUICK_PRIORITY_NAME, Thread, URGENT_PRIORITY_NAME} from './Thread.js';

export let ARCHIVE_ACTION = {
  name: `Archive`,
  description: `Archive and remove from the current group.`,
  key: 'a',
};

export let PIN_ACTION = {
  name: PINNED_PRIORITY_NAME,
  description: `Pins to the top at the top of todo.`,
  key: 'x',
};

let STICKY_PREFIX = 'Sticky ';

export let STICKY_PIN_ACTION = {
  name: STICKY_PREFIX + PINNED_PRIORITY_NAME,
  description: `(sticky) pins to the top at the top of todo.`,
  key: new Shortcut('x', false, true, 'KeyX'),
};

export let QUICK_ACTION = {
  name: QUICK_PRIORITY_NAME,
  description: `Quick to take action on.`,
  key: 'q',
};

export let STICKY_QUICK_ACTION = {
  name: STICKY_PREFIX + QUICK_PRIORITY_NAME,
  description: `(sticky) Quick to take action on.`,
  key: new Shortcut('q', false, true, 'KeyQ'),
};

export let MUST_DO_ACTION = {
  name: MUST_DO_PRIORITY_NAME,
  description: `Must do today. Literally won't go home till it's done.`,
  key: '1',
};

export let STICKY_MUST_DO_ACTION = {
  name: STICKY_PREFIX + MUST_DO_PRIORITY_NAME,
  description:
      `(sticky) Must do today. Literally won't go home till it's done.`,
  key: new Shortcut('1', false, true, 'Digit1'),
};

export let URGENT_ACTION = {
  name: URGENT_PRIORITY_NAME,
  description: `Needs to happen ASAP.`,
  key: '2',
};

export let STICKY_URGENT_ACTION = {
  name: STICKY_PREFIX + URGENT_PRIORITY_NAME,
  description: `(sticky) Needs to happen ASAP.`,
  key: new Shortcut('2', false, true, 'Digit2'),
};

export let BACKLOG_ACTION = {
  name: BACKLOG_PRIORITY_NAME,
  description: `Important but can be done when I get to it.`,
  key: '3',
};

export let STICKY_BACKLOG_ACTION = {
  name: STICKY_PREFIX + BACKLOG_PRIORITY_NAME,
  description: `(sticky) Important but can be done when I get to it.`,
  key: new Shortcut('3', false, true, 'Digit3'),
};

export let NEEDS_FILTER_ACTION = {
  name: NEEDS_FILTER_PRIORITY_NAME,
  description:
      `Needs a new/different filter, but don't want to interrupt triaging to do that now.`,
  key: 'f',
};

export let STICKY_NEEDS_FILTER_ACTION = {
  name: STICKY_PREFIX + NEEDS_FILTER_PRIORITY_NAME,
  description:
      `(sticky) Needs a new/different filter, but don't want to interrupt triaging to do that now.`,
  key: new Shortcut('f', false, true, 'KeyF'),
};

export let MUTE_ACTION = {
  name: `Mute`,
  description:
      `(sticky) archive. Only appear for triage again if filters apply a new label.`,
  key: 'm',
};

export let REPEAT_ACTION = {
  name: 'Repeats',
  description: `Makes this task repeat daily.`,
  key: 't',
};

let BLOCKED_1D_ACTION = {
  name: '1 day',
  description:
      `Block on action from someone else. Shows up tomorrow to retriage.`,
  key: '5',
};

let BLOCKED_2D_ACTION = {
  name: '2 days',
  description:
      `Block on action from someone else. Shows up in 2 days to retriage.`,
  key: '6',
};

let BLOCKED_7D_ACTION = {
  name: '7 days',
  description:
      `Block on action from someone else. Shows up in 7 days to retriage.`,
  key: '7',
};

let BLOCKED_14D_ACTION = {
  name: '14 days',
  description:
      `Block on action from someone else. Shows up in 14 days to retriage.`,
  key: '8',
};

let BLOCKED_30D_ACTION = {
  name: '30 days',
  description:
      `Block on action from someone else. Shows up in 30 days to retriage.`,
  key: '9',
};

let BLOCKED_CUSTOM_ACTION = {
  name: 'Stuck',
  description: `Block on action from someone else. Pick a date to retriage.`,
  key: '0',
}

let BLOCKED_NONE_ACTION = {
  name: 'Clear',
  description: `Removes the stuck date.`,
  key: '-',
};

export let BLOCKED_ACTIONS = [
  BLOCKED_CUSTOM_ACTION,
  BLOCKED_1D_ACTION,
  BLOCKED_2D_ACTION,
  BLOCKED_7D_ACTION,
  BLOCKED_14D_ACTION,
  BLOCKED_30D_ACTION,
  BLOCKED_NONE_ACTION,
];

let DUE_1D_ACTION = {
  name: '1 day',
  description: `Shows up tomorrow to retriage.`,
  key: new Shortcut('5', false, true, 'Digit5'),
};

let DUE_2D_ACTION = {
  name: '2 days',
  description: `Shows up in 2 days to retriage.`,
  key: new Shortcut('6', false, true, 'Digit6'),
};

let DUE_7D_ACTION = {
  name: '7 days',
  description: `Shows up in 7 days to retriage.`,
  key: new Shortcut('7', false, true, 'Digit7'),
};

let DUE_14D_ACTION = {
  name: '14 days',
  description: `Shows up in 14 days to retriage.`,
  key: new Shortcut('8', false, true, 'Digit8'),
};

let DUE_30D_ACTION = {
  name: '30 days',
  description: `Shows up in 30 days to retriage.`,
  key: new Shortcut('9', false, true, 'Digit9'),
};

let DUE_CUSTOM_ACTION = {
  name: 'Due',
  description: `Pick a due date to retriage.`,
  key: new Shortcut('0', false, true, 'Digit0'),
};

let DUE_NONE_ACTION = {
  name: 'Clear',
  description: `Removes the due date.`,
  key: new Shortcut('-', false, true, 'Minus'),
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
    STICKY_QUICK_ACTION,
    NEEDS_FILTER_ACTION,
    STICKY_NEEDS_FILTER_ACTION,
    PIN_ACTION,
    STICKY_PIN_ACTION,
  ],
  [MUST_DO_ACTION, STICKY_MUST_DO_ACTION],
  [URGENT_ACTION, STICKY_URGENT_ACTION],
  [BACKLOG_ACTION, STICKY_BACKLOG_ACTION],
  BLOCKED_ACTIONS,
  DUE_ACTIONS,
];

function destinationToPriority(destination: Action): [Priority|null, boolean] {
  switch (destination) {
    case PIN_ACTION:
      return [Priority.Pin, false];
    case STICKY_PIN_ACTION:
      return [Priority.Pin, true];

    case QUICK_ACTION:
      return [Priority.Quick, false];
    case STICKY_QUICK_ACTION:
      return [Priority.Quick, true];

    case MUST_DO_ACTION:
      return [Priority.MustDo, false];
    case STICKY_MUST_DO_ACTION:
      return [Priority.MustDo, true];

    case URGENT_ACTION:
      return [Priority.Urgent, false];
    case STICKY_URGENT_ACTION:
      return [Priority.Urgent, true];

    case BACKLOG_ACTION:
      return [Priority.Backlog, false];
    case STICKY_BACKLOG_ACTION:
      return [Priority.Backlog, true];

    case NEEDS_FILTER_ACTION:
      return [Priority.NeedsFilter, false];
    case STICKY_NEEDS_FILTER_ACTION:
      return [Priority.NeedsFilter, true];

    default:
      return [null, false];
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
  let [priority, isSticky] = destinationToPriority(destination);
  if (priority) {
    return thread.priorityUpdate(
        priority, isSticky, moveToInbox, needsMessageTriage);
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
    }
  }
  assert(false, 'This should never happen.');
  return;
}
