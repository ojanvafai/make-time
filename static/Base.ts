import * as firebase from 'firebase/app';

import emailJsParseAddressList from '../third_party/emailjs-addressparser/addressparser.js';

import { gapiFetch } from './Net.js';

export const USER_ID = 'me';

const MKTIME_BUTTON_CLASS = 'mktime-button';

function setupMktimeButton(button: Element, onClick?: (e: Event) => void) {
  button.classList.add(MKTIME_BUTTON_CLASS);
  if (onClick) button.addEventListener('click', onClick);
}

export function createMktimeButton(
  onClick?: (e: Event) => void,
  ...contents: (string | Element)[]
) {
  let button = create('button', ...contents) as HTMLButtonElement;
  setupMktimeButton(button, onClick);
  return button;
}

export function create(tagName: string, ...contents: (string | Node)[]) {
  let node = document.createElement(tagName);
  node.append(...contents);
  return node;
}

export function createWithStyle(tagName: string, style: string, ...contents: (string | Node)[]) {
  let node = document.createElement(tagName);
  node.append(...contents);
  node.style.cssText = style;
  return node;
}

export function createLink(href: string, ...contents: (string | Node)[]) {
  let node = create('a', ...contents) as HTMLAnchorElement;
  node.href = href;
  return node;
}

export function createTh(textContent: string) {
  return create('th', textContent);
}

export function createSvg(nodeName: string, ...children: SVGElement[]) {
  let node = document.createElementNS('http://www.w3.org/2000/svg', nodeName);
  node.append(...children);
  return node;
}

export function createSvgContainer(viewBox: string, ...children: SVGElement[]) {
  let svg = createSvg('svg', ...children);
  svg.setAttribute('viewBox', viewBox);
  return svg;
}

export function createSvgButton(
  viewBox: string,
  onClick?: (e: Event) => void,
  ...children: SVGElement[]
) {
  let button = createSvgContainer(viewBox, ...children);
  setupMktimeButton(button, onClick);
  return button;
}

export function createRect(x: number, y: number, width: number, height: number) {
  let node = createSvg('rect');
  node.setAttribute('x', String(x));
  node.setAttribute('y', String(y));
  node.setAttribute('width', String(width));
  node.setAttribute('height', String(height));
  return node;
}

export function createCircle(cx: number, cy: number, r: number) {
  let node = createSvg('circle');
  node.setAttribute('cx', String(cx));
  node.setAttribute('cy', String(cy));
  node.setAttribute('r', String(r));
  return node;
}

export function createLine(x1: number, y1: number, x2: number, y2: number, strokeWidth: number) {
  let node = createSvg('line');
  node.style.cssText = `
    stroke: var(--text-color);
    stroke-linecap: round;
    stroke-width: ${strokeWidth};
  `;
  node.setAttribute('x1', String(x1));
  node.setAttribute('y1', String(y1));
  node.setAttribute('x2', String(x2));
  node.setAttribute('y2', String(y2));
  return node;
}

export function createPath(path: string) {
  let node = createSvg('path');
  node.setAttribute('d', path);
  return node;
}

export function expandArrow() {
  let arrow = collapseArrow();
  arrow.style.transform = 'rotate(270deg)';
  return arrow;
}

export function collapseArrow() {
  let one = createLine(7.5, 9, 12, 13.5, 2);
  let two = createLine(12, 13.5, 16.5, 9, 2);
  let svg = createSvgContainer('0 0 24 24', one, two);
  svg.style.height = '24px';
  return svg;
}

export function leftArrow(id: string, onClick?: (e: Event) => void) {
  let marker = createSvg('marker', createPath('M0,0 V5 L2.5,2.5 Z'));
  marker.setAttribute('id', id);
  marker.setAttribute('orient', 'auto-start-reverse');
  marker.setAttribute('markerWidth', '2.5');
  marker.setAttribute('markerHeight', '5');
  marker.setAttribute('refY', '2.5');

  let arrow = createLine(10, 12, 20, 12, 2.5);
  arrow.setAttribute('marker-start', `url(#${id})`);

  let button = createSvgContainer('0 0 24 24', createSvg('defs', marker), arrow);
  if (onClick) setupMktimeButton(button, onClick);
  return button;
}

// Forked from https://github.com/sindresorhus/linkify-urls (MIT License).
// Capture the whole URL in group 1 to keep `String#split()` support
let urlRegex: RegExp;
try {
  // Use RegExp constructor instead of parser to create the regexp so that we
  // can catch the error in Safari. Unfortunately, that means all the
  // backslashes need to be escaped.
  urlRegex = new RegExp(
    '((?<!\\+)(?:https?(?::\\/\\/))(?:www\\.)?(?:[a-zA-Z\\d-_.]+(?:(?:\\.|@)[a-zA-Z\\d]{2,})|localhost)(?:(?:[-a-zA-Z\\d:%_+.~#!?&//=@]*)(?:[,](?![\\s]))*)*)',
    'g',
  );
} catch {
  // Fallback for browser that don't support negative lookbehind.
  urlRegex = new RegExp(
    '((?:https?(?::\\/\\/))(?:www\\.)?(?:[a-zA-Z\\d-_.]+(?:(?:\\.|@)[a-zA-Z\\d]{2,})|localhost)(?:(?:[-a-zA-Z\\d:%_+.~#!?&//=@]*)(?:[,](?![\\s]))*)*)',
    'g',
  );
}

export function linkify(element: Element) {
  element.classList.add('linkified-text');

  var treeWalker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: function (node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;

        let element = node as Element;
        if (element.nodeName === 'A' && !element.hasAttribute('href'))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      },
    },
    false,
  );

  let list = [];
  while (treeWalker.nextNode()) {
    list.push(treeWalker.currentNode);
  }

  for (let item of list) {
    let text = notNull(item.textContent);
    if (!text.match(urlRegex)) continue;

    // Forked from https://github.com/sindresorhus/linkify-urls (MIT License).
    let linked = text.split(urlRegex).reduce((fragment, text, index) => {
      if (index % 2)
        // URLs are always in odd positions
        fragment.append(createLink(text, text));
      else if (text.length > 0) fragment.append(text);
      return fragment;
    }, document.createDocumentFragment());

    item.before(linked);
    notNull(item.parentNode).removeChild(item);
  }
}

let DOM_SANDBOX = document.createElement('iframe');
DOM_SANDBOX.style.display = 'none';
DOM_SANDBOX.setAttribute('sandbox', 'allow-same-origin');
document.documentElement.append(DOM_SANDBOX);

// Need to ensure that all potentially malicious DOM is created sandboxed and
// that we never innerHTML that DOM elsewhere to avoid event handlers in the
// message markup from running.
export function sandboxedDom(html: string) {
  let div = notNull(DOM_SANDBOX.contentDocument).createElement('div');
  div.innerHTML = html;
  return div;
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
  SCOPES.forEach((x) => provider.addScope(x));
  firebase.auth().signInWithRedirect(provider);
}

if (!window.requestIdleCallback) {
  // @ts-ignore
  window.requestIdleCallback = window.setTimeout;
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysSinceEpoch(timestamp?: number): number {
  const msSinceEpoch = timestamp ? new Date(timestamp).getTime() : Date.now();
  return Math.ceil(msSinceEpoch / MS_PER_DAY);
}

let ASSERT_STRING = 'This should never happen.';

export function notNull<T>(x: T | null, message?: string): T {
  if (x === null) throw new Error(message || ASSERT_STRING);
  return x;
}

export function defined<T>(x: T | undefined, message?: string): T {
  if (x === undefined) throw new Error(message || ASSERT_STRING);
  return x;
}

export function definedAndNotNull<T>(x: T | null | undefined, message?: string): T {
  if (x === null || x === undefined) throw new Error(message || ASSERT_STRING);
  return x;
}

export function assert<T>(x: T | null | undefined, message?: string): T {
  if (!x) throw new Error(message || ASSERT_STRING);
  return x;
}

export function deepEqual(a: any, b: any) {
  if (Object.is(a, b)) {
    return true;
  }

  if (a === null || a === undefined || b === null || b === undefined) {
    return false;
  }

  // If either one is an object then we can go down the object comparison
  // codepath.
  if (typeof a === 'object') {
    const aEntries = Object.entries(a);
    if (aEntries.length !== Object.entries(b).length) {
      return false;
    }
    for (let aEntry of aEntries) {
      if (!deepEqual(aEntry[1], b[aEntry[0]])) {
        return false;
      }
    }
    return true;
  }
  return false;
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
    ((date.getTime() - januaryFirst.getTime()) / msInDay + januaryFirst.getDay()) / 7,
  );
}

let myEmail_: string;
export async function getMyEmail() {
  if (!myEmail_) {
    let response = await gapiFetch(gapi.client.gmail.users.getProfile, {
      userId: USER_ID,
    });
    myEmail_ = assert(
      response.result.emailAddress,
      `This google account doesn't have an associated email address.`,
    );
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
    displayName_ = names.find((x) => x.metadata.primary).displayName;
  }
  return displayName_;
}

export interface ParsedAddress {
  name: string;
  address: string;
}

// TODO: Make all the callers handle groups properly. For now just flatten
// groups and pretend they don't exist.
export function parseAddressList(addresses: string) {
  let parsed = emailJsParseAddressList(addresses);
  return parsed.flatMap((x) => x.group || x);
}

export function serializeAddress(address: ParsedAddress) {
  if (address.address === '' || address.name === '') return address.address || address.name;
  let name = address.name.includes(',') ? `"${address.name}"` : address.name;
  return `${name} <${address.address}>`;
}

export enum Labels {
  Fallback = 'unfiltered',
  Archive = 'archive',
  Instant = 'instant',
  Daily = 'daily',
  Weekly = 'weekly',
  Monthly = 'monthly',
}

export function compareDates(a: Date, b: Date) {
  return -(a > b) || +(a < b);
}

export function isMobileUserAgent() {
  return navigator.userAgent.includes(' Mobile');
}

export function isSafari() {
  return (
    !navigator.userAgent.includes('AppleWebKit/537.36') &&
    navigator.userAgent.includes('AppleWebKit/')
  );
}

export function stopInProgressScroll() {
  window.scrollTo(window.scrollX, window.scrollY);
}

export function setFaviconCount(count: number) {
  // Don't update the favicon on mobile where it's not visibile in the tab
  // strip and we want the regular favicon for add to homescreen.
  if (isMobileUserAgent()) return;

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
  if (oldLink) document.head.removeChild(oldLink);
  document.head.appendChild(link);
}
