import {Action, ActionGroup} from './Actions.js';
import {assert} from './Base.js';
import {TinyDatePicker} from './third_party/tiny-date-picker/DatePicker.js';
import {BACKLOG_PRIORITY_NAME, MUST_DO_PRIORITY_NAME, PINNED_PRIORITY_NAME, Priority, Thread, URGENT_PRIORITY_NAME} from './Thread.js';

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
  actionGroup: ActionGroup.Priority,
};

export let MUST_DO_ACTION = {
  name: MUST_DO_PRIORITY_NAME,
  description: `Must do today. Should be completely emptied daily.`,
  key: '1',
  actionGroup: ActionGroup.Priority,
};

export let URGENT_ACTION = {
  name: URGENT_PRIORITY_NAME,
  description: `Needs to happen ASAP.`,
  key: '2',
  actionGroup: ActionGroup.Priority,
};

export let BACKLOG_ACTION = {
  name: BACKLOG_PRIORITY_NAME,
  description: `Important but can be done when I get to it.`,
  key: '3',
  actionGroup: ActionGroup.Priority,
};

export let MUTE_ACTION = {
  name: `Mute ∞`,
  description: `Only appear for triage again if filters apply a new label.`,
  key: 'm',
  actionGroup: ActionGroup.Ignore,
};

export let SOFT_MUTE_ACTION = {
  name: `Mute 7d`,
  description: `Mute for 7 days.`,
  key: 's',
  actionGroup: ActionGroup.Ignore,
};

export let REPEAT_ACTION = {
  name: 'Daily',
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
  [
    BLOCKED_1D_ACTION,
    BLOCKED_2D_ACTION,
    BLOCKED_7D_ACTION,
  ],
  [
    BLOCKED_14D_ACTION,
    BLOCKED_30D_ACTION,
  ],
  [
    BLOCKED_NONE_ACTION,
    REPEAT_ACTION,
  ],
];

export let BASE_THREAD_ACTIONS = [
  [
    MUST_DO_ACTION,
    [
      PIN_ACTION,
      URGENT_ACTION,
      BACKLOG_ACTION,
    ],
  ],
  BLOCKED_ACTIONS,
];

function destinationToPriority(destination: Action) {
  switch (destination) {
    case PIN_ACTION:
      return Priority.Pin;

    case MUST_DO_ACTION:
      return Priority.MustDo;

    case URGENT_ACTION:
      return Priority.Urgent;

    case BACKLOG_ACTION:
      return Priority.Backlog;

    default:
      return null;
  }
}

export async function pickDate(destination: Action):
    Promise<Date|undefined|null> {
  if (destination !== BLOCKED_CUSTOM_ACTION)
    return;

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

export async function takeAction(
    thread: Thread, destination: Action, moveToInbox?: boolean) {
  let date = await pickDate(destination);
  // Null means that this is a date action, but no date was selected.
  if (date === null)
    return;
  let update = date ? await createStuckUpdate(thread, date, moveToInbox) :
                      await createUpdate(thread, destination, moveToInbox);
  if (!update)
    return;
  await thread.updateMetadata(update);
}

export async function createStuckUpdate(
    thread: Thread, date: Date, moveToInbox?: boolean) {
  return thread.stuckUpdate(date, moveToInbox)
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

      case MUTE_ACTION:
        return thread.muteUpdate();

      case SOFT_MUTE_ACTION:
        return thread.softMuteUpdate();
    }
  }
  assert(false, 'This should never happen.');
  return;
}
