import {defined, getCurrentWeekNumber, showDialog} from './Base.js';
import {firestore, getServerStorage, getSettings} from './BaseMain.js';
import {Calendar} from './calendar/Calendar.js';
import {Contacts} from './Contacts.js';
import {ErrorLogger} from './ErrorLogger.js';
import {IDBKeyVal} from './idb-keyval.js';
import {LongTasks} from './LongTasks.js';
import {MailProcessor} from './MailProcessor.js';
import {ComposeModel} from './models/ComposeModel.js';
import {Model} from './models/Model.js';
import {TodoModel} from './models/TodoModel.js';
import {TriageModel} from './models/TriageModel.js';
import {CONNECTION_FAILURE_KEY} from './Net.js';
import {Router} from './Router.js';
import {SendAs} from './SendAs.js';
import {ServerStorage, ServerStorageUpdateEventName} from './ServerStorage.js';
import {AppShell, BackEvent} from './views/AppShell.js';
import {CalendarView} from './views/CalendarView.js';
import {ComposeView} from './views/ComposeView.js';
import {HiddenView} from './views/HiddenView.js';
import {KeyboardShortcutsDialog} from './views/KeyboardShortcutsDialog.js';
import {SettingsView} from './views/SettingsView.js';
import {ThreadListView} from './views/ThreadListView.js';
import {View} from './views/View.js';

if (!navigator.userAgent.includes('Mobile'))
  document.documentElement.classList.add('desktop');

let currentView_: View;
let mailProcessor_: MailProcessor;
let appShell_: AppShell;

const UNIVERSAL_QUERY_PARAMETERS = ['bundle'];
let router = new Router(UNIVERSAL_QUERY_PARAMETERS);

let longTasks_: LongTasks;
async function updateLongTaskTracking() {
  // Read this setting out of local storage so we don't block on reading
  // settings from the network to set this up.
  if (await IDBKeyVal.getDefault().get(ServerStorage.KEYS.TRACK_LONG_TASKS)) {
    // Since updateLongTaskTracking is called multiple times, there can be a
    // race with the above await call, so ensure we don't create it twice.
    if (!longTasks_) {
      longTasks_ = new LongTasks();
      document.body.append(longTasks_);
    }
  } else if (longTasks_) {
    longTasks_.remove();
  }
}
updateLongTaskTracking();

enum VIEW {
  Calendar,
  Compose,
  Hidden,
  Settings,
  Todo,
  Triage,
}

async function routeToCurrentLocation() {
  await router.run(window.location, true);
}

window.onpopstate = () => {
  routeToCurrentLocation();
};

router.add('/compose', async (params) => {
  let shouldHideMenu = !!Object.keys(params).length;
  if (shouldHideMenu)
    preventUpdates();
  await setView(VIEW.Compose, params, shouldHideMenu);
});
router.add('/', routeToTriage);
router.add('/triage', routeToTriage);
router.add('/todo', async (_params) => {
  await setView(VIEW.Todo);
});
router.add('/hidden', async (_params) => {
  await setView(VIEW.Hidden);
});
router.add('/calendar', async (_parans) => {
  await setView(VIEW.Calendar);
});
router.add('/settings', async (_parans) => {
  await setView(VIEW.Settings);
});

async function routeToTriage() {
  await setView(VIEW.Triage);
}

function getView() {
  return currentView_;
}

async function createModel(viewType: VIEW) {
  switch (viewType) {
    case VIEW.Calendar:
      return await getCalendarModel();

    case VIEW.Compose:
      return new ComposeModel();

    case VIEW.Todo:
      return await getTodoModel();

    case VIEW.Triage:
      return await getTriageModel();

    case VIEW.Settings:
      return null;

    case VIEW.Hidden:
      return null;

    default:
      // Throw instead of asserting here so that TypeScript knows that this
      // function never returns undefined.
      throw new Error('This should never happen.');
  }
}

async function createView(viewType: VIEW, model: Model|null, params?: any) {
  switch (viewType) {
    case VIEW.Calendar:
      return new CalendarView(model as Calendar);

    case VIEW.Compose:
      return new ComposeView(model as ComposeModel, params);

    case VIEW.Todo:
      return new ThreadListView(
          <TodoModel>model, appShell_, await getSettings(), '/triage',
          'Back to Triaging');

    case VIEW.Triage:
      return new ThreadListView(
          <TriageModel>model, appShell_, await getSettings(), '/todo',
          'Go to todo list');

    case VIEW.Settings:
      return new SettingsView(await getSettings());

    case VIEW.Hidden:
      return new HiddenView(appShell_, await getSettings());

    default:
      // Throw instead of asserting here so that TypeScript knows that this
      // function never returns undefined.
      throw new Error('This should never happen.');
  }
}

let viewGeneration = 0;
async function setView(viewType: VIEW, params?: any, shouldHideMenu?: boolean) {
  let thisViewGeneration = ++viewGeneration;

  appShell_.showMenuButton(shouldHideMenu);

  if (currentView_)
    currentView_.tearDown();

  let model = defined(await createModel(viewType));
  // Abort if we transitioned to a new view while this one was being created.
  if (thisViewGeneration !== viewGeneration)
    return;

  let view = defined(await createView(viewType, model, params));
  // Abort if we transitioned to a new view while this one was being created.
  if (thisViewGeneration !== viewGeneration) {
    view.tearDown();
    return;
  }

  currentView_ = view;
  appShell_.setContent(currentView_);
  await currentView_.init();
}

let isUpdating_ = false;
let shouldUpdate_ = true;

function preventUpdates() {
  shouldUpdate_ = false;
}

async function resetModels() {
  calendarModel_ = undefined;
  triageModel_ = undefined;
  todoModel_ = undefined;
}

let calendarModel_: Calendar|undefined;
async function getCalendarModel() {
  if (!calendarModel_)
    calendarModel_ = new Calendar(await getSettings());
  return calendarModel_;
}

let triageModel_: TriageModel|undefined;
async function getTriageModel() {
  if (!triageModel_)
    triageModel_ = new TriageModel(await getSettings());
  return triageModel_;
}

let todoModel_: TodoModel|undefined;
async function getTodoModel() {
  if (!todoModel_) {
    let settings = await getSettings();
    todoModel_ = new TodoModel(settings.get(ServerStorage.KEYS.VACATION));
  }
  return todoModel_;
}

async function onLoad() {
  let serverStorage = await getServerStorage();
  serverStorage.addEventListener(ServerStorageUpdateEventName, async () => {
    // Rerender the current view on settings changes in case a setting would
    // change it's behavior, e.g. duration of the countdown timer or sort order
    // of queues.
    await resetModels();
    await routeToCurrentLocation();
  });

  appShell_ = new AppShell();
  appShell_.addEventListener(BackEvent.NAME, async () => {
    if (getView().goBack)
      await getView().goBack();
  });
  document.body.append(appShell_);

  await routeToCurrentLocation();
  await update();
  // Instantiate the TodoModel even if we're not in the Todo view so that the
  // favicon is updated with the must do count.
  await getTodoModel();

  // Wait until we've fetched all the threads before trying to process updates
  // regularly.
  setInterval(update, 1000 * 60);
  let settings = await getSettings();
  if (settings.get(ServerStorage.KEYS.TRACK_LONG_TASKS)) {
    await IDBKeyVal.getDefault().set(
        ServerStorage.KEYS.TRACK_LONG_TASKS, 'true');
  } else {
    await IDBKeyVal.getDefault().del(ServerStorage.KEYS.TRACK_LONG_TASKS);
  }
  await updateLongTaskTracking();
  await setupReloadOnVersionChange();
}

onLoad();

let version_: number;
async function setupReloadOnVersionChange() {
  let db = firestore();
  let doc = db.collection('global').doc('version');
  let data = await doc.get();
  if (data.exists)
    version_ = defined(data.data()).version;

  doc.onSnapshot(async (snapshot) => {
    let newVersion = defined(snapshot.data()).version;
    if (version_ == newVersion)
      return;

    let dialog: HTMLDialogElement;

    let container = document.createElement('div');
    container.append(
        'A new version of maketime is available. This window will reload in 60 seconds.');
    let close = document.createElement('button');
    close.append('close');
    close.onclick = () => dialog.close();

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        justify-content: flex-end;
      `;
    buttonContainer.append(close);
    container.append(buttonContainer);
    dialog = showDialog(container);

    setTimeout(() => window.location.reload(), 60000);
  });
}

const DAILY_LOCAL_UPDATES_KEY = 'daily-local-updates';

// Updates to things stored in local storage. This should not be used for things
// that should happen once per day globally since the user might have maketime
// open on multiple clients.
async function dailyLocalUpdates() {
  let lastUpdateTime: number|undefined =
      await IDBKeyVal.getDefault().get(DAILY_LOCAL_UPDATES_KEY);
  let oneDay = 24 * 60 * 60 * 1000;
  if (lastUpdateTime && (Date.now() - lastUpdateTime) < oneDay)
    return;

  await (await SendAs.getDefault()).update();
  await Contacts.getDefault().update();
  await gcStaleThreadData();

  await IDBKeyVal.getDefault().set(DAILY_LOCAL_UPDATES_KEY, Date.now());
}

async function gcStaleThreadData() {
  let currentWeekNumber = getCurrentWeekNumber();
  let keys = await IDBKeyVal.getDefault().keys();
  for (let key of keys) {
    let match = key.match(/^thread-(\d+)-\d+$/);
    if (!match)
      continue;

    // At this point, any threads in the inbox still should have been updated
    // to the current week. So anything in another week should be stale
    // and can be deleted.
    let weekNumber = Number(match[1]);
    if (weekNumber != currentWeekNumber)
      await IDBKeyVal.getDefault().del(key);
  }
}

export async function update() {
  if (!shouldUpdate_ || !navigator.onLine)
    return;

  // update can get called before any views are setup due to visibilitychange
  // and online handlers
  let view = await getView();
  if (!view || isUpdating_)
    return;
  isUpdating_ = true;

  try {
    if (!mailProcessor_)
      mailProcessor_ = new MailProcessor(await getSettings());
    await mailProcessor_.process();

    // Don't init the calendar model here as we don't want to force load all the
    // calendar events every time someone loads maketime. But once they've
    // viewed the calendar onces, then pull in event updates from then on since
    // those are cheap and are needed to do continual colorizing.
    if (calendarModel_)
      calendarModel_.updateEvents();

    await dailyLocalUpdates();
  } catch (e) {
    // TODO: Move this to Net.js once we've made it so that all network
    // requests that fail due to being offline get retried.
    if (getErrorMessage(e) === NETWORK_OFFLINE_ERROR_MESSAGE) {
      AppShell.updateTitle(
          CONNECTION_FAILURE_KEY, 'Having trouble connecting to internet...');
    } else {
      throw e;
    }
  } finally {
    isUpdating_ = false;
  }
}

window.addEventListener(CONNECTION_FAILURE_KEY, () => {
  // Net.js fires this when a network request succeeds, which indicates we're
  // no longer offline.
  AppShell.updateTitle(CONNECTION_FAILURE_KEY);
});

// Make sure links open in new tabs.
document.body.addEventListener('click', async (e) => {
  for (let node of e.composedPath()) {
    if ((node as Element).tagName === 'A') {
      let anchor = <HTMLAnchorElement>node;
      // For navigations will just change the hash scroll the item into view
      // (e.g. for links in a newsletter). In theory we could allow the default
      // action to go through, but that would call onpopstate and we'd need to
      // get onpopstate to not route to the current location. This seems easier.
      // This doesn't update the url with the hash, but that might be better
      // anyways.
      if (location.hash !== anchor.hash && location.origin === anchor.origin &&
          location.pathname === anchor.pathname) {
        e.preventDefault();
        let id = anchor.hash.replace('#', '');
        let target = document.getElementById(id);
        if (target)
          target.scrollIntoView();
        return;
      }

      let willHandlePromise = router.run(anchor);
      if (willHandlePromise) {
        // Need to preventDefault before the await, otherwise the browsers
        // default action kicks in.
        e.preventDefault();
        await willHandlePromise;
        return;
      }

      anchor.target = '_blank';
      anchor.rel = 'noopener';
    }
  }
});

// This list is probably not comprehensive.
let NON_TEXT_INPUT_TYPES = [
  'button',
  'checkbox',
  'file',
  'image',
  'radio',
  'submit',
];

function isEditable(element: Element) {
  if (element.tagName == 'INPUT' &&
      !NON_TEXT_INPUT_TYPES.includes((<HTMLInputElement>element).type))
    return true;

  if (element.tagName == 'TEXTAREA')
    return true;

  let parent: Element|null = element;
  while (parent) {
    let userModify = getComputedStyle(parent).webkitUserModify;
    if (userModify && userModify.startsWith('read-write'))
      return true;
    parent = parent.parentElement;
  }

  return false;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState == 'visible')
    update();
});

document.body.addEventListener('keydown', async (e) => {
  if (!getView())
    return;

  if (isEditable(<Element>e.target))
    return;

  if (e.key == '?') {
    new KeyboardShortcutsDialog();
    return;
  }

  if (getView().dispatchShortcut && !e.ctrlKey && !e.shiftKey && !e.altKey &&
      !e.metaKey)
    await getView().dispatchShortcut(e);
});

window.addEventListener('error', (e) => {
  ErrorLogger.log(
      e.error, JSON.stringify(e, ['body', 'error', 'message', 'stack']));
});

const NETWORK_OFFLINE_ERROR_MESSAGE =
    'A network error occurred. Are you offline?';
const FETCH_ERROR_MESSAGE =
    'A network error occurred, and the request could not be completed.';

// Different promise types stow a human understandable message in different
// places. :( Also, if we catch via a try/catch, then we need to pass the
// exception itself as an argument this function instead of e.reason.
function getErrorMessage(reason: any) {
  // Case: throw new Error('msg');
  let message = reason.message;

  // Cases: (gapi network failure) || fetch network failure
  let error = (reason.result && reason.result.error) || reason.error;
  // Case: gapi network failures.
  if (!message)
    message = error && error.message;

  if (error && error.code === -1 && message === FETCH_ERROR_MESSAGE)
    message = NETWORK_OFFLINE_ERROR_MESSAGE;

  return message;
}

window.addEventListener('unhandledrejection', (e) => {
  let reason = e.reason;
  // 401 means the credentials are invalid and you probably need to 2 factor.
  if (reason && reason.status == 401)
    window.location.reload();

  // Plain stringify will skip a bunch of things, so manually list out
  // everything we might care about. Add to this list over time as we find
  // other error types.
  let details = JSON.stringify(
      reason, ['stack', 'message', 'body', 'result', 'error', 'code']);

  let message = getErrorMessage(e.reason);
  if (message)
    ErrorLogger.log(message, details);
  else
    ErrorLogger.log(details);
});

window.addEventListener('offline', () => {
  AppShell.updateTitle('main.offline', 'No network connection...');
});

window.addEventListener('online', () => {
  AppShell.updateTitle('main.offline');
  update();
});
