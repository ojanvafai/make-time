export const CLIENT_ID =
    '960408234665-mr7v9joc0ckj65eju460e04mji08dsd7.apps.googleusercontent.com';
export const API_KEY = 'AIzaSyDZ2rBkT9mfS-zSrkovKw74hd_HmNBSahQ';

export const TYPE_MEETING_RECURRING = 'Recurring meeting';
export const TYPE_MEETING_NON_RECURRING = 'Non-recurring meeting';
export const TYPE_ONE_ON_ONE_RECURRING = 'Recurring one on one';
export const TYPE_ONE_ON_ONE_NON_RECURRING = 'Non-recurring one on one';
export const TYPE_FOCUS_RECURRING = 'Recurring focus block';
export const TYPE_FOCUS_NON_RECURRING = 'Non-recurring focus block';
export const TYPE_UNBOOKED_SMALL = 'Unbooked time (<= 30m)';
export const TYPE_UNBOOKED_MEDIUM = 'Unbooked time (30m-60m)';
export const TYPE_UNBOOKED_LARGE = 'Unbooked time (> 60m)';
export const TYPE_OOO = 'OOO';
export const TYPE_EMAIL = 'Email';
export const TYPE_INTERVIEW = 'Interview';

// Event types that don't count against the total of time considered booked.
// TYPE_OOO is excluded here because it's special and doesn't count as booked or
// unbooked.
export const ME_TIME_BLOCKS = [
  TYPE_FOCUS_RECURRING, TYPE_FOCUS_NON_RECURRING, TYPE_UNBOOKED_SMALL,
  TYPE_UNBOOKED_MEDIUM, TYPE_UNBOOKED_LARGE
];

export const CALENDAR_ID = 'primary';

export const WORKING_DAY_START = 9;
export const WORKING_DAY_END = 17;

const COLORS = [
  '#a4bdfc',
  '#7ae7bf',
  '#dbadff',
  '#ff887c',
  '#fbd75b',
  '#ffb878',
  '#46d6db',
  '#e1e1e1',
  '#5484ed',
  '#51b749',
  '#dc2127',
];

const TYPE_COLORS: [string, string][] = [
  [TYPE_MEETING_RECURRING, '#ff887c'],
  [TYPE_MEETING_NON_RECURRING, '#dc2127'],
  [TYPE_ONE_ON_ONE_RECURRING, '#7ae7bf'],
  [TYPE_ONE_ON_ONE_NON_RECURRING, '#51b749'],
  [TYPE_FOCUS_RECURRING, '#a4bdfc'],
  [TYPE_FOCUS_NON_RECURRING, '#dbadff'],
  [TYPE_EMAIL, '#5484ed'],
  [TYPE_INTERVIEW, '#46d6db'],
  [TYPE_UNBOOKED_SMALL, '#af1085'],
  [TYPE_UNBOOKED_MEDIUM, '#0e3e2e'],
  [TYPE_UNBOOKED_LARGE, '#fbd75b'],
  [TYPE_OOO, '#e1e1e1'],
];

export const TYPES: Map<string, number> =
    new Map(TYPE_COLORS.map(type_color => {return [
                              type_color[0],
                              COLORS.indexOf(type_color[1]) + 1,
                            ] as [string, number]}));

export const TYPE_TO_COLOR = new Map(TYPE_COLORS);
