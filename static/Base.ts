import {gapiFetch} from './Net.js';

export let USER_ID = 'me';

export function getCurrentWeekNumber() {
  return getWeekNumber(new Date());
}

export function getPreviousWeekNumber() {
  let date = new Date();
  date.setDate(date.getDate() - 7);
  return getWeekNumber(date);
}

function getWeekNumber(date: Date) {
  var januaryFirst = new Date(date.getFullYear(), 0, 1);
  var msInDay = 86400000;
  return Math.ceil(
      (((date.getTime() - januaryFirst.getTime()) / msInDay) +
       januaryFirst.getDay()) /
      7);
}

export function showDialog(contents: HTMLElement|string) {
  let dialog = document.createElement('dialog');
  // Subtract out the top/bottom, padding and border from the max-height.
  dialog.style.cssText = `
    top: 15px;
    padding: 8px;
    border: 3px solid grey;
    max-height: calc(100vh - 30px - 16px - 6px);
    max-width: 800px;
    position: fixed;
    display: flex;
    overscroll-behavior: none;
  `;
  dialog.addEventListener('close', () => dialog.remove());

  dialog.append(contents);
  document.body.append(dialog);

  dialog.showModal();
  return dialog;
}

let myEmail_: string;
export async function getMyEmail() {
  if (!myEmail_) {
    let response = await gapiFetch(gapi.client.gmail.users.getProfile, {
      'userId': USER_ID,
    });
    myEmail_ = response.result.emailAddress;
  }
  return myEmail_;
}

export interface ParsedAddress {
  name?: string, email: string
}

// Parse "user@foo.com" and "User Name <user@foo.com>".
export function parseAddress(address: string) {
  let trimmed = address.trim();
  let out: ParsedAddress = {
    name: '',
    email: trimmed,
  }

  let split = trimmed.split('<');
  if (split.length == 1)
    return out;

  let email = split.pop();
  if (email === undefined)
    throw 'This should never happen';
  // Strip the trailing '>'.
  if (email.charAt(email.length - 1) == '>')
    email = email.substring(0, email.length - 1);
  out.email = email.trim();

  // Can there be multiple '<' in an email address, e.g. can there be a '<' in
  // the name?
  out.name = split.join('<').trim();
  return out;
}

export function serializeAddress(address: ParsedAddress) {
  if (address.name)
    return `${address.name} <${address.email}>`;
  return address.email;
}

export function getDefinitelyExistsElementById(id: string) {
  let element = document.getElementById(id);
  if (!element)
    throw 'This should never happen.';
  return element;
}
