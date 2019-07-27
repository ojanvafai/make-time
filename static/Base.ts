import emailJsParseAddressList from '../third_party/emailjs-addressparser/addressparser.js';
import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';

import {gapiFetch} from './Net.js';

export const USER_ID = 'me';
export const DOWN_ARROW_VIEW_BOX = '0 0 24 24';
export const DOWN_ARROW_SVG =
    `<path d="M 12 3 C 11.448 3 11 3.448 11 4 L 11 17.070312 L 7.1367188 13.207031 C 6.7457187 12.816031 6.1126563 12.816031 5.7226562 13.207031 L 5.6367188 13.292969 C 5.2457187 13.683969 5.2457187 14.317031 5.6367188 14.707031 L 11.292969 20.363281 C 11.683969 20.754281 12.317031 20.754281 12.707031 20.363281 L 18.363281 14.707031 C 18.754281 14.316031 18.754281 13.682969 18.363281 13.292969 L 18.277344 13.207031 C 17.886344 12.816031 17.253281 12.816031 16.863281 13.207031 L 13 17.070312 L 13 4 C 13 3.448 12.552 3 12 3 z"></path>`;

const MKTIME_BUTTON_CLASS = 'mktime-button';

function setupMktimeButton(button: Element, onClick?: (e: Event) => void) {
  button.classList.add(MKTIME_BUTTON_CLASS);
  if (onClick)
    button.addEventListener('click', onClick);
}

export function createMktimeButton(
    onClick?: (e: Event) => void, ...contents: (string|Element)[]) {
  let button = document.createElement('button');
  setupMktimeButton(button, onClick);
  button.append(...contents);
  return button;
}

export function createSvg(viewBox: string, innerHTML: string) {
  let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.innerHTML = innerHTML;
  return svg;
}

export function createSvgButton(
    viewBox: string, onClick: (e: Event) => void, innerHTML: string) {
  let button = createSvg(viewBox, innerHTML);
  setupMktimeButton(button, onClick);
  return button;
}

function createArrow(innerHTML: string) {
  let svg = createSvg('0 0 24 24', innerHTML);
  svg.style.height = '24px';
  return svg;
}
export function collapseArrow() {
  return createArrow(
      `<path d="M12,9.929l3.821,3.821c0.414,0.414,1.086,0.414,1.5,0l0,0c0.414-0.414,0.414-1.086,0-1.5l-4.614-4.614 c-0.391-0.391-1.024-0.391-1.414,0L6.679,12.25c-0.414,0.414-0.414,1.086,0,1.5l0,0c0.414,0.414,1.086,0.414,1.5,0L12,9.929z"></path>`);
}

export function expandArrow() {
  return createArrow(
      `<path d="M12,14.071L8.179,10.25c-0.414-0.414-1.086-0.414-1.5,0l0,0c-0.414,0.414-0.414,1.086,0,1.5l4.614,4.614 c0.391,0.391,1.024,0.391,1.414,0l4.614-4.614c0.414-0.414,0.414-1.086,0-1.5v0c-0.414-0.414-1.086-0.414-1.5,0L12,14.071z"></path>`);
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
    margin: 8px auto;
    border: 1px solid var(--border-and-hover-color);
    box-shadow: 0px 0px 6px 0px var(--border-and-hover-color);
    max-height: calc(100vh - 2px);
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
  wrapper.style.cssText = `
    display: flex;
    padding: 8px;
  `;
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
