export interface CalendarSortData {
  color: string;
  index: number;
}

export interface CalendarSortListEntry {
  label: EventType;
  data: CalendarSortData;
}

export interface AllCalendarSortDatas {
  [property: string]: CalendarSortData;
}

export enum EventType {
  MeetingRecurring = 'Recurring meeting',
  MeetingNonRecurring = 'Non-recurring meeting',
  OneOnOneRecurring = 'Recurring one on one',
  OneOnOneNonRecurring = 'Non-recurring one on one',
  FocusRecurring = 'Recurring focus block',
  FocusNonRecurring = 'Non-recurring focus block',
  UnbookedSmall = 'Unbooked time (<= 30m)',
  UnbookedMedium = 'Unbooked time (30m-60m)',
  UnbookedLarge = 'Unbooked time (> 60m)',
  OutOfOffice = 'OOO',
  Email = 'Email',
  Interview = 'Interview',
}

export const UNBOOKED_TYPES = [
  EventType.UnbookedSmall, EventType.UnbookedMedium, EventType.UnbookedLarge
];

// Event types that don't count against the total of time considered booked.
// TYPE_OOO is excluded here because it's special and doesn't count as
// booked or unbooked.
export const ME_TIME_TYPES = [
  EventType.FocusRecurring,
  EventType.FocusNonRecurring,
  ...UNBOOKED_TYPES,
];

export const CALENDAR_ID = 'primary';

export const WORKING_DAY_START = 9;
export const WORKING_DAY_END = 17;

// Apparently these are the only allowed colors for events via the API. The
// human readable names come from
// https://developers.google.com/apps-script/reference/calendar/event-color.
// Don't reorder. The order of these needs to match what Calendar API returns!
export const CALENDAR_ALLOWED_COLORS: {[property: string]: string} = {
  'Pale Blue': '#a4bdfc',
  'Pale Green': '#7ae7bf',
  'Mauve': '#dbadff',
  'Pale Red': '#ff887c',
  'Yellow': '#fbd75b',
  'Orange': '#ffb878',
  'Cyan': '#46d6db',
  'Gray': '#e1e1e1',
  'Blue': '#5484ed',
  'Green': '#51b749',
  'Red': '#dc2127',
};

export const CALENDAR_HEX_COLORS = Object.values(CALENDAR_ALLOWED_COLORS);

export const DEFAULT_CALENDAR_DATA: AllCalendarSortDatas = {};

function addData(type: EventType, color: string, index: number) {
  DEFAULT_CALENDAR_DATA[type] = {
    color: CALENDAR_ALLOWED_COLORS[color] || color,
    index: index,
  };
};

addData(EventType.MeetingRecurring, 'Pale Blue', 12);
addData(EventType.MeetingNonRecurring, 'Blue', 11);
addData(EventType.OneOnOneRecurring, 'Pale Green', 10);
addData(EventType.OneOnOneNonRecurring, 'Green', 9);
addData(EventType.FocusRecurring, 'Pale Red', 8);
addData(EventType.FocusNonRecurring, 'Red', 7);
addData(EventType.Email, 'Mauve', 6);
addData(EventType.Interview, 'Orange', 5);
addData(EventType.OutOfOffice, 'Gray', 1);

// Unbooked times don't need to be restricted to calendar supported colors since
// there's no events we'll ever need to color. Use hard coded colors so that
// more colors are available to use for other event types.
addData(EventType.UnbookedSmall, '#CCB091', 4);
addData(EventType.UnbookedMedium, '#926C44', 3);
addData(EventType.UnbookedLarge, '#362819', 2);
