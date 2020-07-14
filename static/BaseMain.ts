// TODO: This file probably shouldn't exist. It's a holdover from early
// spaghetti code that was extracted out to remove circular dependencies between
// modules. It's not trivial to detangle though. It's mostly reused functions
// that have to know about Threads and things like that.

import * as firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';

import { AsyncOnce } from './AsyncOnce.js';
import { assert, create, createLink, createWithStyle, notNull, redirectToSignInPage, SCOPES } from './Base.js';
import { ErrorLogger } from './ErrorLogger.js';
import { QueueNames } from './QueueNames.js';
import { ServerStorage, StorageUpdates } from './ServerStorage.js';
import { Settings } from './Settings.js';
import { AppShell } from './views/AppShell.js';
import { HelpDialog } from './views/HelpDialog.js';

// Gross hack to prevent typescript from stripping the firebase import since we
// always use it as window.firebase.
if (false)
  console.log(firebase);

let storage_ = new ServerStorage();
let settings_: Settings;

// Client ID and API key from the Developer Console
let apiKey: string;
let clientId: string;
let firebaseConfig: { apiKey: string, authDomain: string, projectId: string };
let isGoogle = location.toString().includes(':8000/') ||
  location.toString().includes('https://com-mktime');

if (isGoogle) {
  apiKey = 'AIzaSyCcuBNlI6FgtgiLub2ihGInrNwDc3_UZSY';
  firebaseConfig = {
    apiKey,
    authDomain: 'com-mktime.firebaseapp.com',
    projectId: 'google.com:mktime',
  };
  clientId =
    '800053010416-p1p6n47o6ovdm04329v9p8mskl618kuj.apps.googleusercontent.com';
} else {
  apiKey = 'AIzaSyDFj2KpiXCNYnmp7VxKz5wpjJ4RquGB8qA';
  firebaseConfig = {
    apiKey,
    authDomain: 'mk-time.firebaseapp.com',
    projectId: 'mk-time',
  };
  clientId =
    '475495334695-0i3hbt50i5lj8blad3j7bj8j4fco8edo.apps.googleusercontent.com';
}

// Array of API discovery doc URLs for APIs used by the quickstart
let DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest',
  'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
  'https://people.googleapis.com/$discovery/rest?version=v1',
];

let isSignedIn_ = false;

export async function getSettings() {
  await login();
  return settings_;
}

// Intentionally don't fetch here so that the onload sequence can listen to
// events on ServerStorage without forcing a login.
export async function getServerStorage() {
  return storage_;
}

function showPleaseReload() {
  ErrorLogger.log(
    `Something went wrong loading MakeTime and you need to reload. This usually happens if you're not connected to the internet when loading MakeTime.`);
}

function loadGapi() {
  return new Promise((resolve) => {
    gapi.load('client:auth2', () => resolve());
  });
};

let loginOnce_: AsyncOnce<void>;

export async function login() {
  if (!loginOnce_)
    loginOnce_ = new AsyncOnce<void>(login_);
  await loginOnce_.do();
}

// From https://firebase.google.com/docs/auth/web/google-signin. Unlike that
// code we redirect to the login page instead of signing in with the googleUser
// credentials since the latter can only be done in a popup.
function isUserEqual(
  googleUser: gapi.auth2.GoogleUser, firebaseUser: firebase.User | null) {
  if (firebaseUser) {
    var providerData = firebaseUser.providerData;
    for (var i = 0; i < providerData.length; i++) {
      let data = notNull(providerData[i]);
      if (data.providerId ===
        window.firebase.auth.GoogleAuthProvider.PROVIDER_ID &&
        data.uid === googleUser.getBasicProfile().getId()) {
        // We don't need to reauth the Firebase connection.
        return true;
      }
    }
  }
  return false;
}

async function login_() {
  // skiplogin=1 is just to do some performance testing of compose view on
  // webpagetest without having it redirect to the google login page
  if (isSignedIn_ || window.location.search.includes('skiplogin=1'))
    return;

  // Ensure that we're not initializing firebase more than once.
  assert(!window.firebase.apps.length);

  try {
    let progress = AppShell.updateLoaderTitle('login', 1, 'Logging in...');
    let googleUser = await loginToGapi();
    await window.firebase.initializeApp(firebaseConfig);
    await enablePersistence();

    await new Promise(resolve => {
      let unsubscribe =
        window.firebase.auth().onAuthStateChanged(async (firebaseUser) => {
          unsubscribe();

          if (!firebaseUser || !isUserEqual(googleUser, firebaseUser))
            redirectToSignInPage();

          // Do this before fetching data out of firestore to make the app
          // feel faster by hiding the login text sooner.
          progress.incrementProgress();

          await initializeStorage();
          resolve();
        });
    });
  } catch (e) {
    showPleaseReload();
    console.log(e);
    return;
  }
}

async function loginToGapi() {
  await loadGapi();
  await gapi.client.init({
    apiKey,
    discoveryDocs: DISCOVERY_DOCS,
    clientId: clientId,
    scope: SCOPES.join(' '),
  });

  if (await gapi.auth2.getAuthInstance().isSignedIn.get())
    return gapi.auth2.getAuthInstance().currentUser.get();
  return await gapi.auth2.getAuthInstance().signIn(
    // @ts-ignore ux_mode isn't in the types for this method.
    { ux_mode: 'redirect', redirect_uri: window.location.origin });
}

async function enablePersistence() {
  try {
    await window.firebase.firestore().enablePersistence(
      { synchronizeTabs: true });
  } catch (e) {
    // Currently offline is only enabled for one tab at a time and also
    // doesn't work on some browsers.
    console.log(e)
  }
}

async function initializeStorage() {
  await Promise.all([
    storage_.fetch(),
    QueueNames.create().fetch(),
  ]);

  // This has to happen after storage_.fetch().
  settings_ = new Settings(storage_);
  await settings_.fetch();

  if (!storage_.get(ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN)) {
    await showHelp();
    let updates: StorageUpdates = {};
    updates[ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN] = true;
    storage_.writeUpdates(updates);
  }
}

let firestore_: firebase.firestore.Firestore;
export function firestore() {
  if (!firestore_) {
    firestore_ = window.firebase.firestore();
  }
  return firestore_;
}

export function firebaseAuth() {
  return window.firebase.auth();
}

export function firestoreUserCollection() {
  let db = firestore();
  let uid = notNull(firebaseAuth().currentUser).uid;
  return db.collection(uid);
}

export function showHelp() {
  let headingStyle = `
    font-weight: bold;
    font-size: 120%;
  `;

  let HELP_TEXT = [

    create('p', 'make-time is an opinionated way of handling email.'),

    createWithStyle('b', headingStyle, 'Disclaimers'),
    create(
      'p', 'Make-time is built in free time and ',
      create('b', 'makes no guarantees about quality'),
      '. We use it for day to day email management, but you might not want to. It has bugs.'),
    create(
      'p',
      'Bugs, feature requests, and patches are very welcome. File issues, requests, random musings in the ',
      createLink('https://github.com/ojanvafai/make-time', 'github repo'),
      '.'),

    createWithStyle('b', headingStyle, 'Getting started'),
    create(
      'p', 'See this ',
      createLink(
        'https://docs.google.com/presentation/d/1qwlKIQBnfDzzYdSQD-JE5cFGXiunV41uRQX0enBSoAU/edit',
        'slide deck'),
      ' for getting started with make-time.'),

    createWithStyle('b', headingStyle, 'Keyboard shortcuts'),
    create('p', `Type '?' anywhere in make-time to see keyboard shortcuts.`),

    createWithStyle('b', headingStyle, 'Triage'),
    create(
      'p',
      `Make-time only marks messages read in gmail when you take a triage action on them. Some actions also archive the thread in gmail. Aside from bugs, make-time will only archive messages and/or mark them as read.`),
    create(
      'p',
      `The goal of triage is to get in the flow of quickly prioritizing or archiving all your mail. Once triage is done, you are left with your email in priority order. This helps avoid flip-flopping between quick triage and deep thinking.`),

    createWithStyle('b', headingStyle, 'Filtering'),
    create(
      'p',
      `Philosopy: labels are a triage tool, not a search/organization tool.`),
    create(
      'p',
      `Make-time has it's own labeling and filtering system (totally independent from gmail labels). It processes all emails in your inbox. `,
      create(
        'b',
        `Emails are only processed when MakeTime is open in a browser tab. `),
      `Some people choose to leave a make-time tab open (e.g. on a desktop computer) so their email is already processed when they open make-time.`),
    create(
      'p',
      `The first filter that applies to a thread wins, so every thread gets exactly one label. This enables rich filtering by taking advantage of ordering, e.g. I can have emails to me from my team show up in my inbox immediately, but emails to me from others only show up once a day. See the filter settings dialog for more information.`),
    create(
      'p',
      `See the Settings dialog for adding filters and modifying queues. Queues can be setup to show up in a specific order and/or only show once a day/week/month. See the queues settings dialog for more information.`),

    createWithStyle('b', headingStyle, 'Privacy'),
    create(
      'p',
      `In theory we could move email processing to the server, but then we would need to store private email data on the server. make-time only stores message data and email addresses in your local browser. make-time specific data (e.g. your make-time filters) and anonymous gmail data (e.g. thread and message IDs) are stored on the make-time server.`)

  ];

  new HelpDialog(...HELP_TEXT);
}
