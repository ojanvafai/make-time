import {createMktimeButton} from '../Base.js';
import {Dialog} from '../Dialog.js';

interface Entry {
  date: string, description: string;
}

const CHANGES: Entry[] = [
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

export function renderChangeLog() {
  // TODO: Store this in firestore so it syncs across devices
  const lastShownChangelogEntryDate =
      window.localStorage.lastShownChangelogEntryDate;
  let changes = CHANGES;
  if (lastShownChangelogEntryDate) {
    const lastShownDate = new Date(lastShownChangelogEntryDate);
    changes = CHANGES.filter(x => new Date(x.date) > lastShownDate);
    console.log(changes);
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
    let item = document.createElement('li');
    item.append(change.description);
    container.append(item);
  }

  const closeButton = createMktimeButton(() => dialog.remove(), 'close');
  const dialog = new Dialog(container, [closeButton]);
  dialog.addEventListener(
      'close',
      () => window.localStorage.lastShownChangelogEntryDate = changes[0].date);
};
