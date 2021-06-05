import 'firebase/auth';
import 'firebase/firestore';
// This should come before the firebase imports above, but esbuild makes it not
// necessary and clang-format refuses to allow sorting it correctly.
import * as firebase from 'firebase/app';

import { AppShell } from './views/AppShell.js';
import { Dialog } from './Dialog.js';
import { assert, createMktimeButton, notNull, USER_ID } from './Base.js';
import { gapiFetch } from './Net.js';
import { SCOPES, DISCOVERY_DOCS, clientId, apiKey } from './Config.js';

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

function redirectToSignInPage() {
  var provider = new firebase.auth.GoogleAuthProvider();
  SCOPES.forEach((x) => provider.addScope(x));
  firebase.auth().signInWithRedirect(provider);
}

function loadGapi() {
  return new Promise((resolve) => {
    gapi.load('client:auth2', () => resolve());
  });
}

// From https://firebase.google.com/docs/auth/web/google-signin. Unlike that
// code we redirect to the login page instead of signing in with the googleUser
// credentials since the latter can only be done in a popup.
function isUserEqual(googleUser: gapi.auth2.GoogleUser, firebaseUser: firebase.User | null) {
  if (firebaseUser) {
    var providerData = firebaseUser.providerData;
    for (var i = 0; i < providerData.length; i++) {
      let data = notNull(providerData[i]);
      if (
        data.providerId === firebase.auth.GoogleAuthProvider.PROVIDER_ID &&
        data.uid === googleUser.getBasicProfile().getId()
      ) {
        // We don't need to reauth the Firebase connection.
        return true;
      }
    }
  }
  return false;
}

async function currentGapiUser() {
  if (gapi.auth2 && (await gapi.auth2.getAuthInstance().isSignedIn.get())) {
    return gapi.auth2.getAuthInstance().currentUser.get();
  }
  return null;
}

async function loginToGapi() {
  await loadGapi();
  await gapi.client.init({
    apiKey,
    discoveryDocs: DISCOVERY_DOCS,
    clientId,
    scope: SCOPES.join(' '),
  });

  return (
    (await currentGapiUser()) ??
    (await gapi.auth2
      .getAuthInstance()
      .signIn({ ux_mode: 'redirect', redirect_uri: window.location.origin }))
  );
}

let loginDialog_: Dialog | null;

function showLoggedOutDialog(showErrorText: boolean) {
  if (loginDialog_) {
    return;
  }
  let container = document.createElement('div');
  container.append(
    showErrorText
      ? `Something went wrong loading MakeTime and you need to reload. This usually happens if you're not connected to the internet when loading MakeTime or get logged out.`
      : 'You have been logged out.',
  );
  loginDialog_ = new Dialog({
    contents: container,
    buttons: [
      createMktimeButton(() => attemptLogin(), 'Try to reconnect'),
      createMktimeButton(() => redirectToSignInPage(), 'Go to login page'),
    ],
    preventManualClosing: true,
  });
}

export async function attemptLogin() {
  // skiplogin=1 is just to do some performance testing of compose view on
  // webpagetest without having it redirect to the google login page
  if (window.location.search.includes('skiplogin=1')) {
    return;
  }

  try {
    let progress = AppShell.updateLoaderTitle('login', 1, 'Logging in...');
    let googleUser = (await currentGapiUser()) || (await loginToGapi());

    await new Promise((resolve) => {
      let unsubscribe = firebase.auth().onAuthStateChanged(async (firebaseUser) => {
        unsubscribe();

        if (!firebaseUser || !isUserEqual(googleUser, firebaseUser)) {
          showLoggedOutDialog(false);
          return;
        }

        loginDialog_?.remove();
        loginDialog_ = null;
        progress.incrementProgress();

        resolve();
      });
    });
  } catch (e) {
    showLoggedOutDialog(true);
    console.log(e);
    return;
  }
}
