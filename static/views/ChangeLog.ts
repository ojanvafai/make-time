import {createMktimeButton} from '../Base.js';
import {Dialog} from '../Dialog.js';

interface Entry {
  date: string, description: string;
}

const CHANGES: Entry[] = [
  {
    date: '7/30/20',
    description:
        `Restrict the width of rendered messages to target <100 characters for better readability.`
  },
  {
    date: '7/29/20',
    description:
        `Added a setting to have mktime push labels and priorities to gmail as gmail labels. This lets you have a backup of the critical mktime content in gmail and also lets you cope better when mktime is down for some reason.

label/priority are only sent from mktime to gmail, not the other way around. So changing a label or priority in gmail will cause it to get out of sync with what label/priority mktime thinks it has until you modify the thread in mktime again.

This code is hot off the presses and mostly rewrites the existing code for sending updates from mktime to gmail, so speak up if there are bugs in the next few days.
`,
  },
  {
    date: '7/25/20',
    description:
        `Pinned threads now have a pin icon to indicate they are pinned.`,
  },
  {
    date: '7/25/20',
    description:
        `Add recently modified view to Hidden tab for seeing the last 50 threads you took an action on. Helpful for when you accidentally triage something and can't get back to it with undo.`,
  },
  {
    date: '7/25/20',
    description:
        `Added a send button to quick reply and changed the send keyboard shortcut from enter to cmd+enter.`,
  },
  {
    date: '7/25/20',
    description:
        `Added "Redact messages" to Settings for doing demos without showing the whole world your inbox.`,
  },
  {
    date: '7/22/20',
    description:
        `Moved unfiltered threads to a dedicated view. In the main Todo view they render as a single card a the top you can click on to go to the view. It shows the names of the senders so you can see if you need to deal with filters or not. 

Hopefully this also makes it so you can ignore unfiltered if you need to get into your inbox to quickly do a thing.

This should fix the bugs around the wrong toolbar showing up or it not showing at all and other weirdnesses like what to do with the toolbar when there are multiple different classes of threads selected. Also, creates a bit more vertical space.
`,
  },
];

function writeLastShownDate() {
  window.localStorage.lastShownChangelogEntryDate = CHANGES[0].date;
}

export function renderChangeLog() {
  // TODO: Store this in firestore so it syncs across devices
  const lastShownChangelogEntryDate =
      window.localStorage.lastShownChangelogEntryDate;
  // If this is a new user, then there won't be a last shown date and we don't
  // want to show them a changelog anyways.
  if (lastShownChangelogEntryDate === undefined) {
    writeLastShownDate();
    return;
  }
  let changes = CHANGES;
  if (lastShownChangelogEntryDate) {
    const lastShownDate = new Date(lastShownChangelogEntryDate);
    changes = CHANGES.filter(x => new Date(x.date) > lastShownDate);
  }

  if (!changes.length) {
    return;
  }

  const container = document.createElement('div');
  container.className = 'pre-wrap';
  const header = document.createElement('h1');
  header.append('Changes since you were last here...');
  container.append(header);

  for (let change of changes) {
    let item = document.createElement(changes.length > 1 ? 'li' : 'div');
    item.append(change.description);
    container.append(item);
  }

  const closeButton = createMktimeButton(() => dialog.remove(), 'close');
  const dialog = new Dialog(container, [closeButton]);
  dialog.addEventListener('close', writeLastShownDate);
};
