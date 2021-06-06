// TODO: This file needs a better name. It's the foundational things like
// firebase and settings that belong in main.js, but we don't want the circular
// dependencies of main depending on things, which in turn depend on main.

import 'firebase/auth';
import 'firebase/firestore';
// This should come before the firebase imports above, but esbuild makes it not
// necessary and clang-format refuses to allow sorting it correctly.
import * as firebase from 'firebase/app';
import { notNull, create, createWithStyle, createLink, assert } from './Base';
import { AsyncOnce } from './AsyncOnce';
import { attemptLogin } from './Login';
import { StorageUpdates, ServerStorage } from './ServerStorage';
import { QueueNames } from './QueueNames';
import { Settings } from './Settings';
import { HelpDialog } from './views/HelpDialog';
import { firebaseConfig } from './Config';

let storage_ = new ServerStorage();
let settings_: Settings;
let loginOnce_: AsyncOnce<void>;
let firestore_: firebase.firestore.Firestore;

export async function initialLogin() {
  if (!loginOnce_) {
    loginOnce_ = new AsyncOnce<void>(async () => {
      // Ensure that we're not initializing firebase more than once.
      assert(!firebase.apps.length);
      await firebase.initializeApp(firebaseConfig);
      await enablePersistence();
      await attemptLogin();
      await initializeStorage();
    });
  }
  await loginOnce_.do();
}

async function enablePersistence() {
  try {
    await firebase.firestore().enablePersistence({ synchronizeTabs: true });
  } catch (e) {
    // Currently offline is only enabled for one tab at a time and also
    // doesn't work on some browsers.
    console.log(e);
  }
}

export async function getSettings() {
  await initialLogin();
  return settings_;
}

// Intentionally don't fetch here so that the onload sequence can listen to
// events on ServerStorage without forcing a login.
export async function getServerStorage() {
  return storage_;
}

async function initializeStorage() {
  await Promise.all([storage_.fetch(), QueueNames.create().fetch()]);

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

export function firestore() {
  if (!firestore_) {
    firestore_ = firebase.firestore();
  }
  return firestore_;
}

export function firebaseAuth() {
  return firebase.auth();
}

const newIdToLegacyId: { [property: string]: string } = {
  IXqAy9z163RP3E6xlUtRaiCIGu02: 'x4mf0jrcFzSHUrysfe0lmNCorBW2',
};

export function firestoreUserCollection() {
  let db = firestore();
  let uid = notNull(firebaseAuth().currentUser).uid;
  return db.collection(newIdToLegacyId[uid] || uid);
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
      'p',
      'Make-time is built in free time and ',
      create('b', 'makes no guarantees about quality'),
      '. We use it for day to day email management, but you might not want to. It has bugs.',
    ),
    create(
      'p',
      'Bugs, feature requests, and patches are very welcome. File issues, requests, random musings in the ',
      createLink('https://github.com/ojanvafai/make-time', 'github repo'),
      '.',
    ),

    createWithStyle('b', headingStyle, 'Getting started'),
    create(
      'p',
      'See this ',
      createLink(
        'https://docs.google.com/presentation/d/1qwlKIQBnfDzzYdSQD-JE5cFGXiunV41uRQX0enBSoAU/edit',
        'slide deck',
      ),
      ' for getting started with make-time.',
    ),

    createWithStyle('b', headingStyle, 'Keyboard shortcuts'),
    create('p', `Type '?' anywhere in make-time to see keyboard shortcuts.`),

    createWithStyle('b', headingStyle, 'Triage'),
    create(
      'p',
      `Make-time only marks messages read in gmail when you take a triage action on them. Some actions also archive the thread in gmail. Aside from bugs, make-time will only archive messages and/or mark them as read.`,
    ),
    create(
      'p',
      `The goal of triage is to get in the flow of quickly prioritizing or archiving all your mail. Once triage is done, you are left with your email in priority order. This helps avoid flip-flopping between quick triage and deep thinking.`,
    ),

    createWithStyle('b', headingStyle, 'Filtering'),
    create('p', `Philosopy: labels are a triage tool, not a search/organization tool.`),
    create(
      'p',
      `Make-time has it's own labeling and filtering system (totally independent from gmail labels). It processes all emails in your inbox. `,
      create('b', `Emails are only processed when MakeTime is open in a browser tab. `),
      `Some people choose to leave a make-time tab open (e.g. on a desktop computer) so their email is already processed when they open make-time.`,
    ),
    create(
      'p',
      `The first filter that applies to a thread wins, so every thread gets exactly one label. This enables rich filtering by taking advantage of ordering, e.g. I can have emails to me from my team show up in my inbox immediately, but emails to me from others only show up once a day. See the filter settings dialog for more information.`,
    ),
    create(
      'p',
      `See the Settings dialog for adding filters and modifying queues. Queues can be setup to show up in a specific order and/or only show once a day/week/month. See the queues settings dialog for more information.`,
    ),

    createWithStyle('b', headingStyle, 'Privacy'),
    create(
      'p',
      `In theory we could move email processing to the server, but then we would need to store private email data on the server. make-time only stores message data and email addresses in your local browser. make-time specific data (e.g. your make-time filters) and anonymous gmail data (e.g. thread and message IDs) are stored on the make-time server.`,
    ),
  ];

  new HelpDialog(...HELP_TEXT);
}
