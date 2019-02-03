import emailJsParseAddressList from '../third_party/emailjs-addressparser/addressparser.js';
import {gapiFetch} from './Net.js';

export let USER_ID = 'me';

let ASSERT_STRING = 'This should never happen.';

export function notNull<T>(x: T|null, message?: string): T {
  if (x === null)
    throw new Error(message || ASSERT_STRING);
  return x;
}

export function defined<T>(x: T|undefined, message?: string): T {
  if (x === undefined)
    throw new Error(message || ASSERT_STRING);
  return x;
}

export function definedAndNotNull<T>(x: T|null|undefined, message?: string): T {
  if (x === null || x === undefined)
    throw new Error(message || ASSERT_STRING);
  return x;
}

export function assert<T>(x: T|null|undefined, message?: string): T {
  if (!x)
    throw new Error(message || ASSERT_STRING);
  return x;
}

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
    myEmail_ = assert(
        response.result.emailAddress,
        `This google account doesn't have an associated email address.`);
    ;
  }
  return myEmail_;
}

export interface ParsedAddress {
  name: string, address: string,
}

// TODO: Delete this one AddressCompose no longer uses it.
// Parse "user@foo.com" and "User Name <user@foo.com>".
export function parseAddress(address: string) {
  let trimmed = address.trim();
  let out: ParsedAddress = {
    name: '',
    address: trimmed,
  }

  let split = trimmed.split('<');
  if (split.length == 1)
    return out;

  let email = defined(split.pop());
  // Strip the trailing '>'.
  if (email.charAt(email.length - 1) == '>')
    email = email.substring(0, email.length - 1);
  out.address = email.trim();

  // Can there be multiple '<' in an email address, e.g. can there be a '<' in
  // the name?
  out.name = split.join('<').trim();
  return out;
}

// TODO: Make all the callers handle groups properly. For now just flatten
// groups and pretend they don't exist.
export function parseAddressList(addresses: string) {
  let parsed = emailJsParseAddressList(addresses);
  return parsed.flatMap(x => x.group || x);
}

export function serializeAddress(address: ParsedAddress) {
  if (address.address === '' || address.name === '')
    return address.address || address.name;
  let name = address.name.includes(',') ? `"${address.name}"` : address.name;
  return `${name} <${address.address}>`;
}

export function getDefinitelyExistsElementById(id: string) {
  return notNull(document.getElementById(id));
}
