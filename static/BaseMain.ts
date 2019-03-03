// TODO: This file probably shouldn't exist. It's a holdover from early
// spaghetti code that was extracted out to remove circular dependencies between
// modules. It's not trivial to detangle though. It's mostly reused functions
// that have to know about Threads and things like that.

import {firebase} from '../third_party/firebasejs/5.8.2/firebase-app.js';
// Sigh: We need the auth.js file to be imported after app.js, so import an
// unused dummy name to make clang-format sort it correctly. Then we need to use
// the import to keep typescript from stripping it.
import * as usedForSideEffects from '../third_party/firebasejs/5.8.2/firebase-auth.js';
usedForSideEffects;
import * as usedForSideEffects2 from '../third_party/firebasejs/5.8.2/firebase-firestore.js';
usedForSideEffects2;

import {AsyncOnce} from './AsyncOnce.js';
import {assert, notNull} from './Base.js';
import {ErrorLogger} from './ErrorLogger.js';
import {ServerStorage, StorageUpdates} from './ServerStorage.js';
import {Settings} from './Settings.js';
import {HelpDialog} from './views/HelpDialog.js';
import {SendAs} from './SendAs.js';
import {QueueNames} from './QueueNames.js';
import { AppShell } from './views/AppShell.js';

let storage_ = new ServerStorage();
let sendAs_ = new SendAs();
let settings_: Settings;

// Client ID and API key from the Developer Console
let clientId: string;
let firebaseConfig: {apiKey: string, authDomain: string, projectId: string};
let isGoogle = location.toString().includes(':8000/') ||
    location.toString().includes('https://com-mktime');

if (isGoogle) {
  firebaseConfig = {
    apiKey: 'AIzaSyCcuBNlI6FgtgiLub2ihGInrNwDc3_UZSY',
    authDomain: 'com-mktime.firebaseapp.com',
    projectId: 'google.com:mktime',
  };
  clientId =
      '800053010416-p1p6n47o6ovdm04329v9p8mskl618kuj.apps.googleusercontent.com';
} else {
  firebaseConfig = {
    apiKey: 'AIzaSyDFj2KpiXCNYnmp7VxKz5wpjJ4RquGB8qA',
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
];

// Authorization scopes required by the Google API.
let SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.google.com/m8/feeds',
  'https://www.googleapis.com/auth/calendar.readonly',
];

let isSignedIn_ = false;

export async function getSettings() {
  await login();
  return settings_;
}

export async function getSendAs() {
  await login();
  return sendAs_;
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

function redirectToSignInPage_() {
  var provider = new firebase.auth.GoogleAuthProvider();
  SCOPES.forEach(x => provider.addScope(x));
  firebase.auth().signInWithRedirect(provider);
}

let loginOnce_: AsyncOnce<void>;
let loadedGapi_ = false;

export async function login() {
  if (!loginOnce_)
    loginOnce_ = new AsyncOnce<void>(login_);
  await loginOnce_.do();
}

async function login_() {
  if (isSignedIn_)
    return;

  let progress = AppShell.updateLoaderTitle('login', 1, 'Logging in...');

  // Assert that we're not initializing firebase more than once.
  assert(!firebase.apps.length);

  try {
    await firebase.initializeApp(firebaseConfig);

    try {
      await firebase.firestore().enablePersistence(
          {experimentalTabSynchronization: true});
    } catch (e) {
      // Currently offline is only enabled for one tab at a time and also
      // doesn't work on some browsers.
      console.log(e)
    }

    // getRedirectResult triggers onIdTokenChanged, so no need to handle the
    // result, but we do need to call it.
    await firebase.auth().getRedirectResult();

    await new Promise(resolve => {
      // Use onIdTokenChanged instead of onAuthStateChanged since that captures
      // id token revocation in addition to login/logout.
      firebase.auth().onIdTokenChanged(async (user) => {
        if (user) {
          if (loadedGapi_)
            return;
          loadedGapi_ = true;
          await loadGapi();
          await gapi.client.init({
            discoveryDocs: DISCOVERY_DOCS,
            clientId: clientId,
            scope: SCOPES.join(' '),
          });

          // This returns false in multilogin scenarios. Calling
          // gapi.auth2.getAuthInstance().signIn() prompts the user to pick an
          // account.
          if (!gapi.auth2.getAuthInstance().isSignedIn.get()) {
            // @ts-ignore gapi.auth2.SigninOptions in DefinitelyTyped doesn't
            // know about ux_mode. :(
            gapi.auth2.getAuthInstance().signIn({ux_mode: 'redirect'});
            return;
          }

          await Promise.all([
            storage_.fetch(),
            sendAs_.fetch(),
            new QueueNames().fetch(),
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

          // Firebase APIs don't detect signout of google accounts. They manage
          // firebase tokens only. It's weird though, since they fire
          // onIdTokenChanged but still pass a user object as if you're still
          // signed in.
          gapi.auth2.getAuthInstance().isSignedIn.listen(
              (isSignedIn: boolean) => {
                if (!isSignedIn)
                  redirectToSignInPage_();
              });

          progress.incrementProgress();
          resolve();
        } else {
          redirectToSignInPage_();
        }
      });
    });
  } catch (e) {
    showPleaseReload();
    console.log(e);
    return;
  }
}

let firestore_: firebase.firestore.Firestore;
export function firestore() {
  if (!firestore_) {
    firestore_ = firebase.firestore();
  }
  return firestore_;
}

export function firebaseAuth() {
  return firebase.auth();
}

export function firestoreUserCollection() {
  let db = firestore();
  let uid = notNull(firebaseAuth().currentUser).uid;
  return db.collection(uid);
}

export interface FetchRequestParameters {
  userId: string;
  q: string;
  pageToken?: string;
  maxResults?: number;
  includeSpamTrash?: boolean;
}

export function showHelp() {
  new HelpDialog(`make-time is an opinionated way of handling email.

<b style='font-size:120%'>Disclaimers</b>
Make-time is built in free time and <b>makes no guarantees about quality.</b> We use it for day to day email management, but you might not want to. It has bugs. Sometimes REALLY BAD bugs.

Bugs, feature requests, and patches are very welcome. File issues, requests, random musings in the <a href='https://github.com/ojanvafai/make-time'>github repo</a>.

<b style="font-size:120%">Getting started</b> See this <a href="https://docs.google.com/presentation/d/1qwlKIQBnfDzzYdSQD-JE5cFGXiunV41uRQX0enBSoAU/edit">slide deck</a> for getting started with make-time.

<b style="font-size:120%">Keyboard shortcuts</b> Type '?' anywhere in make-time to see keyboard shortcuts.

<b style='font-size:120%'>Triage</b>
Make-time only marks messages read when you take a triage action on them. Some actions also archive the thread in gmail. Aside from bugs, maketime will only archive messages and/or mark them as read.

The goal of triage is to get in the flow of quickly prioritizing or archiving all your mail. Once triage is done, the Todo view shows your email in priority order. This helps avoid flip-flopping between quick triage and deep thinking.

<b style='font-size:120%'>Filtering</b>
Philosopy: labels are a triage tool, not a search/organization tool.

Make-time has it's own labelling and filtering system (totally independent from gmail labels). It processes all emails in your inbox. <b>Emails are only processed when MakeTime is open in a browser tab.</b> Some people choose to leave a maketime tab open (e.g. on a desktop computer) so their email is already processed when they open make-time.

The first filter that applies to a thread wins, so every thread gets exactly one label. This enables rich filtering by taking advantage of ordering, e.g. I can have emails to me from my team show up in my inbox immediately, but emails to me from others only show up once a day. See the fillter settings dialog for more information.

See the Settings dialog for adding filters and modifying queues. Queues can be setup to show up in a specific order and/or only show once a day/week/month. See the queues settings dialog for more information.

<b style='font-size:120%'>Privacy</b>
In theory we could move email processing to the server, but then we would need to store private email data on the server. make-time only stores message data and email addresses in your local browser. make-time specific data (e.g. your make-time filters) and anonymous gmail data (e.g. thread and message IDs) are stored on the make-time server.
`);
}
