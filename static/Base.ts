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

export interface FetchRequestParameters {
  userId: string;
  q: string;
  pageToken?: string;
  maxResults?: number;
  includeSpamTrash?: boolean;
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

export enum Labels {
  Fallback = 'unfiltered',
  Archive = 'archive',
}

export function compareDates(a: Date, b: Date) {
  return -(a > b) || +(a < b);
}

export function setFaviconCount(count: number) {
  // Don't update the favicon on mobile where it's not visibile in the tab
  // strip and we want the regular favicon for add to homescreen.
  if (navigator.userAgent.includes(' Mobile '))
    return;

  let faviconUrl;
  if (count) {
    let canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    let ctx = notNull(canvas.getContext('2d'));

    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(24, 24, 24, 0, 2 * Math.PI);
    ctx.fill();

    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'white';
    let text = String(count);
    ctx.strokeText(text, 24, 24);
    ctx.fillText(text, 24, 24);
    faviconUrl = canvas.toDataURL();
  } else {
    faviconUrl = '/favicon.ico';
  }

  var link = document.createElement('link');
  var oldLink = document.getElementById('dynamic-favicon');
  link.id = 'dynamic-favicon';
  link.rel = 'shortcut icon';
  link.href = faviconUrl;
  if (oldLink)
    document.head.removeChild(oldLink);
  document.head.appendChild(link);
}
