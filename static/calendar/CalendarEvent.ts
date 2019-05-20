import {assert, defined} from '../Base.js';
import {ANY_TITLE, AttendeeCount, CalendarRule, Frequency, stringFilterMatches} from '../Settings.js';

import {EventType,} from './Constants.js';

// TODO: Add help UI for no room view in TriageModel and explain this there.
export let NO_ROOM_NEEDED = 'no room needed';

export class CalendarEvent {
  eventId: string;
  colorId?: number;
  type: EventType|null;
  summary: string;
  start: Date;
  end: Date;
  duration: number;
  attendeeCount: number;
  // TODO: Figure out why typescript doesn't know about
  // gapi.client.calendar.Event
  attendees?: any[];  // gapi.client.calendar.Event.attendees[];
  location?: string;
  editUrl: string;
  recurringEventId?: string;
  shouldIgnore: boolean;
  status?: 'confirmed'|'tentative'|'cancelled';

  static parseDate(dateString: string): Date {
    let parts = dateString.split('T');
    parts[0] = parts[0].replace(/-/g, '/');
    return new Date(parts.join(' '));
  }

  constructor(
      public gcalEvent: gapi.client.calendar.Event, rules: CalendarRule[]) {
    this.eventId = gcalEvent.id;
    this.status = gcalEvent.status;
    if (gcalEvent.colorId)
      this.colorId = Number(gcalEvent.colorId);
    this.summary = gcalEvent.summary;
    this.attendees = gcalEvent.attendees;
    this.location = gcalEvent.location;
    this.recurringEventId = gcalEvent.recurringEventId;
    this.shouldIgnore = gcalEvent.transparency === 'transparent' ||
        gcalEvent.guestsCanSeeOtherGuests === false || !gcalEvent.summary;

    // TODO: Uncomment the replace below once the calendar bug is fixed where
    // going directly to the event page doesn't show the rooms.
    this.editUrl = gcalEvent.htmlLink;
    // this.editUrl = event.htmlLink.replace('event?eid=', 'r/eventedit/');

    // Ignore events I've declined.
    if (!this.shouldIgnore && gcalEvent.attendees) {
      let iAmAttending = gcalEvent.attendees.some(
          x => x.self && x.responseStatus !== 'declined');
      this.shouldIgnore = !iAmAttending;
    }

    this.attendeeCount = gcalEvent.attendees ?
        gcalEvent.attendees.filter(x => !x.resource && !x.self).length :
        0;

    if (gcalEvent.attendeesOmitted)
      this.attendeeCount = Infinity;

    let start = gcalEvent.start.dateTime;
    if (!start)
      start = gcalEvent.start.date;
    start = assert(start, 'Got a calendar entry with no start date.');
    this.start = CalendarEvent.parseDate(start);

    let end = gcalEvent.end.dateTime;
    if (!end)
      end = gcalEvent.end.date;
    end = assert(end, 'Got a calendar entry with no end date.');
    this.end = CalendarEvent.parseDate(end);

    this.duration = this.end.getTime() - this.start.getTime();

    this.type = null;

    if (this.shouldIgnore)
      return;

    for (let rule of rules) {
      if (this.ruleMatches_(rule)) {
        this.type = rule.label as EventType;
        break;
      }
    }
  }

  getShouldIgnore() {
    return this.shouldIgnore;
  }

  needsLocalRoom(offices: string[]) {
    if (this.shouldIgnore || !this.attendeeCount || !offices.length)
      return false;

    if (this.location && this.location.toLowerCase().includes(NO_ROOM_NEEDED))
      return false;

    let attendees = assert(this.attendees);
    let hasLocalRoom = attendees.some(
        x => x.resource && x.responseStatus === 'accepted' &&
            offices.some(y => defined(x.displayName).includes(y)));

    // For BIG meetings where rooms aren't visible as guests. Only do this
    // if there are no meeting rooms at all since the location field is
    // often out of date.
    if (!hasLocalRoom && !attendees.some(x => x.resource))
      hasLocalRoom = offices.some(y => defined(this.location).includes(y));

    return !hasLocalRoom;
  }

  ruleMatches_(rule: CalendarRule) {
    let matches = false;
    if (rule.title !== ANY_TITLE) {
      if (!stringFilterMatches(rule.title, this.summary))
        return false;
      matches = true;
    }

    switch (rule.attendees) {
      case AttendeeCount.Any:
        matches = true;
        break;

      case AttendeeCount.Many:
        if (this.attendeeCount <= 1)
          return false;
        matches = true;
        break;

      case AttendeeCount.None:
        if (this.attendeeCount !== 0)
          return false;
        matches = true;
        break;

      case AttendeeCount.One:
        if (this.attendeeCount !== 1)
          return false;
        matches = true;
        break;

      case undefined:
        break;

      default:
        throw new Error();
    }

    switch (rule.frequency) {
      case Frequency.Either:
        matches = true;
        break;

      case Frequency.Recurring:
        if (this.recurringEventId === undefined)
          return false;
        matches = true;
        break;

      case Frequency.NotRecurring:
        if (this.recurringEventId !== undefined)
          return false;
        matches = true;
        break;

      case undefined:
        break;

      default:
        throw new Error();
    }

    return matches;
  }
}