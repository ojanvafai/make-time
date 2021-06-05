export let apiKey: string;
export let clientId: string;
export let firebaseConfig: { apiKey: string; authDomain: string; projectId: string };
let isGoogle =
  location.toString().includes(':8000/') || location.toString().includes('https://com-mktime');

if (isGoogle) {
  apiKey = 'AIzaSyCcuBNlI6FgtgiLub2ihGInrNwDc3_UZSY';
  firebaseConfig = {
    apiKey,
    authDomain: 'com-mktime.firebaseapp.com',
    projectId: 'google.com:mktime',
  };
  clientId = '800053010416-p1p6n47o6ovdm04329v9p8mskl618kuj.apps.googleusercontent.com';
} else {
  apiKey = 'AIzaSyDFj2KpiXCNYnmp7VxKz5wpjJ4RquGB8qA';
  firebaseConfig = {
    apiKey,
    authDomain: 'mk-time.firebaseapp.com',
    projectId: 'mk-time',
  };
  clientId = '475495334695-0i3hbt50i5lj8blad3j7bj8j4fco8edo.apps.googleusercontent.com';
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
  'https://www.google.com/m8/feeds',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'profile',
];
