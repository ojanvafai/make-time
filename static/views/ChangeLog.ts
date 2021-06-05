import { createMktimeButton } from '../Base.js';
import { Dialog } from '../Dialog.js';

interface Entry {
  date: string;
  description: string;
}

const CHANGES: Entry[] = [
  {
    date: '6/5/21',
    description: `- Attempt to fix login so you don't get logged out after being away for a while.
- Allow manual sorting of threads to override sorting unread threads to the top.`,
  },
  {
    date: '5/2/21',
    description: `- Add filter action now opens a modal instead of an inline UX
- enable the add filter action in todo view for unfiltered threads
- right align labels in the untriages view
- Disable buttons instead of eliding them so that the toolbar doesn't move around depending on what actions are available`,
  },
  {
    date: '4/25/21',
    description: `Added a quick triage view. Quick triage shows email threads as unscrollable cards. It shows you the first and last messages in the thread only, and it only lets you take 4 hard coded triage actions denoted by the arrow keys. That way you can rapidly do those triage actions with muscle memory. The todo view keyboard shortcuts will work on this page as well even though that's not shown in the UI in case you have muscle memory around them.
    
For now, the old triage UI is still there, but may be removed depending on our experience with it in the wild. So let me know if you care about this. In the meantime there's now a setting to hide the old triage UI and just have the link to quick triage at the top of todo view to play with what it would look like to only have quick triage.

Unfiltered handling has also be rolled into quick triage. Unfiltered was always a bit unweildy as it was and the forced filtering was excessively opinionated. For unfiltered threads, quick triage shows a "Filter" button that gives the familiar filtering UI. There's still some clear room for improvement here, but it's much less invasive at least. Will prioritize fixing things based off feedback.

Eventually planning to:
- Show a stack of cards so you can see how much you have left to triage.
- Make swipe on mobile do the same behaviors as the arrow keys.
- In todo view, show the untriaged threads if there are <3 threads and only show the link to quick triage if there are >=3. Basically, if there are only a couple threads, then quick triage can be more nuisance than benefit. This might be a good middle ground between totally deleting the old triage UI like the current setting does vs the current behavior of showing both that is clearly too cluttered.
- Make the action for each of the directions configurable. For now, I just picked the ones that seemed most convenient. Feedback welcome on what set you'd prefer. If it's different from this, that might motivate making it configurable sooner rather than later.

As always, experiences, ideas, feedback welcome.`,
  },
  {
    date: '8/9/20',
    description: `Added the backend for note to self. In the process identified and fixed a number of bugs in syncing labels to gmail.`,
  },
  {
    date: '8/9/20',
    description: `Fixed taking a triage action after sending a message in compose view.`,
  },
  {
    date: '8/9/20',
    description: `Fixed assorted rendering bugs in the unfiltered view.`,
  },
  {
    date: '7/30/20',
    description: `Make confirm prompt for deleting a rule in the filter settings inline rather than a popup.`,
  },
  {
    date: '7/30/20',
    description: `Restrict the width of rendered messages to target <100 characters for better readability.`,
  },
  {
    date: '7/29/20',
    description: `Added a setting to have mktime push labels and priorities to gmail as gmail labels. This lets you have a backup of the critical mktime content in gmail and also lets you cope better when mktime is down for some reason.

label/priority are only sent from mktime to gmail, not the other way around. So changing a label or priority in gmail will cause it to get out of sync with what label/priority mktime thinks it has until you modify the thread in mktime again.

This code is hot off the presses and mostly rewrites the existing code for sending updates from mktime to gmail, so speak up if there are bugs in the next few days.
`,
  },
  {
    date: '7/25/20',
    description: `Pinned threads now have a pin icon to indicate they are pinned.`,
  },
  {
    date: '7/25/20',
    description: `Add recently modified view to Hidden tab for seeing the last 50 threads you took an action on. Helpful for when you accidentally triage something and can't get back to it with undo.`,
  },
  {
    date: '7/25/20',
    description: `Added a send button to quick reply and changed the send keyboard shortcut from enter to cmd+enter.`,
  },
  {
    date: '7/25/20',
    description: `Added "Redact messages" to Settings for doing demos without showing the whole world your inbox.`,
  },
  {
    date: '7/22/20',
    description: `Moved unfiltered threads to a dedicated view. In the main Todo view they render as a single card a the top you can click on to go to the view. It shows the names of the senders so you can see if you need to deal with filters or not. 

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
  const lastShownChangelogEntryDate = window.localStorage.lastShownChangelogEntryDate;
  // If this is a new user, then there won't be a last shown date and we don't
  // want to show them a changelog anyways.
  if (lastShownChangelogEntryDate === undefined) {
    writeLastShownDate();
    return;
  }
  let changes = CHANGES;
  if (lastShownChangelogEntryDate) {
    const lastShownDate = new Date(lastShownChangelogEntryDate);
    changes = CHANGES.filter((x) => new Date(x.date) > lastShownDate);
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
  const dialog = new Dialog({contents: container, buttons:  [closeButton]});
  dialog.addEventListener('close', writeLastShownDate);
}
