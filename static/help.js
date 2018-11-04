import { showDialog } from './main.js';

let helpHtml_;

export function showHelp(settings) {
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

  helpHtml_ = `make-time is an opinionated way of handling unreasonable amounts of email.

<b style="font-size:120%">Disclaimers</b>
Patches welcome, but otherwise, I built it for my needs. :) Feature requests are very welcome though. Often you'll think of something I want that I don't have and I'll build it. Contact ojan@ or file issues at https://github.com/ojanvafai/make-time if you want to contribute, give feedback, etc.

<span style="color: red">This is a side project. While I use it for my day to day email management, you might not want to. It has bugs.</span> They may be hard to deal with if you're not willing to dig into the code when they happen.

<b style="font-size:120%">Triage</b>

All the triage actions mark a thread as read, remove it from the inbox, and remove the maketime labels. <b>Aside from archiving messages (and bugs), maketime will only modify labels under the "maketime" parent label.</b> So you can do whatever you want with other labels.

The goal of triage is to get in the flow of doing all the triage quickly. After triage is done, you enter make-time mode where you work through each thread in priority order. This helps avoid flip-flopping back and forth between quick triage and deep thinking.

<b style="font-size:120%">Filtering</b>

Philosopy: Labels are a triage tool, not a search/organization tool. The goal is to have all your labels and inbox be empty when you're done with triage. The first filter that applies to a thread wins, so every thread gets exactly one label. This enables richer filtering by taking advantage of ordering, e.g. I can have emails to me from my team show up in my inbox immediately, but emails to me from others only show up once a day. See the fillter settings dialog for more information.

Make-time processes all emails in your inbox and all emails in the maketime/unprocessed label. You don't have to, but typically, people will delete all their gmail filters and just use make-time filtering. See the Settings dialog for adding filters and modifying queues. Queues can be setup to show up in a specific order and/or only show once a day/week/month. See the queues settings dialog for more information.

Whether you leave emails in your inbox by default or moved them into the unprocessed label so you don't see them in in gmail itself till they've been processed is up to you. If you want all your mail to be unprocessed by default, create a real gmail filter with:
    Has the words: -in:chats -label:mute -from:me
    Do this: Skip Inbox, Apply label "maketime/unprocessed"

<span style="color: red">Emails are only processed when make-time is open in a browser tab. Otherwise, your mail will stay in the unprocessed label. Would love to move this to a server cron, but this is a side project and I can't be bothered to figure out how to manage server-side gmail API oauth. <b>Patches *very* welcome for this.</b></span>
`;

  return helpHtml_;
};
