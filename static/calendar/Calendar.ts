import {AsyncOnce} from '../AsyncOnce.js';
import {defined, notNull} from '../Base.js';
import {login} from '../BaseMain.js';
import {Model} from '../models/Model.js';
import {TaskQueue} from '../TaskQueue.js'

import {Aggregate} from './Aggregate.js'
import {CalendarEvent} from './CalendarEvent.js'
import {CALENDAR_ID, TYPE_UNBOOKED_LARGE, TYPE_UNBOOKED_MEDIUM, TYPE_UNBOOKED_SMALL, TYPES, WORKING_DAY_END, WORKING_DAY_START} from './Constants.js'

const SMALL_DURATION_MINS = 30;
const MEDIUM_DURATION_MINS = 60;

function getStartOfWeek(date: Date): Date {
  const x = new Date(date);
  x.setHours(0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function getDurationOverlappingWorkDay(start: Date, end: Date, day: Date) {
  const startOfDay = new Date(day);
  startOfDay.setHours(WORKING_DAY_START, 0, 0);
  const endOfDay = new Date(day);
  endOfDay.setHours(WORKING_DAY_END, 0, 0);
  const startTime = Math.max(startOfDay.getTime(), start.getTime());
  const endTime = Math.min(endOfDay.getTime(), end.getTime());

  // No overlap.
  if (endTime - startTime < 0)
    return 0;
  return endTime - startTime;
}

function aggregateByWeek(aggregates: Aggregate[]) {
  const weekly: Aggregate[] = [];
  let currentWeekStart = getStartOfWeek(aggregates[0].start);
  let minutesPerType: Map<string, number> = new Map();

  for (let aggregate of aggregates) {
    const aggregateWeekStart = getStartOfWeek(aggregate.start);
    if (aggregateWeekStart.getTime() != currentWeekStart.getTime()) {
      weekly.push(new Aggregate(new Date(currentWeekStart), minutesPerType));
      minutesPerType = new Map();
      currentWeekStart = aggregateWeekStart;
    }
    for (let type of TYPES.keys()) {
      if (!minutesPerType.has(type))
        minutesPerType.set(type, 0);

      let aggregateValue = aggregate.minutesPerType.get(type);
      if (!aggregateValue)
        aggregateValue = 0;

      minutesPerType.set(type, minutesPerType.get(type)! + aggregateValue);
    }
  }
  weekly.push(new Aggregate(new Date(currentWeekStart), minutesPerType));
  return weekly;
}

function eventsToAggregates(events: CalendarEvent[]): Aggregate[] {
  enum EVENT_CHANGE {
    EVENT_START,
    EVENT_END,
    EVENT_WORKDAY,
  }

  interface EventChange {
    ts: Date, type: EVENT_CHANGE, event: CalendarEvent|null,
  }

  const eventChanges: EventChange[] = [];
  for (let event of events) {
    eventChanges.push(
        {ts: event.start, type: EVENT_CHANGE.EVENT_START, event: event});
    eventChanges.push({
      ts: new Date(event.start.getTime() + event.duration),
      type: EVENT_CHANGE.EVENT_END,
      event: event,
    });
  }

  function sortEvents(a: CalendarEvent, b: CalendarEvent) {
    return a.start.getTime() - b.start.getTime();
  }

  function sortEventChanges(a: EventChange, b: EventChange) {
    return a.ts.getTime() - b.ts.getTime();
  }
  // TODO - eliminate multiple sorts.
  eventChanges.sort(sortEventChanges)

  // Insert event changes at the beginning and end of the work
  // day. Needed for multi-day events to work.
  const firstDay = new Date(events[0].start);
  const lastDay = new Date(events[events.length - 1].start);

  let minutesPerType: Map<string, number>;

  let addDuration = (type: string, duration: number) => {
    if (!minutesPerType.has(type)) {
      minutesPerType.set(type, 0);
    }
    minutesPerType.set(type, defined(minutesPerType.get(type)) + duration);
  };

  let addUnbookedDuration = (durationMs: number) => {
    if (durationMs <= 0)
      return;
    let unbookedDuration = durationMs / 60 / 1000;
    if (unbookedDuration < SMALL_DURATION_MINS)
      addDuration(TYPE_UNBOOKED_SMALL, unbookedDuration);
    else if (unbookedDuration < MEDIUM_DURATION_MINS)
      addDuration(TYPE_UNBOOKED_MEDIUM, unbookedDuration);
    else
      addDuration(TYPE_UNBOOKED_LARGE, unbookedDuration);
  };

  let getMinutesPerType = (day: Date) => {
    let cloned = new Date(day);
    cloned.setHours(0, 0, 0);
    return minutesMap.get(cloned.getTime());
  };

  let minutesMap = new Map();
  let setMinutesPerType = (day: Date) => {
    minutesPerType = getMinutesPerType(day);
    if (!minutesPerType) {
      minutesPerType = new Map();
      let cloned = new Date(day);
      cloned.setHours(0, 0, 0);
      minutesMap.set(cloned.getTime(), minutesPerType);
    }
  };

  let currentDay = new Date(events[0].start);
  currentDay.setHours(WORKING_DAY_START, 0, 0);
  let unbookedStart = currentDay;
  setMinutesPerType(currentDay);

  events.sort(sortEvents);
  for (let event of events) {
    if (event.end < unbookedStart)
      continue;

    // Skip to the end of the event for events that span multiple days since
    // we're just looking for unbooked time.
    const tsDay = new Date(event.end);
    tsDay.setHours(WORKING_DAY_START, 0, 0);
    if (tsDay.getTime() != currentDay.getTime()) {
      currentDay.setHours(WORKING_DAY_END, 0, 0);
      let end = (event.start < currentDay) ? event.start : currentDay;
      let duration = getDurationOverlappingWorkDay(unbookedStart, end, end);
      addUnbookedDuration(duration);
      currentDay = tsDay;
      unbookedStart = tsDay;
      setMinutesPerType(currentDay);
    }

    let start = event.start;
    if (unbookedStart.getTime() < start.getTime()) {
      let duration = getDurationOverlappingWorkDay(unbookedStart, start, start);
      addUnbookedDuration(duration);
    }
    unbookedStart = event.end;
  }

  currentDay.setHours(WORKING_DAY_END, 0, 0);
  let duration =
      getDurationOverlappingWorkDay(unbookedStart, currentDay, currentDay);
  addUnbookedDuration(duration);

  const WHOLE_DAY_DURATION_MS =
      60 * 60 * 1000 * (WORKING_DAY_END - WORKING_DAY_START);
  // TODO - insert a change at the beginning and end of each day
  // and handle empty event change regions.
  for (const curDay = firstDay; curDay.getTime() <= lastDay.getTime();
       curDay.setDate(curDay.getDate() + 1)) {
    const dayStart = new Date(curDay);
    dayStart.setHours(WORKING_DAY_START, 0, 0);
    const dayEnd = new Date(curDay);
    dayEnd.setHours(WORKING_DAY_END, 0, 0);

    eventChanges.push(
        {ts: dayStart, type: EVENT_CHANGE.EVENT_WORKDAY, event: null})
    eventChanges.push(
        {ts: dayEnd, type: EVENT_CHANGE.EVENT_WORKDAY, event: null})
  }

  eventChanges.sort(sortEventChanges)

  const day = new Date(events[0].start);
  day.setHours(0, 0, 0);

  const aggregates: Aggregate[] = [];
  const inProgressEvents: Set<CalendarEvent> = new Set();
  let ts = day;

  setMinutesPerType(day);
  for (let eventChange of eventChanges) {
    let primaryInProgressEvents = Array.from(inProgressEvents);
    // OOO events take priority.
    const ooo = primaryInProgressEvents.filter(e => e.isOOOEvent());
    if (ooo.length !== 0) {
      primaryInProgressEvents = ooo;
    } else {
      // Otherwise, prioritize short events.
      const minInProgressDuration =
          primaryInProgressEvents.reduce((min, event) => {
            return Math.min(event.duration, min);
          }, Infinity);

      primaryInProgressEvents = primaryInProgressEvents.filter(
          event => {return event.duration == minInProgressDuration})
    }
    const durationMinutes =
        getDurationOverlappingWorkDay(ts, eventChange.ts, day) / 60 / 1000;

    for (let inProgressEvent of primaryInProgressEvents) {
      addDuration(
          notNull(inProgressEvent.type),
          durationMinutes / primaryInProgressEvents.length);
    }

    if (eventChange.type == EVENT_CHANGE.EVENT_START) {
      if (eventChange.event === null)
        throw ('Event start with null event.');
      inProgressEvents.add(eventChange.event);
    } else if (eventChange.type == EVENT_CHANGE.EVENT_END) {
      if (eventChange.event === null)
        throw ('Event end with null event.');
      inProgressEvents.delete(eventChange.event);
    }

    ts = eventChange.ts;
    const tsDay = new Date(ts);
    tsDay.setHours(0, 0, 0);
    if (tsDay.getTime() != day.getTime()) {
      if (day.getDay() != 0 && day.getDay() != 6) {
        // If there are no events on this day, then consider the whole day
        // unbooked.
        if (!minutesPerType!.size)
          addUnbookedDuration(WHOLE_DAY_DURATION_MS);
        aggregates.push(new Aggregate(new Date(day), minutesPerType!));
      }
      day.setDate(day.getDate() + 1);
      setMinutesPerType(day);
    }
  }

  return aggregates;
}

export class Calendar extends Model {
  private events: CalendarEvent[] = [];
  private dayAggregates: AsyncOnce<Aggregate[]>;
  private weekAggregates: AsyncOnce<Aggregate[]>;

  private fetchingEvents: boolean = true;
  private onReceiveEventsChunkResolves: ((cs: CalendarEvent[]) => void)[] = [];

  constructor() {
    super();

    this.dayAggregates = new AsyncOnce<Aggregate[]>(async () => {
      const events = [];
      // TODO - is there any easier way to convert an async iterable into an
      // array?
      for await (let event of this.getEvents())
        events.push(event);
      return eventsToAggregates(events);
    });
    this.weekAggregates = new AsyncOnce<Aggregate[]>(async () => {
      let dayAggregates = await this.dayAggregates.do();
      return aggregateByWeek(dayAggregates);
    });
  }

  getDayAggregates(): Promise<Aggregate[]> {
    if (this.dayAggregates === null)
      throw ('dayAggregates should never be null');
    return new Promise(resolve => resolve(this.dayAggregates.do()));
  }

  getWeekAggregates(): Promise<Aggregate[]> {
    if (this.weekAggregates === null)
      throw ('weekAggregates should never be null');
    return new Promise(resolve => resolve(this.weekAggregates.do()));
  }

  gotEventsChunk(events: CalendarEvent[]) {
    this.events = this.events.concat(events);
    for (const resolve of this.onReceiveEventsChunkResolves) {
      resolve(events);
    }
  }

  getEventsChunk(): Promise<CalendarEvent[]>{return new Promise((resolve) => {
    this.onReceiveEventsChunkResolves.push(resolve);
  })}

  async fetchEvents() {
    let weeks = 26;
    let days = weeks * 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    let pageToken = null;
    let pendingEvents: CalendarEvent[] = [];

    while (true) {
      const request = {
        calendarId: CALENDAR_ID,
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        showDeleted: false,
        singleEvents: true,
        maxResults: 2500,  // Max is 2500.
        orderBy: 'startTime' as 'startTime',
        pageToken: undefined as string | undefined,
      };
      if (pageToken)
        request.pageToken = pageToken;

      let response = await gapi.client.calendar.events.list(request);

      pendingEvents = response.result.items.map(i => new CalendarEvent(i))
                          .filter(e => !e.getShouldIgnore());

      this.gotEventsChunk(pendingEvents);

      pageToken = response.result.nextPageToken;
      if (!pageToken)
        break;
    }
    this.events.sort((a, b) => a.start.getTime() - b.start.getTime());
    this.fetchingEvents = false;
  }

  async colorizeEvents() {
    const taskQueue = new TaskQueue(3);
    for await (const event of this.getEvents()) {
      taskQueue.queueTask(() => event.setToTargetColor());
    };
  }

  async init() {
    await login();
    await this.fetchEvents();
  }

  async * getEvents() {
    for (const event of this.events)
      yield event;

    while (true) {
      if (!this.fetchingEvents)
        return;
      let events: CalendarEvent[] = await this.getEventsChunk();
      for (const event of events)
        yield event;
    }
  }
}