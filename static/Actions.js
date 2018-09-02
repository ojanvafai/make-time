class Actions extends HTMLElement {
  constructor(view, actions) {
    super();
    this.style.display = 'flex';

    this.view_ = view;
    this.actions_ = actions;

    this.setDestinations_();

    for (let action of actions) {
      let button = document.createElement('button');
      button.tooltip = action.description;

      button.onclick = () => this.takeAction(action);
      button.onmouseenter = () => {
        button.tooltipElement = document.createElement('div');
        button.tooltipElement.style.cssText = `
          position: fixed;
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

        text.append(button.tooltip);
        button.tooltipElement.append(text);
        this.append(button.tooltipElement);
      }
      button.onmouseleave = () => {
        button.tooltipElement.remove();
      }
      let name = action.name;
      button.innerHTML = `<span class="shortcut">${name.charAt(0)}</span>${name.slice(1)}`;
      this.append(button);
    }
  }

  // Do this in the constructor since it depends on Labels.js
  setDestinations_() {
    // Done is removing all labels. Use null as a sentinel for that.
    Actions.DONE_ACTION.destination = null;
    Actions.BEGIN_TRIAGE_ACTION.destination = null;
    Actions.TLDR_ACTION.destination = Labels.READ_LATER_LABEL;
    Actions.REPLY_NEEDED_ACTION.destination = Labels.NEEDS_REPLY_LABEL;
    Actions.BLOCKED_ACTION.destination = Labels.addQueuedPrefix(Labels.BLOCKED_LABEL_SUFFIX);
    Actions.SPAM_ACTION.destination = 'SPAM';
    Actions.MUTE_ACTION.destination = Labels.MUTED_LABEL;
    Actions.ACTION_ITEM_ACTION.destination = Labels.ACTION_ITEM_LABEL;
  }

  dispatchShortcut(e) {
    for (let action of this.actions_) {
      // The first letter of the action name is always the keyboard shortcut.
      if (action.name.charAt(0).toLowerCase() == e.key) {
        this.takeAction(action, e);
        return;
      }
    }
  }

  async takeAction(action, opt_e) {
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

Actions.DONE_ACTION = {
  name: 'Done',
  description: `Archive and remove from the current queue.`,
};

Actions.TLDR_ACTION = {
  name: 'TL;DR',
  description: `Too long, will read later. Goes in triaged/tldr label.`,
};

Actions.REPLY_NEEDED_ACTION = {
  name: 'Reply Needed',
  description: `Needs a reply. Goes in triaged/replyneeded label.`,
};

Actions.QUICK_REPLY_ACTION = {
  name: 'Quick Reply',
  description: `Give a short reply. Hit enter to send, escape to cancel. Allowed length is the allowed_reply_length setting.`,
};

Actions.BLOCKED_ACTION = {
  name: 'Blocked',
  description: `Block on action from someone else. Gets queued to be shown once a week on a day of your choosing via Settings.`,
};

Actions.SPAM_ACTION = {
  name: 'Spam',
  description: `Report spam. Same beavhior as reporting spam in gmail.`,
};

Actions.MUTE_ACTION = {
  name: 'Mute',
  description: `Like gmail mute, but more aggressive. Will never appear in your inbox again. Goes in triaged/supermuted label.`,
};

Actions.ACTION_ITEM_ACTION = {
  name: 'Action Item',
  description: `Needs some action taken other than an email reply. Goes in triaged/actionitem label.`,
};

Actions.UNDO_ACTION = {
  name: 'Undo',
  description: `Undoes the last action taken.`,
};

Actions.BEGIN_TRIAGE_ACTION = {
  name: 'Begin triage and done',
  description: 'Archive the selected threads and one thread at a time triage.',
}

window.customElements.define('mt-actions', Actions);
