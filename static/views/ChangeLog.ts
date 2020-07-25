import {createMktimeButton, showDialog} from '../Base.js';

interface Entry {
  date: string, isMajorChange: boolean, description: string;
}

const CHANGES: Entry[] = [
  {
    date: '7/22/20',
    isMajorChange: true,
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
    container.append(change.description);
  }

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'flex justify-end';
  buttonContainer.append(createMktimeButton(() => dialog.close(), 'close'));
  container.append(buttonContainer);

  const dialog = showDialog(container);
  dialog.addEventListener(
      'close',
      () => window.localStorage.lastShownChangelogEntryDate = changes[0].date);
};
