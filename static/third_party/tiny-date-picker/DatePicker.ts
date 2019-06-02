import {defined} from '../../Base.js';

let dayPicker = {
  onKeyDown: dayPickerKeyDown,
  onClick: {
    'dp-day': selectDay,
    'dp-next': gotoNextMonth,
    'dp-prev': gotoPrevMonth,
    'dp-today': selectToday,
    'dp-clear': clear,
    'dp-close': close,
    'dp-cal-month': showMonthPicker,
    'dp-cal-year': showYearPicker,
  },
  render: renderDayPicker
};

function renderDayPicker(dp: any) {
  var opts = dp.opts;
  var lang = opts.lang;
  var state = dp.state;
  var dayNames = lang.days;
  var dayOffset = opts.dayOffset || 0;
  var selectedDate = state.selectedDate;
  var hilightedDate = state.hilightedDate;
  var hilightedMonth = hilightedDate.getMonth();
  var today = now().getTime();

  return (
      '<div class="dp-cal">' +
      '<header class="dp-cal-header">' +
      '<button tabindex="-1" type="button" class="dp-prev">Prev</button>' +
      '<button tabindex="-1" type="button" class="dp-cal-month">' +
      lang.months[hilightedMonth] + '</button>' +
      '<button tabindex="-1" type="button" class="dp-cal-year">' +
      hilightedDate.getFullYear() + '</button>' +
      '<button tabindex="-1" type="button" class="dp-next">Next</button>' +
      '</header>' +
      '<div class="dp-days">' +
      dayNames
          .map(function(_name: string, i: number) {
            return (
                '<span class="dp-col-header">' +
                dayNames[(i + dayOffset) % dayNames.length] + '</span>');
          })
          .join('') +
      mapDays(
          hilightedDate, dayOffset,
          function(date: Date) {
            var isNotInMonth = date.getMonth() !== hilightedMonth;
            var isDisabled = !opts.inRange(date);
            var isToday = date.getTime() === today;
            var className = 'dp-day';
            className += (isNotInMonth ? ' dp-edge-day' : '');
            className += (datesEq(date, hilightedDate) ? ' dp-current' : '');
            className += (datesEq(date, selectedDate) ? ' dp-selected' : '');
            className += (isDisabled ? ' dp-day-disabled' : '');
            className += (isToday ? ' dp-day-today' : '');
            className += ' ' + opts.dateClass(date, dp);

            return (
                '<button tabindex="-1" type="button" class="' + className +
                '" data-date="' + date.getTime() + '">' + date.getDate() +
                '</button>');
          }) +
      '</div>' +
      // TODO: Reenable these once we support cancelling the date picker from
      // triage actions.
      // '<footer class="dp-cal-footer">' +
      // '<button tabindex="-1" type="button" class="dp-today">' + lang.today +
      // '</button>' +
      // '<button tabindex="-1" type="button" class="dp-clear">' + lang.clear +
      // '</button>' +
      // '<button tabindex="-1" type="button" class="dp-close">' + lang.close +
      // '</button>' +
      // '</footer>' +
      '</div>');
}

function dayPickerKeyDown(e: KeyboardEvent, dp: DatePickerState) {
  var key = e.keyCode;
  var shiftBy = (key === Key.left) ?
      -1 :
      (key === Key.right) ? 1 :
                            (key === Key.up) ? -7 : (key === Key.down) ? 7 : 0;

  if (key === Key.esc) {
    // TODO: Reenable this once we support cancelling the date picker from
    // triage actions. dp.close();
  } else if (shiftBy) {
    e.preventDefault();
    dp.setState({hilightedDate: shiftDay(dp.state.hilightedDate, shiftBy)});
  }
}

function selectToday(_e: Event, dp: DatePickerState) {
  dp.setState({
    selectedDate: now(),
  });
}

function clear(_e: Event, dp: DatePickerState) {
  dp.setState({
    selectedDate: null,
  });
}

function close(_e: Event, dp: DatePickerState) {
  dp.close();
}

function showMonthPicker(_e: Event, dp: DatePickerState) {
  dp.setState({view: 'month'});
}

function showYearPicker(_e: Event, dp: DatePickerState) {
  dp.setState({view: 'year'});
}

function gotoNextMonth(_e: Event, dp: DatePickerState) {
  var hilightedDate = dp.state.hilightedDate;
  dp.setState({hilightedDate: shiftMonth(hilightedDate, 1)});
}

function gotoPrevMonth(_e: Event, dp: DatePickerState) {
  var hilightedDate = dp.state.hilightedDate;
  dp.setState({hilightedDate: shiftMonth(hilightedDate, -1)});
}

function selectDay(e: Event, dp: DatePickerState) {
  dp.setState({
    selectedDate: new Date(parseInt(
        (e.target as HTMLElement).getAttribute('data-date') as string)),
  });
}

function mapDays(currentDate: Date, dayOffset: number, fn: any) {
  var result = '';
  var iter = new Date(currentDate);
  iter.setDate(1);
  iter.setDate(1 - iter.getDay() + dayOffset);

  // If we are showing monday as the 1st of the week,
  // and the monday is the 2nd of the month, the sunday won't
  // show, so we need to shift backwards
  if (dayOffset && iter.getDate() === dayOffset + 1) {
    iter.setDate(dayOffset - 6);
  }

  // We are going to have 6 weeks always displayed to keep a consistent
  // calendar size
  for (var day = 0; day < (6 * 7); ++day) {
    result += fn(iter);
    iter.setDate(iter.getDate() + 1);
  }

  return result;
}

let monthPicker = {
  onKeyDown: monthPickerKeyDown,
  onClick: {'dp-month': onChooseMonth},
  render: renderMonthPicker
};

function onChooseMonth(e: Event, dp: DatePickerState) {
  dp.setState({
    hilightedDate: setMonth(
        dp.state.hilightedDate,
        parseInt(
            (e.target as HTMLElement).getAttribute('data-month') as string)),
    view: 'day',
  });
}

function renderMonthPicker(dp: DatePickerState) {
  var opts = dp.opts;
  var lang = opts.lang;
  var months = lang.months;
  var currentDate = dp.state.hilightedDate;
  var currentMonth = currentDate.getMonth();

  return (
      '<div class="dp-months">' +
      months
          .map(function(month: string, i: number) {
            var className = 'dp-month';
            className += (currentMonth === i ? ' dp-current' : '');

            return (
                '<button tabindex="-1" type="button" class="' + className +
                '" data-month="' + i + '">' + month + '</button>');
          })
          .join('') +
      '</div>');
}

function monthPickerKeyDown(e: KeyboardEvent, dp: DatePickerState) {
  var key = e.keyCode;
  var shiftBy = (key === Key.left) ?
      -1 :
      (key === Key.right) ? 1 :
                            (key === Key.up) ? -3 : (key === Key.down) ? 3 : 0;

  if (key === Key.esc) {
    dp.setState({
      view: 'day',
    });
  } else if (shiftBy) {
    e.preventDefault();
    dp.setState(
        {hilightedDate: shiftMonth(dp.state.hilightedDate, shiftBy, true)});
  }
}


let yearPicker = {
  render: renderYearPicker,
  onKeyDown: yearPickerKeyDown,
  onClick: {'dp-year': onChooseYear},
};

function renderYearPicker(dp: DatePickerState) {
  var state = dp.state;
  var currentYear = state.hilightedDate.getFullYear();
  var selectedYear = state.selectedDate.getFullYear();

  return ('<div class="dp-years">' + mapYears(dp, function(year: string) {
            var className = 'dp-year';
            className += (year === currentYear ? ' dp-current' : '');
            className += (year === selectedYear ? ' dp-selected' : '');

            return (
                '<button tabindex="-1" type="button" class="' + className +
                '" data-year="' + year + '">' + year + '</button>');
          }) + '</div>');
}

function onChooseYear(e: Event, dp: DatePickerState) {
  dp.setState({
    hilightedDate: setYear(
        dp.state.hilightedDate,
        parseInt(
            (e.target as HTMLElement).getAttribute('data-year') as string)),
    view: 'day',
  });
}

function yearPickerKeyDown(e: KeyboardEvent, dp: DatePickerState) {
  var key = e.keyCode;
  var opts = dp.opts;
  var shiftBy = (key === Key.left || key === Key.up) ?
      1 :
      (key === Key.right || key === Key.down) ? -1 : 0;

  if (key === Key.esc) {
    dp.setState({
      view: 'day',
    });
  } else if (shiftBy) {
    e.preventDefault();
    var shiftedYear = shiftYear(dp.state.hilightedDate, shiftBy);

    dp.setState({
      hilightedDate: constrainDate(shiftedYear, opts.min, opts.max),
    });
  }
}

function mapYears(dp: DatePickerState, fn: any) {
  var result = '';
  var max = dp.opts.max.getFullYear();

  for (var i = max; i >= dp.opts.min.getFullYear(); --i) {
    result += fn(i);
  }

  return result;
}

var Key = {
  left: 37,
  up: 38,
  right: 39,
  down: 40,
  enter: 13,
  esc: 27,
};

function on(evt: string, el: HTMLElement, handler: (e: Event) => void) {
  el.addEventListener(evt, handler, true);

  return function() {
    el.removeEventListener(evt, handler, true);
  };
}

function now() {
  var dt = new Date();
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function datesEq(date1: Date, date2: Date) {
  return (date1 && date1.toDateString()) === (date2 && date2.toDateString());
}

function shiftDay(dt: Date, n: number) {
  dt = new Date(dt);
  dt.setDate(dt.getDate() + n);
  return dt;
}

/**
 * shiftMonth shifts the specified date by a specified number of months
 *
 * @param {Date} dt
 * @param {number} n
 * @param {boolean} wrap optional, if true, does not change year
 *                       value, defaults to false
 * @returns {Date}
 */
function shiftMonth(dt: Date, n: number, wrap?: boolean) {
  dt = new Date(dt);

  var dayOfMonth = dt.getDate();
  var month = dt.getMonth() + n;

  dt.setDate(1);
  dt.setMonth(wrap ? (12 + month) % 12 : month);
  dt.setDate(dayOfMonth);

  // If dayOfMonth = 31, but the target month only has 30 or 29 or whatever...
  // head back to the max of the target month
  if (dt.getDate() < dayOfMonth) {
    dt.setDate(0);
  }

  return dt;
}

function shiftYear(dt: Date, n: number) {
  dt = new Date(dt);
  dt.setFullYear(dt.getFullYear() + n);
  return dt;
}

function setYear(dt: Date, year: number) {
  dt = new Date(dt);
  dt.setFullYear(year);
  return dt;
}

function setMonth(dt: Date, month: number) {
  return shiftMonth(dt, month - dt.getMonth());
}

function dateOrParse(parse: any) {
  return function(dt: Date|string) {
    return dropTime(typeof dt === 'string' ? parse(dt) : dt);
  };
}

function constrainDate(dt: Date, min: Date, max: Date) {
  return (dt < min) ? min : (dt > max) ? max : dt;
}

function dropTime(dt: Date) {
  dt = new Date(dt);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function bufferFn(ms: number, fn: any) {
  var timeout: number;
  return function() {
    clearTimeout(timeout);
    timeout = window.setTimeout(fn, ms);
  };
}

function noop() {}

/**
 * copy properties from object o2 to object o1.
 *
 * @params {Object} o1
 * @params {Object} o2
 * @returns {Object}
 */
function cp(...args: any) {
  var o1 = args[0];
  for (var i = 1; i < args.length; ++i) {
    var o2 = args[i] || {};
    for (var key in o2) {
      o1[key] = o2[key];
    }
  }
  return o1;
}

interface DatePickerState {
  setState: any;
  state: any;
  close: any;
  opts: any;
  shouldHide: any;
  open: any;
  hasFocus: any;
  currentView: any;
  el: any;
}

interface DatePickerOptions {
  appendTo: any;
  format: any;
  parse: any;
  min: any;
  max: any;
  inRange: any;
  mode: any;
  shouldFocusOnRender: any;
  hilightedDate: Date;
  lang: any;
  reference?: HTMLElement;
}

var views: {[property: string]:
                any} = {day: dayPicker, year: yearPicker, month: monthPicker};

function BaseMode(emit: (name: string) => void, opts: DatePickerOptions) {
  var detatchInputEvents:
      any;  // A function that detaches all events from the input
  var closing =
      false;  // A hack to prevent calendar from re-opening when closing.
  var selectedDate: Date;  // The currently selected date
  var dp = {
    // The root DOM element for the date picker, initialized on first open.
    el: undefined as undefined | HTMLElement,
    opts: opts,
    shouldFocusOnBlur: true,
    shouldFocusOnRender: true,
    state: initialState(),
    adjustPosition: noop,
    containerHTML: '<div class="dp"></div>',

    attachToDom: function() {
      opts.appendTo.appendChild(dp.el);
    },

    currentView: function() {
      return views[dp.state.view];
    },

    open: function() {
      if (closing) {
        return;
      }

      if (!dp.el) {
        dp.el = createContainerElement(opts, dp.containerHTML);
        attachContainerEvents(dp);
      }

      // selectedDate =
      //     constrainDate(dp.computeSelectedDate(), opts.min, opts.max);
      // @ts-ignore
      dp.state.hilightedDate = selectedDate || opts.hilightedDate;
      dp.state.view = 'day';

      dp.attachToDom();
      dp.render();

      emit('open');
    },

    isVisible: function() {
      return !!dp.el && !!dp.el.parentNode;
    },

    hasFocus: function() {
      var focused = document.activeElement;
      return focused && dp.el && dp.el.contains(focused) &&
          focused.className.indexOf('dp-focuser') < 0;
    },

    shouldHide: function() {
      return dp.isVisible();
    },

    close: function() {
      var el = dp.el;

      if (!dp.isVisible()) {
        return;
      }

      if (el) {
        var parent = el.parentNode;
        parent && parent.removeChild(el);
      }

      closing = true;

      // When we close, the input often gains refocus, which
      // can then launch the date picker again, so we buffer
      // a bit and don't show the date picker within N ms of closing
      setTimeout(function() {
        closing = false;
      }, 100);

      emit('close');
    },

    destroy: function() {
      dp.close();
      detatchInputEvents();
    },

    render: function() {
      if (!dp.el) {
        return;
      }

      var hadFocus = dp.hasFocus();
      var html = dp.currentView().render(dp);
      html && ((dp.el.firstChild as HTMLElement).innerHTML = html);

      dp.adjustPosition();

      if (hadFocus || dp.shouldFocusOnRender) {
        focusCurrent(dp);
      }
    },

    // Conceptually similar to setState in React, updates
    // the view state and re-renders.
    setState: function(state: DatePickerState) {
      for (var key in state) {
        // @ts-ignore
        dp.state[key] = state[key];
      }

      emit('statechange');
      dp.render();
    },
  };

  dp.open();

  // Builds the initial view state
  // selectedDate is a special case and causes changes to hilightedDate
  // hilightedDate is set on open, so remains undefined initially
  // view is the current view (day, month, year)
  function initialState() {
    return {
      get selectedDate() {
        return selectedDate;
      },
      set selectedDate(dt) {
        if (dt && !opts.inRange(dt)) {
          return;
        }

        if (dt) {
          selectedDate = new Date(dt);
          // @ts-ignore
          dp.state.hilightedDate = selectedDate;
        } else {
          selectedDate = dt;
        }

        emit('select');
        dp.close();
      },
      view: 'day',
    };
  }

  return dp;
}

function createContainerElement(
    opts: DatePickerOptions, containerHTML: string) {
  var el = document.createElement('div');

  el.className = opts.mode;
  el.innerHTML = containerHTML;

  return el;
}

function focusCurrent(dp: DatePickerState) {
  var current = dp.el.querySelector('.dp-current');
  return current && current.focus();
}

function attachContainerEvents(dp: DatePickerState) {
  var el = dp.el;
  var calEl = el.querySelector('.dp');

  // Hack to get iOS to show active CSS states
  el.ontouchstart = noop;

  function onClick(e: Event) {
    (e.target as HTMLElement).className.split(' ').forEach(function(evt) {
      var handler = dp.currentView().onClick[evt];
      handler && handler(e, dp);
    });
  }

  // The calender fires a blur event *every* time we redraw
  // this means we need to buffer the blur event to see if
  // it still has no focus after redrawing, and only then
  // do we return focus to the input. A possible other approach
  // would be to set context.redrawing = true on redraw and
  // set it to false in the blur event.
  on('blur', calEl, bufferFn(150, function() {
       if (!dp.hasFocus()) {
         dp.close(true);
       }
     }));

  // @ts-ignore
  on('keydown', el, function(e: KeyboardEvent) {
    if (e.keyCode === Key.enter) {
      onClick(e);
    } else {
      dp.currentView().onKeyDown(e, dp);
    }
  });

  // If the user clicks in non-focusable space, but
  // still within the date picker, we don't want to
  // hide, so we need to hack some things...
  on('mousedown', calEl, function(e) {
    let target = (e.target as HTMLElement);
    target.focus && target.focus();  // IE hack
    if (document.activeElement !== e.target) {
      e.preventDefault();
      focusCurrent(dp);
    }
  });

  on('click', el, onClick);
}

function ModalMode(emit: (name: string) => void, opts: DatePickerOptions) {
  var dp = BaseMode(emit, opts);

  // In modal mode, we need to know when the user has tabbed
  // off the end of the calendar, and set focus to the original
  // input. To do this, we add a special element to the DOM.
  // When the user tabs off the bottom of the calendar, they
  // will tab onto this element.
  dp.containerHTML += '<a href="#" class="dp-focuser">.</a>';

  return dp;
}

function DropdownMode(emit: (name: string) => void, opts: DatePickerOptions) {
  var dp = BaseMode(emit, opts);
  dp.adjustPosition = function() {
    autoPosition(defined(opts.reference), dp);
  };

  return dp;
}

function autoPosition(input: HTMLElement, dp: DatePickerState) {
  var inputPos = input.getBoundingClientRect();
  var win = window;

  adjustCalY(dp, inputPos, win);
  adjustCalX(dp, inputPos, win);

  dp.el.style.visibility = '';
}

function adjustCalX(dp: DatePickerState, inputPos: ClientRect, win: Window) {
  var cal = dp.el;
  var scrollLeft = win.pageXOffset;
  var inputLeft = inputPos.left + scrollLeft;
  var maxRight = win.innerWidth + scrollLeft;
  var offsetWidth = cal.offsetWidth;
  var calRight = inputLeft + offsetWidth;
  var shiftedLeft = maxRight - offsetWidth;
  var left = calRight > maxRight && shiftedLeft > 0 ? shiftedLeft : inputLeft;

  cal.style.left = left + 'px';
}

function adjustCalY(dp: DatePickerState, inputPos: ClientRect, win: Window) {
  var cal = dp.el;
  var scrollTop = win.pageYOffset;
  var inputTop = scrollTop + inputPos.top;
  var calHeight = cal.offsetHeight;
  var belowTop = inputTop + inputPos.height + 8;
  var aboveTop = inputTop - calHeight - 8;
  var isAbove =
      (aboveTop > 0 && belowTop + calHeight > scrollTop + win.innerHeight);
  var top = isAbove ? aboveTop : belowTop;

  if (cal.classList) {
    cal.classList.toggle('dp-is-above', isAbove);
    cal.classList.toggle('dp-is-below', !isAbove);
  }
  cal.style.top = top + 'px';
}

function PermanentMode(emit: (name: string) => void, opts: DatePickerOptions) {
  var dp = BaseMode(emit, opts);

  dp.close = noop;
  dp.shouldFocusOnRender = opts.shouldFocusOnRender;

  dp.attachToDom = function() {
    defined(opts.reference).appendChild(dp.el as HTMLElement);
  };

  dp.open();

  return dp;
}

var english = {
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  months: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  today: 'Today',
  clear: 'Clear',
  close: 'Close',
};

function DatePickerOptions(opts: DatePickerOptions) {
  opts = opts || {};
  opts = cp(defaults(), opts);
  var parse = dateOrParse(opts.parse);
  opts.lang = cp(english, opts.lang);
  opts.parse = parse;
  opts.inRange = makeInRangeFn(opts);
  opts.min = parse(opts.min || shiftYear(now(), -100));
  opts.max = parse(opts.max || shiftYear(now(), 100));
  opts.hilightedDate = opts.parse(opts.hilightedDate);

  return opts;
}

function defaults() {
  return {
    lang: english,

    // Possible values: dp-modal, dp-below, dp-permanent
    mode: 'dp-modal',

    // The date to hilight initially if the date picker has no
    // initial value.
    hilightedDate: now(),

    format: function(dt: Date) {
      return (dt.getMonth() + 1) + '/' + dt.getDate() + '/' + dt.getFullYear();
    },

    parse: function(str: string) {
      var date = new Date(str);
      // @ts-ignore
      return isNaN(date) ? now() : date;
    },

    dateClass: function() {},

    inRange: function() {
      return true;
    },

    appendTo: document.body,
  };
}

function makeInRangeFn(opts: DatePickerOptions) {
  var inRange = opts.inRange;  // Cache this version, and return a variant

  return function(dt: Date, dp: DatePickerOptions) {
    return inRange(dt, dp) && opts.min <= dt && opts.max >= dt;
  };
}

export class TinyDatePicker extends HTMLElement {
  private mode_: any;
  setState: any;
  open: any;
  close: any;
  destroy: any;

  constructor(opts?: any) {
    super();
    var options = DatePickerOptions(opts);

    let emit = (evt: string) => {
      this.dispatchEvent(new Event(evt));
    };

    let modeConstructor;
    switch (opts.mode) {
      case 'dp-modal':
        modeConstructor = ModalMode;
        break;
      case 'dp-below':
        modeConstructor = DropdownMode;
        break;
      case 'dp-permanent':
        modeConstructor = PermanentMode;
        break;
      default:
        throw new Error(`Invalid mode: ${opts.mode}`);
    }
    this.mode_ = modeConstructor(emit, options);

    this.setState = this.mode_.setState;
    this.open = this.mode_.open;
    this.close = this.mode_.close;
    this.destroy = this.mode_.destroy;
  }

  get state() {
    return this.mode_.state;
  }
}
window.customElements.define('tiny-date-picker', TinyDatePicker);
