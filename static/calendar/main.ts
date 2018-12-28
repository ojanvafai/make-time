
import { Charter } from './charter.js';
import { Calendar } from './calendar.js';
import { CLIENT_ID, API_KEY } from './constants.js'

// Array of API discovery doc URLs for APIs used by the quickstart
const DISCOVERY_DOCS = [
    "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
    "https://sheets.googleapis.com/$discovery/rest?version=v4",
];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
const SCOPES = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/spreadsheets";

class Main {
    authorizeButton: HTMLElement;
    signoutButton: HTMLElement;
    calendar: Calendar;

    async main() {
        this.calendar.init();
        const charter = new Charter();
        await charter.init();
        const days = await this.calendar.getDayAggregates();
        const weeks = await this.calendar.getWeekAggregates();
        charter.chartData(days, "day_plot");
        charter.chartData(weeks, "week_plot");
    }

    constructor() {
        this.calendar = new Calendar();

        let authorizeButtonNullable = document.getElementById('authorize_button');
        if (authorizeButtonNullable == null)
            throw ('No authorize button found.')
        this.authorizeButton = authorizeButtonNullable;
        let signoutButtonNullable = document.getElementById('signout_button');
        if (signoutButtonNullable == null)
            throw ('No signout button found.')
        this.signoutButton = signoutButtonNullable;
    }

    /**
    *  On load, called to load the auth2 library and API client library.
    */
    auth() {
        gapi.load('client:auth2', this.initClient.bind(this));

        let colorizeEventsButton = document.getElementById('colorize_events_button');
        if (colorizeEventsButton === null)
            throw ("No colorize events button found.")
        colorizeEventsButton.addEventListener("click", () => {
            this.calendar.colorizeEvents();
        });
    }

    /**
    *  Initializes the API client library and sets up sign-in state
    *  listeners.
    */
    initClient() {
        gapi.client.init({
            apiKey: API_KEY,
            clientId: CLIENT_ID,
            discoveryDocs: DISCOVERY_DOCS,
            scope: SCOPES
        }).then(() => {
            // Listen for sign-in state changes.
            gapi.auth2.getAuthInstance().isSignedIn.listen(this.updateSigninStatus);

            // Handle the initial sign-in state.
            this.updateSigninStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
            this.authorizeButton.onclick = handleAuthClick;
            this.signoutButton.onclick = handleSignoutClick;
        }, function (error: Error) {
            console.log(JSON.stringify(error, null, 2));
        });
    }

    /**
    *  Called when the signed in status changes, to update the UI
    *  appropriately. After a sign-in, the API is called.
    */
    async updateSigninStatus(isSignedIn: boolean) {
        if (isSignedIn) {
            this.authorizeButton.style.display = 'none';
            this.signoutButton.style.display = 'block';

            this.main();
        } else {
            this.authorizeButton.style.display = 'block';
            this.signoutButton.style.display = 'none';
        }
    }
}

new Main().auth();

/**
 *  Sign in the user upon button click.
 */
function handleAuthClick() {
    gapi.auth2.getAuthInstance().signIn();
}

/**
 *  Sign out the user upon button click.
 */
function handleSignoutClick() {
    gapi.auth2.getAuthInstance().signOut();
}