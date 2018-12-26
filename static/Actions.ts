import {Labels} from './Labels.js';
import {ThreadListView} from './views/ThreadListView.js';

interface Action {
  name: string;
  description: string;
  key?: string;
  hidden: boolean;
  repeatable: boolean;
  destination?: string|null;
}

export class Actions extends HTMLElement {
  static ARCHIVE_ACTION: Action;
  static BLOCKED_ACTION: Action;
  static SPAM_ACTION: Action;
  static MUTE_ACTION: Action;
  static MUST_DO_ACTION: Action;
  static URGENT_ACTION: Action;
  static BACKLOG_ACTION: Action;
  static NEEDS_FILTER_ACTION: Action;
  static QUICK_REPLY_ACTION: Action;
  static NEXT_EMAIL_ACTION: Action;
  static PREVIOUS_EMAIL_ACTION: Action;
  static TOGGLE_FOCUSED_ACTION: Action;
  static VIEW_FOCUSED_ACTION: Action;
  static NEXT_QUEUE_ACTION: Action;
  static PREVIOUS_QUEUE_ACTION: Action;
  static TOGGLE_QUEUE_ACTION: Action;
  static VIEW_TRIAGE_ACTION: Action;
  static UNDO_ACTION: Action;

  constructor(private view_: ThreadListView, private actions_: Action[]) {
    super();
    this.style.display = 'flex';
    this.style.flexWrap = 'wrap';

    this.setDestinations_();
    this.appendActions_(this, actions_);
  }

  appendActions_(container: HTMLElement, actions: Action[]) {
    for (let action of actions) {
      if (action.hidden)
        continue;
      let button = document.createElement('button');
      button.setAttribute('tooltip', action.description);

      button.onclick = () => this.takeAction(action);
      let tooltipElement: HTMLElement;
      button.onmouseenter = () => {
        tooltipElement = document.createElement('div');
        tooltipElement.style.cssText = `
          position: absolute;
          bottom: ${this.offsetHeight}px;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
        `;

        let text = document.createElement('div');
        text.style.cssText = `
          background-color: white;
          border: 1px solid;
          padding: 4px;
          width: 300px;
        `;

        let tooltip = <string>button.getAttribute('tooltip');
        text.append(tooltip);
        tooltipElement.append(text);
        this.append(tooltipElement);
      };
      button.onmouseleave = () => {
        tooltipElement.remove();
      };
      let name = action.name;
      button.innerHTML =
          `<span class="shortcut">${name.charAt(0)}</span>${name.slice(1)}`;
      container.append(button);
    }
  }

  // Do this in the constructor since it depends on Labels.js
  setDestinations_() {
    Actions.BLOCKED_ACTION.destination = Labels.BLOCKED_LABEL;
    Actions.MUTE_ACTION.destination = Labels.MUTED_LABEL;

    Actions.MUST_DO_ACTION.destination = Labels.MUST_DO_LABEL;
    Actions.URGENT_ACTION.destination = Labels.URGENT_LABEL;
    Actions.BACKLOG_ACTION.destination = Labels.BACKLOG_LABEL;
    Actions.NEEDS_FILTER_ACTION.destination = Labels.NEEDS_FILTER_LABEL;
  }

  dispatchShortcut(e: KeyboardEvent) {
    let test = (action: Action) => {
      // Don't allow certain actions to apply in rapid succession for each
      // thread. This prevents accidents of archiving a lot of threads at once
      // when your stupid keyboard gets stuck holding the archive key down.
      // #sigh
      if (!action.repeatable && e.repeat)
        return false;
      if (action.key)
        return action.key == e.key;
      return action.name.charAt(0).toLowerCase() == e.key;
    };

    let action = this.actions_.find(test);
    if (action)
      this.takeAction(action, e);
  }

  async takeAction(action: Action, opt_e?: KeyboardEvent) {
    if (this.view_.shouldSuppressActions())
      return;

    if (!navigator.onLine) {
      alert(`This action requires a network connection.`);
      return;
    }

    if (opt_e)
      opt_e.preventDefault();

    await this.view_.takeAction(action);
  }
}

Actions.ARCHIVE_ACTION = {
  name: `Archive`,
  description: `Archive and remove from the current queue.`,
  key: undefined,
  hidden: false,
  repeatable: false,
  // Done is removing all labels. Use null as a sentinel for that.
  destination: null,
};

Actions.QUICK_REPLY_ACTION = {
  name: `Quick Reply`,
  description:
      `Give a short reply. Hit enter to send, escape to cancel. Allowed length is the allowed_reply_length setting.`,
  key: undefined,
  hidden: false,
  repeatable: false,
};

Actions.BLOCKED_ACTION = {
  name: `Blocked`,
  description:
      `Block on action from someone else. Gets queued to be shown once a week on a day of your choosing via Settings.`,
  key: undefined,
  hidden: false,
  repeatable: false,
};

Actions.SPAM_ACTION = {
  name: `Spam`,
  description: `Report spam. Same beavhior as reporting spam in gmail.`,
  key: undefined,
  hidden: false,
  repeatable: false,
  destination: 'SPAM',
};

Actions.MUTE_ACTION = {
  name: `Mute`,
  description:
      `Like gmail mute, but more aggressive. Will never appear in your inbox again. Goes in triaged/supermuted label.`,
  key: undefined,
  hidden: false,
  repeatable: false,
};

Actions.NEXT_EMAIL_ACTION = {
  name: `NextEmail`,
  description: `Focus the next email.`,
  key: 'j',
  hidden: true,
  repeatable: true,
};

Actions.PREVIOUS_EMAIL_ACTION = {
  name: `PreviousEmail`,
  description: `Focus the previous email.`,
  key: 'k',
  hidden: true,
  repeatable: true,
};

Actions.TOGGLE_FOCUSED_ACTION = {
  name: `ToggleFocused`,
  description: `Toggle whether or not the focused element is selected.`,
  key: ' ',
  hidden: true,
  repeatable: false,
};

Actions.VIEW_FOCUSED_ACTION = {
  name: `ViewFocused`,
  description: `View the focused email.`,
  key: 'Enter',
  hidden: true,
  repeatable: false,
};

Actions.NEXT_QUEUE_ACTION = {
  name: `NextQueue`,
  description: `Focus the first email of the next queue.`,
  key: 'n',
  hidden: true,
  repeatable: true,
};

Actions.PREVIOUS_QUEUE_ACTION = {
  name: `PreviousQueue`,
  description: `Focus the first email of the previous queue.`,
  key: 'p',
  hidden: true,
  repeatable: true,
};

Actions.TOGGLE_QUEUE_ACTION = {
  name: `ToggleQueue`,
  description: `Toggle all items in the current queue.`,
  key: 'g',
  hidden: true,
  repeatable: false,
};

Actions.VIEW_TRIAGE_ACTION = {
  name: `ViewTriage`,
  description: `Go to the triage view.`,
  key: 'Escape',
  hidden: true,
  repeatable: false,
};

Actions.UNDO_ACTION = {
  name: `Undo`,
  description: `Undoes the last action taken.`,
  key: undefined,
  hidden: false,
  repeatable: false,
};

Actions.MUST_DO_ACTION = {
  name: `1: Must Do`,
  description: `Must do today. Literally won't go home till it's done.`,
  key: undefined,
  hidden: false,
  repeatable: false,
};

Actions.URGENT_ACTION = {
  name: `2: Urgent`,
  description: `Needs to happen ASAP.`,
  key: undefined,
  hidden: false,
  repeatable: false,
};

Actions.BACKLOG_ACTION = {
  name: `3: Backlog`,
  description:
      `Important for achieving my mission, but can be done at leisure. Aim to spend >60% of your time here.`,
  key: undefined,
  hidden: false,
  repeatable: false,
};

Actions.NEEDS_FILTER_ACTION = {
  name: `4: Needs Filter`,
  description:
      `Needs a new/different filter, but don't want to interrupt triaging to do that now.`,
  key: undefined,
  hidden: false,
  repeatable: false,
};

window.customElements.define('mt-actions', Actions);
