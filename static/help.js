let helpHtml_;

function showHelp(settings) {
  let contents = document.createElement('div');
  contents.style.overflow = 'auto';
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

  let spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit`;

  helpHtml_ = `make-time is an opinionated way of handling unreasonable amounts of email. Patches welcome, but otherwise, I built it for me and it does what I want. :) Feature requests are totally welcome though. Maybe you'll think of something I want that I don't have. Contact ojan@ if you want to contribute, give feedback, etc.

<span style="color: red">This is a side project. While I completely rely on it for my day to day email management, you might not want to. It has bugs. They may be hard to deal with if you're not willing to dig into the code when they happen. Did I mention patches welcome? :)</span>

There are two aspects to make-time: <b>triage</b> and <b>filtering</b>.

All the triage actions mark a thread as read, remove it from the inbox, and remove the maketime labels. <b>Aside from archiving messages (and bugs), maketime will only ever modify labels under the "maketime" parent label.</b> So you can do whatever you want with other labels.

<b style="font-size:120%">Triage</b>
The goal of triage is to get in the flow of doing all the triage quickly and then followup and do the real work of replying, action items, etc. instead of flip-flopping back and forth between quick triage and deep thinking.

Triage is done in four phases:
<ol style="margin: 0">
<li><b>Bulk triage</b> Do a quick triage over just subject lines.
<li><b>Thread at a time</b> Go through email by email and take a quick action. Each action is a quick keyboard shortcut or a length-limited reply. After each action, the next thread is immediately shown. There's also an optional, configurable countdown timer (play button) to force you to take action on each thread quickly.
<li><b>Prioritization</b> prioritize each thread so you can do the time consuming work for each thread in priority order. This should take <5 minutes once you get the hand of it.
<li><b>Make time</b> Now work through each thread in priority order.
<ul style="margin:0">
<li>TL;DR for reading longer threads
<li>NeedsReply for threads that need a reply from you
<li>ActionItem for threads that need some action from you other than a reply.
</ul></ol>
<b style="font-size:120%">Filtering</b>

Philosopy: Labels are a triage tool, not a search/organization tool. The goal is to have all your labels and inbox be empty when you're done with triage. Every thread has exactly one filter that applies to it (i.e. gets exactly one label). This is achieved by having filters be first one wins. A nice side effect of this is that you can do richer filtering by taking advantage of ordering, e.g. I can have emails to me from my team show up in my inbox immediately, but emails to me from others only show up once a day. See the fillter settings dialog for more information.

Filtering is technically optional and requires more setup (e.g. moving your gmail filters into make-time), but some of the more interesting features like queues. Queus can be setup to show up in a specific order and/or only show once a day/week/month. See the queues settings dialog for more information.

<b>To setup filtering:</b><ol style="margin: 0"><li>(optional, but recommended) Delete all your filters in gmail. If this is scary, you can export your old filters to an XML file first through the GMail web interface. Go to Settings > Filtered and Blocked Addresses, check the ""select all"" checkbox, then click the ""Export"" button."
<li>Create one real gmail filter:
    Matches: -in:chats -label:mute -from:me
    Do this: Skip Inbox, Apply label "maketime/unprocessed"

If there are emails you don't want make-time to do anything with, modify your gmail filter with appropriate things like "to:(-YOURNAME+pager@google.com)"
<li>Fill in the filters the filter editor in the settings dialog.</a>.
</ol>
<span style="color: red">Emails are only processed when make-time is open in a browser tab. Otherwise, your mail will stay in the unprocessed label. Would love to move this to a server cron, but this is a side project and I can't be bothered to figure out how to manage server-side gmail API oauth. <b>Patches *very* welcome for this.</b></span>
`;

  return helpHtml_;
};
