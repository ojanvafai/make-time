export let apiKey: string;
export let clientId: string;
export let firebaseConfig: { apiKey: string; authDomain: string; projectId: string };
let isGoogle =
  location.toString().includes(':8000/') || location.toString().startsWith('https://com-mktime');

if (isGoogle) {
  apiKey = 'AIzaSyCcuBNlI6FgtgiLub2ihGInrNwDc3_UZSY';
  firebaseConfig = {
    apiKey,
    authDomain: 'com-mktime.firebaseapp.com',
    projectId: 'google.com:mktime',
  };
  clientId = '800053010416-p1p6n47o6ovdm04329v9p8mskl618kuj.apps.googleusercontent.com';
} else {
  apiKey = 'AIzaSyDNUVmcTxYTdm14mI4A4EWgIet6694Hx7Y';
  firebaseConfig = {
    apiKey,
    authDomain: 'mk-time-2.web.app',
    projectId: 'mk-time-2',
  };
  clientId = '760935821606-j39mvmrjo1oa46plf526a9plu0iq3kpg.apps.googleusercontent.com';
}

// Array of API discovery doc URLs for APIs used by the quickstart
export let DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest',
  'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
  'https://people.googleapis.com/$discovery/rest?version=v1',
];

// Authorization scopes required by the Google API.
export let SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'profile',
];
