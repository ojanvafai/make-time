import {
  TYPE_MEETING_RECURRING,
  TYPE_MEETING_NON_RECURRING,
  TYPE_ONE_ON_ONE_RECURRING,
  TYPE_ONE_ON_ONE_NON_RECURRING,
  TYPE_FOCUS_RECURRING,
  TYPE_FOCUS_NON_RECURRING,
  TYPE_OOO,
  TYPES,
  CALENDAR_ID,
  TYPE_EMAIL,
  TYPE_INTERVIEW,
  TYPE_UNBOOKED,
} from "./constants.js";

const OOO_REGEX = /.*(OOO|Holiday).*/;
const EMAIL_REGEX = /.*(Email).*/;
const INTERVIEW_REGEX = /.*(Interview).*/;

export class CalendarEvent {
  eventId: string;
  colorId: number;
  type: string;
  summary: string;
  start: Date;
  end: Date;
  duration: number;
  attendeeCount: number;
  recurringEventId: string;
  shouldIgnore: boolean;

  static async fetchEventWithId(eventId: string) {
    const response = await gapi.client.calendar.events.get({
      calendarId: CALENDAR_ID,
      eventId: eventId,
    });
    return new CalendarEvent(response.result);
  }

  getTargetColorId(): number {
    const targetColorId = TYPES.get(this.type)
    if (targetColorId === undefined)
      throw ("No color id found for type.")
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

  constructor(gcalEvent: any) {
    this.eventId = gcalEvent.id;
    this.colorId = gcalEvent.colorId;
    this.summary = gcalEvent.summary;
    this.recurringEventId = gcalEvent.recurringEventId;
    this.shouldIgnore =
      gcalEvent.transparency === "transparent" ||
      gcalEvent.guestsCanSeeOtherGuests === false ||
      !gcalEvent.summary;

    let attendees = gcalEvent.attendees;

    if (!attendees)
      attendees = [];

    attendees = attendees.filter(
      (attendee: any) =>
        !attendee.resource &&
        !attendee.self)

    this.attendeeCount = attendees.length;

    if (gcalEvent.attendeesOmitted)
      this.attendeeCount = Infinity;

    let start = gcalEvent.start.dateTime;
    if (!start)
      start = gcalEvent.start.date;
    this.start = CalendarEvent.parseDate(start);

    let end = gcalEvent.end.dateTime;
    if (!end)
      end = gcalEvent.end.date;
    this.end = CalendarEvent.parseDate(end);

    this.duration = this.end.getTime() - this.start.getTime();

    this.type = TYPE_UNBOOKED;

    if (this.shouldIgnore)
      return;

    // Other people scheduling me 1:1's appears to
    // always be interviews, or weird bugs in the calendar API.
    if (!gcalEvent.creator.self &&
      this.summary.match(INTERVIEW_REGEX) === null &&
      this.attendeeCount == 0) {
      console.log("IGNORING USELESS LOOKING EVENT");
      console.log(gcalEvent);
      this.shouldIgnore = true;
      return;
    }

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
    }
    else if (this.attendeeCount == 1) {
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
      console.log("FAILED TO PATCH " + this.eventId);
      console.log(this);
    }
  }
}