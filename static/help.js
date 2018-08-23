let helpHtml_;

function showHelp(settings) {
  let contents = document.createElement('div');
  contents.innerHTML = helpText(settings);
  let dialog = showDialog(contents);
  dialog.style.whiteSpace = 'pre-wrap';

  let closeButton = document.createElement('div');
  closeButton.classList.add('close-button');
  closeButton.style.cssText = `
    float: right;
    position: sticky;
    top: 0;
    background-color: white;
    padding-left: 10px;
  `;
  closeButton.onclick = () => dialog.close();
  contents.prepend(closeButton);

  return new Promise((resolve, reject) => {
    dialog.addEventListener('close', resolve);
  });
}

function helpText(settings) {
  if (helpHtml_)
    return helpHtml_;

  let buttons = ``;
  for (let key in ThreadView.ACTIONS) {
    let button = ThreadView.ACTIONS[key];
    buttons += ` - <b>${button.name}:</b> ${button.description}\n`;
  }

  let spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit`;

  helpHtml_ = `make-time is an opinionated way of handling unreasonable amounts of email. Patches welcome, but otherwise, I built it for me and it does what I want. :) Feature requests are totally welcome though. Maybe you'll think of something I want that I don't have, e.g. that's how we got quick reply. Contact ojan@ if you want to contribute, give feedback, etc.

<span style="color: red">This is a side project. While I completely rely on it for my day to day email management, you might not want to. It has bugs. They may be hard to deal with if you're not willing to dig into the code when they happen. Did I mention patches welcome? :)</span>

There are two aspects to make-time: <b>triage</b> and <b>filtering</b>. Filtering is technically optional and requires more setup (e.g. moving your gmail filters into a spreadsheet), but the triage generally assumes the filtering. For example, it will only show threads in your inbox that either have no labels or that have run through make-time's filtering. So, if you don't setup filtering, make-time will only show threads in the inbox with no labels.

All the triage actions will mark a thread as read, remove it from the inbox, and remove the current label. If there are multiple labels, it will only remove one of them. The filtering is built in such a way that every thread gets exactly one label, so the two play nicely together. Once it's triaged, it's completely out of your face.

<b style="font-size:120%">Triage</b>
The goal of triage is to do get in the flow of doing all the triage quickly and then followup and do the real work of replying, action items, etc. instead of flip-flopping back and forth between quick triage and deep thinking.

<b>Triage phase 1:</b> Do a quick triage over just subject lines.

<b>Triage phase 2:</b> Go through email by email and take a quick action. Each action is a quick keyboard shortcut or a length-limited reply. After each action, the next thread is immediately shown. There's also an optional, configurable countdown timer (play button) to force you to take action on each thread quickly.

<b>Done with triage:</b> You're now left with clear queues to do actual work.
 - TL;DR for reading longer threads
 - NeedsReply For threads that need a reply from you
 - ActionItem For threads that need some action from you other than a reply.

Actions:
${buttons}
<b style="font-size:120%">Filtering</b>

Philosopy: Labels are a triage tool, not a search/organization tool. The goal is to have all your labels and inbox be empty when you're done with triage.

<b>To setup filtering:</b><ol style="margin: 0"><li>Click the "Settings" link in the top-right corner.
<li>(optional, but recommended) Delete all your filters in gmail. If this is scary, you can export your old filters to an XML file first through the GMail web interface. Go to Settings > Filtered and Blocked Addresses, check the ""select all"" checkbox, then click the ""Export"" button."
<li>Populate the filters in your <a href=${spreadsheetUrl}>backend spreadsheet</a>.
<li>Setup exactly one gmail filter:
    Matches: -in:chats -label:mute -from:me
    Do this: Skip Inbox, Apply label "unprocessed"

If there are emails you don't want make-time to do anything with, modify your gmail filter with appropriate things like "to:(-YOURNAME+pager@google.com)"
</ol>
<span style="color: red">The big gotcha with filtering and queue bundles, is that emails are only processed when make-time is open in a browser tab. Otherwise, your mail will stay in the unprocessed label. Would love to move this to a server cron, but this is a side project and I can't be bothered to figure out how to manage server-side gmail API oauth. <b>Patches *very* welcome for this.</b></span>

<b>First one wins:</b> To facilitate this, every thread has exactly one filter that applies to it (i.e. gets exactly one label). The filter can apply a label, or archive it (put "archive" as the label). This is achieved by having filters be first one wins instead of gmail's filtering where all filters apply. A nice side effect of this is that you can do richer filtering by taking advantage of ordering, e.g. I can have emails to me from my team show up in my inbox immediately, but emails to me from others only show up once a day.

<b>Checks all messages:</b> Gmail filters match only the newly incoming message. make-time matches all messages in the thread each time the thread is processed.

<b>Queues:</b> You can then setup individual labels so they only show once a day, week, or month on a day of your choosing. For example, I have emails to me from my reports, management chain, or select TLs/PMs I work with show up immediately. All other emails are queued to either be daily (to me or one of my primary project's lists), weekly (to lists I need to pay attention to and sometimes reply to) or monthly (to lists I need to keep abrest of but basically never need to reply to). And if it's not something I need to pay attention to, but occasionally need to search for, then its just archived immediately.

There's a nice synergy between queues and triaging. The more urgent queues will always get triaged first (e.g. daily before weekly). If you care about more granular control of triage order within one of those groups (e.g. the different daily queues), you can also name your labels appropriately as they're triaged in alphabetical order.

<b>Assorted filtering notes:</b>
 - If there's a bug, by default emails will either stay in the "unprocessed" folder or be moved to your inbox (depends on the failure mode).
 - Hide the labels you never want to see with the gmail label UI, for example "labeler", "unprocessed"
`;

  return helpHtml_;
};
