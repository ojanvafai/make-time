export const CLIENT_ID = "960408234665-mr7v9joc0ckj65eju460e04mji08dsd7.apps.googleusercontent.com";
export const API_KEY = "AIzaSyDZ2rBkT9mfS-zSrkovKw74hd_HmNBSahQ";

export const TYPE_MEETING_RECURRING = "Recurring meeting";
export const TYPE_MEETING_NON_RECURRING = "Non-recurring meeting";
export const TYPE_ONE_ON_ONE_RECURRING = "Recurring one on one";
export const TYPE_ONE_ON_ONE_NON_RECURRING = "Non-recurring one on one";
export const TYPE_FOCUS_RECURRING = "Recurring focus block";
export const TYPE_FOCUS_NON_RECURRING = "Non-recurring focus block";
export const TYPE_UNBOOKED = "Unbooked time";
export const TYPE_OOO = "OOO"
export const TYPE_EMAIL = "Email"
export const TYPE_INTERVIEW = "Interview"

export const CALENDAR_ID = "primary";

export const WORKING_DAY_START = 9;
export const WORKING_DAY_END = 17;

const COLORS = [
  "#a4bdfc",
  "#7ae7bf",
  "#dbadff",
  "#ff887c",
  "#fbd75b",
  "#ffb878",
  "#46d6db",
  "#e1e1e1",
  "#5484ed",
  "#51b749",
  "#dc2127",
];

const TYPE_COLORS : [string, string][] = [
    [TYPE_MEETING_RECURRING,         "#ff887c"],
    [TYPE_MEETING_NON_RECURRING,     "#dc2127"],
    [TYPE_ONE_ON_ONE_RECURRING,      "#7ae7bf"],
    [TYPE_ONE_ON_ONE_NON_RECURRING,  "#51b749"],
    [TYPE_FOCUS_RECURRING,           "#a4bdfc"],
    [TYPE_FOCUS_NON_RECURRING,       "#dbadff"],
    [TYPE_EMAIL,                     "#5484ed"],
    [TYPE_INTERVIEW,                 "#46d6db"],
    [TYPE_UNBOOKED,                  "#fbd75b"],
    [TYPE_OOO,                       "#e1e1e1"],
];

export const TYPES : Map<string, number> = new Map(
    TYPE_COLORS.map(type_color => {
        return [
            type_color[0],
            COLORS.indexOf(type_color[1]) + 1,
        ] as [string, number]
    })
);

//10: #51b749, 2: #7ae7bf,
//3:  #dbadff, 1: #a4bdfc
//11: #dc2127, 4: #ff887c
//6:  #ffb878, 5:  #fbd75b
//9:  #5484ed, 7:  #46d6db
//8:  #e1e1e1
