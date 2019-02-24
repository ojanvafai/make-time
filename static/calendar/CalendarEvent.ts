import {assert, notNull} from '../Base.js';

import {CALENDAR_ID, TYPE_EMAIL, TYPE_FOCUS_NON_RECURRING, TYPE_FOCUS_RECURRING, TYPE_INTERVIEW, TYPE_MEETING_NON_RECURRING, TYPE_MEETING_RECURRING, TYPE_ONE_ON_ONE_NON_RECURRING, TYPE_ONE_ON_ONE_RECURRING, TYPE_OOO, TYPES,} from './Constants.js';

const OOO_REGEX = /.*(OOO|Holiday).*/;
const EMAIL_REGEX = /.*(Email).*/;
const INTERVIEW_REGEX = /.*(Interview).*/;

export class CalendarEvent {
  eventId: string;
  colorId: number|undefined;
  type: string|null;
  summary: string;
  start: Date;
  end: Date;
  duration: number;
  attendeeCount: number;
  recurringEventId: string|undefined;
  shouldIgnore: boolean;

  static async fetchEventWithId(eventId: string) {
    const response = await gapi.client.calendar.events.get({
      calendarId: CALENDAR_ID,
      eventId: eventId,
    });
    return new CalendarEvent(response.result);
  }

  getTargetColorId(): number {
    const targetColorId = TYPES.get(notNull(this.type));
    if (targetColorId === undefined)
      throw ('No color id found for type.');
    return targetColorId;
  }

  static parseDate(dateString: string): Date {
    let parts = dateString.split('T');
    parts[0] = parts[0].replace(/-/g, '/');
    return new Date(parts.join(' '));
  }

  isOOOEvent() {
    return this.summary.match(OOO_REGEX) !== null;
  }

  getShouldIgnore() {
    return this.shouldIgnore;
  }

  constructor(gcalEvent: gapi.client.calendar.Event) {
    this.eventId = gcalEvent.id;
    if (gcalEvent.colorId)
      this.colorId = TYPES.get(gcalEvent.colorId);
    this.summary = gcalEvent.summary;
    this.recurringEventId = gcalEvent.recurringEventId;
    this.shouldIgnore = gcalEvent.transparency === 'transparent' ||
        gcalEvent.guestsCanSeeOtherGuests === false || !gcalEvent.summary;

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

    if (this.attendeeCount == 0) {
      if (this.isOOOEvent())
        this.type = TYPE_OOO;
      else if (this.summary.match(INTERVIEW_REGEX) !== null) {
        this.type = TYPE_INTERVIEW;
      } else if (this.summary.match(EMAIL_REGEX) !== null)
        this.type = TYPE_EMAIL;
      else if (gcalEvent.recurringEventId !== undefined)
        this.type = TYPE_FOCUS_RECURRING;
      else
        this.type = TYPE_FOCUS_NON_RECURRING;
    } else if (this.attendeeCount == 1) {
      if (gcalEvent.recurringEventId !== undefined)
        this.type = TYPE_ONE_ON_ONE_RECURRING;
      else
        this.type = TYPE_ONE_ON_ONE_NON_RECURRING;
    } else {
      if (gcalEvent.recurringEventId !== undefined)
        this.type = TYPE_MEETING_RECURRING;
      else
        this.type = TYPE_MEETING_NON_RECURRING
    }
  }

  async setToTargetColor() {
    const targetColorId = this.getTargetColorId();
    if (targetColorId == this.colorId)
      return;

    try {
      // @ts-ignore
      const response = await gapi.client.calendar.events.patch({
        calendarId: CALENDAR_ID,
        eventId: this.eventId,
        resource: {
          colorId: targetColorId.toString(),
        }
      });
    } catch (e) {
      console.log('FAILED TO PATCH ' + this.eventId);
      console.log(this);
    }
  }
}