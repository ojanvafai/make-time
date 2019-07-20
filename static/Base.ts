import emailJsParseAddressList from '../third_party/emailjs-addressparser/addressparser.js';
import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {gapiFetch} from './Net.js';

export let USER_ID = 'me';
const MKTIME_BUTTON_CLASS = 'mktime-button';

function setupMktimeButton(button: Element, onClick?: (e: Event) => void) {
  button.classList.add(MKTIME_BUTTON_CLASS);
  if (onClick)
    button.addEventListener('click', onClick);
}

export function createMktimeButton(
    contents: string|HTMLElement, onClick?: (e: Event) => void) {
  let button = document.createElement('button');
  setupMktimeButton(button, onClick);
  button.append(contents);
  return button;
}

export function createSvgButton(
    viewBox: string, onClick: (e: Event) => void, innerHTML: string) {
  let button = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  setupMktimeButton(button, onClick);
  button.setAttribute('viewBox', viewBox);
  button.innerHTML = innerHTML;
  return button;
}

// Authorization scopes required by the Google API.
export let SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.google.com/m8/feeds',
  'https://www.googleapis.com/auth/calendar.events',
  'profile',
];

export function redirectToSignInPage() {
  var provider = new firebase.auth.GoogleAuthProvider();
  SCOPES.forEach(x => provider.addScope(x));
  firebase.auth().signInWithRedirect(provider);
}

if (!window.requestIdleCallback) {
  // @ts-ignore
  window.requestIdleCallback = window.setTimeout;
}

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
  // Set padding to 0 so that clicks the the dialog as the target always mean
  // that the click was on the backdrop. Put the padding on a wrapper element
  // instead.
  dialog.style.cssText = `
    top: 0;
    padding: 0;
    margin: 8px;
    border: 1px solid var(--border-and-hover-color);
    box-shadow: 0px 0px 6px 0px var(--border-and-hover-color);
    max-height: calc(100vh - 2px);
    max-width: 800px;
    position: fixed;
    display: flex;
    overscroll-behavior: none;
    background-color: var(--overlay-background-color);
    color: var(--text-color);
  `;
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', e => {
    if (e.target === dialog)
      dialog.close();
  });

  let wrapper = document.createElement('div');
  wrapper.style.padding = '8px';
  wrapper.append(contents);
  dialog.append(wrapper);
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

let displayName_: string;
export async function getPrimaryAccountDisplayName() {
  if (!displayName_) {
    // @ts-ignore TODO: pull in types for people api.
    let resp = await gapiFetch(gapi.client.people.people.get, {
      resourceName: 'people/me',
      personFields: 'names',
    });
    // @ts-ignore TODO: Use a proper type.
    let names: any[] = resp.result.names;
    displayName_ = names.find(x => x.metadata.primary).displayName;
  }
  return displayName_;
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

export function isMobileUserAgent() {
  return navigator.userAgent.includes(' Mobile ')
}

export function setFaviconCount(count: number) {
  // Don't update the favicon on mobile where it's not visibile in the tab
  // strip and we want the regular favicon for add to homescreen.
  if (isMobileUserAgent())
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
