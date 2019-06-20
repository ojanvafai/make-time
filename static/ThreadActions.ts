import {Action} from './Actions.js';
import {assert} from './Base.js';
import {TinyDatePicker} from './third_party/tiny-date-picker/DatePicker.js';
import {BACKLOG_PRIORITY_NAME, MUST_DO_PRIORITY_NAME, NEEDS_FILTER_PRIORITY_NAME, PINNED_PRIORITY_NAME, Priority, Thread, URGENT_PRIORITY_NAME} from './Thread.js';

export let ARCHIVE_ACTION = {
  name: `Archive`,
  description: `Archive and remove from the current group.`,
};

export let PIN_ACTION = {
  name: PINNED_PRIORITY_NAME,
  description: `Pins to the top at the top of todo.`,
  key: 'x',
};

export let MUST_DO_ACTION = {
  name: MUST_DO_PRIORITY_NAME,
  description: `Must do today. Literally won't go home till it's done.`,
  key: '1',
};

export let URGENT_ACTION = {
  name: URGENT_PRIORITY_NAME,
  description: `Needs to happen ASAP.`,
  key: '2',
};

export let BACKLOG_ACTION = {
  name: BACKLOG_PRIORITY_NAME,
  description:
      `Important for achieving my mission, but can be done at leisure.`,
  key: '3',
};

export let NEEDS_FILTER_ACTION = {
  name: NEEDS_FILTER_PRIORITY_NAME,
  description:
      `Needs a new/different filter, but don't want to interrupt triaging to do that now.`,
  key: 'f',
};

export let MUTE_ACTION = {
  name: `Mute`,
  description:
      `Like gmail mute, but more aggressive. Will never appear in your inbox again.`,
};

export let REPEAT_ACTION = {
  name: 'Repeats',
  description: `Makes this task repeat daily.`,
  key: 't',
};

export let BLOCKED_1D_ACTION = {
  name: '1 day',
  description:
      `Block on action from someone else. Shows up tomorrow to retriage.`,
  key: '5',
  hidden: true,
};

export let BLOCKED_2D_ACTION = {
  name: '2 days',
  description:
      `Block on action from someone else. Shows up in 2 days to retriage.`,
  key: '6',
  hidden: true,
};

export let BLOCKED_7D_ACTION = {
  name: '7 days',
  description:
      `Block on action from someone else. Shows up in 7 days to retriage.`,
  key: '7',
  hidden: true,
};

export let BLOCKED_14D_ACTION = {
  name: '14 days',
  description:
      `Block on action from someone else. Shows up in 14 days to retriage.`,
  key: '8',
  hidden: true,
};

export let BLOCKED_30D_ACTION = {
  name: '30 days',
  description:
      `Block on action from someone else. Shows up in 30 days to retriage.`,
  key: '9',
  hidden: true,
};

export let BLOCKED_CUSTOM_ACTION = {
  name: 'Stuck',
  description: `Block on action from someone else. Pick a date to retriage.`,
  key: '0',
  hidden: true,
}

export let BLOCKED_BUTTONS = [
  BLOCKED_CUSTOM_ACTION,
  BLOCKED_30D_ACTION,
  BLOCKED_14D_ACTION,
  BLOCKED_7D_ACTION,
  BLOCKED_2D_ACTION,
  BLOCKED_1D_ACTION,
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
    case NEEDS_FILTER_ACTION:
      return Priority.NeedsFilter;
    default:
      return null;
  }
}

export async function takeAction(
    thread: Thread, destination: Action, moveToInboxAgain?: boolean) {
  let priority = destinationToPriority(destination);
  if (priority) {
    return await thread.setPriority(priority, moveToInboxAgain);
  } else {
    switch (destination) {
      case REPEAT_ACTION:
        return await thread.toggleRepeat();

      case ARCHIVE_ACTION:
        return await thread.archive();

      case BLOCKED_1D_ACTION:
        return await thread.setBlockedDays(1, moveToInboxAgain);

      case BLOCKED_2D_ACTION:
        return await thread.setBlockedDays(2, moveToInboxAgain);

      case BLOCKED_7D_ACTION:
        return await thread.setBlockedDays(7, moveToInboxAgain);

      case BLOCKED_14D_ACTION:
        return await thread.setBlockedDays(14, moveToInboxAgain);

      case BLOCKED_30D_ACTION:
        return await thread.setBlockedDays(30, moveToInboxAgain);

      case BLOCKED_CUSTOM_ACTION:
        let datePicker = new TinyDatePicker({mode: 'dp-modal'});
        return new Promise((resolve) => {
          // TODO: Handle the case where the date picker is closed without
          // selecting a date.
          datePicker.addEventListener('select', async () => {
            await thread.setBlocked(
                datePicker.state.selectedDate, moveToInboxAgain);
            resolve();
          });
        });

      case MUTE_ACTION:
        return await thread.setMuted();

      default:
        assert(false, 'This should never happen.');
    }
  }
}
