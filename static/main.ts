import {getActionKey, getActions} from './Actions.js';
import {defined, getCurrentWeekNumber, getDefinitelyExistsElementById, showDialog} from './Base.js';
// TODO: Clean up these dependencies to be less spaghetti.
import {firestore, getLabels, getServerStorage, getSettings, showHelp, updateLoaderTitle, updateTitle} from './BaseMain.js';
import {Calendar} from './calendar/Calendar.js';
import {Contacts} from './Contacts.js';
import {ErrorLogger} from './ErrorLogger.js';
import {IDBKeyVal} from './idb-keyval.js';
import {LongTasks} from './LongTasks.js';
import {ComposeModel} from './models/ComposeModel.js';
import {Model} from './models/Model.js';
import {ThreadListModel} from './models/ThreadListModel.js';
import {TodoModel} from './models/TodoModel.js';
import {TriageModel} from './models/TriageModel.js';
import {CONNECTION_FAILURE_KEY} from './Net.js';
import {Router} from './Router.js';
import {ServerStorage, ServerStorageUpdateEventName} from './ServerStorage.js';
import {CalendarView} from './views/CalendarView.js';
import {ComposeView} from './views/ComposeView.js';
import {HelpDialog} from './views/HelpDialog.js';
import {SettingsView} from './views/SettingsView.js';
import {ThreadListView} from './views/ThreadListView.js';
import {View} from './views/View.js';

let currentView_: View;

// Extract these before rendering any threads since the threads can have
// elements with IDs in them.
const content = getDefinitelyExistsElementById('content');
const drawer = getDefinitelyExistsElementById('drawer');
const hammburgerMenuToggle =
    getDefinitelyExistsElementById('hamburger-menu-toggle');
const backArrow = getDefinitelyExistsElementById('back-arrow');
const mainContent = getDefinitelyExistsElementById('main-content');
const subject = getDefinitelyExistsElementById('subject');

const UNIVERSAL_QUERY_PARAMETERS = ['bundle'];
let router = new Router(UNIVERSAL_QUERY_PARAMETERS);

let longTasks_: LongTasks;
async function updateLongTaskTracking() {
  // Read this setting out of local storage so we don't block on reading
  // settings from the network to set this up.
  if (await IDBKeyVal.getDefault().get(ServerStorage.KEYS.TRACK_LONG_TASKS)) {
    longTasks_ = new LongTasks();
    document.body.append(longTasks_);
  } else if (longTasks_) {
    longTasks_.remove();
  }
}
updateLongTaskTracking();

enum VIEW {
  Calendar,
  Compose,
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
// TODO: best-effort should not be a URL since it's not a proper view.
// or should it be a view instead?
router.add('/best-effort', async (_params) => {
  (await getTriageModel()).triageBestEffort();
  await router.run('/triage');
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
      return new Calendar();

    case VIEW.Compose:
      return new ComposeModel();

    case VIEW.Todo:
      return await getTodoModel();

    case VIEW.Triage:
      return await getTriageModel();

    case VIEW.Settings:
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
      return new CalendarView(<Calendar>model);

    case VIEW.Compose:
      return new ComposeView(<ComposeModel>model, params);

    case VIEW.Todo:
      return await createThreadListView(
          <TodoModel>model, false, '/triage', 'Back to Triaging');

    case VIEW.Triage:
      return await createThreadListView(
          <TriageModel>model, true, '/todo', 'Go to todo list');

    case VIEW.Settings:
      return new SettingsView(await getSettings());

    default:
      // Throw instead of asserting here so that TypeScript knows that this
      // function never returns undefined.
      throw new Error('This should never happen.');
  }
}

let viewGeneration = 0;
async function setView(viewType: VIEW, params?: any, shouldHideMenu?: boolean) {
  let thisViewGeneration = ++viewGeneration;

  showMenuButton(shouldHideMenu);

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

  content.textContent = '';
  content.append(currentView_);

  await currentView_.init();
}

let isUpdating_ = false;
let shouldUpdate_ = true;

function preventUpdates() {
  shouldUpdate_ = false;
}

function showMenuButton(hide?: boolean) {
  hammburgerMenuToggle.style.visibility = hide ? 'hidden' : 'visible';
}

let DRAWER_OPEN = 'drawer-open';
let CURRENT_PAGE_CLASS = 'current-page';

function showBackArrow(show: boolean) {
  hammburgerMenuToggle.style.display = show ? 'none' : '';
  backArrow.style.display = show ? '' : 'none';
}

function openMenu() {
  let menuItems =
      <NodeListOf<HTMLAnchorElement>>drawer.querySelectorAll('a.item');
  for (let item of menuItems) {
    if (item.pathname == location.pathname) {
      item.classList.add(CURRENT_PAGE_CLASS);
    } else {
      item.classList.remove(CURRENT_PAGE_CLASS);
    }
  }

  mainContent.classList.add(DRAWER_OPEN);
}

function closeMenu() {
  mainContent.classList.remove(DRAWER_OPEN);
}

function toggleMenu() {
  if (mainContent.classList.contains(DRAWER_OPEN))
    closeMenu();
  else
    openMenu();
}

backArrow.addEventListener('click', async () => {
  if (getView().goBack)
    await getView().goBack();
});

hammburgerMenuToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu();
});

mainContent.addEventListener('click', (e) => {
  if (mainContent.classList.contains(DRAWER_OPEN)) {
    e.preventDefault();
    closeMenu();
  }
})

async function createThreadListView(
    model: ThreadListModel, countDown: boolean, bottomButtonUrl: string,
    bottomButtonText: string) {
  let settings = await getSettings();
  let autoStartTimer = settings.get(ServerStorage.KEYS.AUTO_START_TIMER);
  let timerDuration = settings.get(ServerStorage.KEYS.TIMER_DURATION);
  let allowedReplyLength =
      settings.get(ServerStorage.KEYS.ALLOWED_REPLY_LENGTH);

  return new ThreadListView(
      model, await getLabels(), content, updateLoaderTitle, setSubject,
      showBackArrow, allowedReplyLength, autoStartTimer, countDown,
      timerDuration, bottomButtonUrl, bottomButtonText);
}

async function resetModels() {
  triageModel_ = undefined;
  todoModel_ = undefined;
}

let triageModel_: TriageModel|undefined;
async function getTriageModel() {
  if (!triageModel_) {
    let settings = await getSettings();
    let vacation = settings.get(ServerStorage.KEYS.VACATION);
    triageModel_ = new TriageModel(vacation, await getLabels(), settings);
  }
  return triageModel_;
}

let todoModel_: TodoModel|undefined;
async function getTodoModel() {
  if (!todoModel_) {
    let settings = await getSettings();
    let vacation = settings.get(ServerStorage.KEYS.VACATION);
    todoModel_ = new TodoModel(vacation, await getLabels());
  }
  return todoModel_;
}

function setSubject(...items: (string|Node)[]) {
  subject.textContent = '';
  subject.append(...items);
}

function createMenuItem(name: string, options: any) {
  let a = document.createElement('a');
  a.append(name);
  a.className = 'item';

  if (options.nested)
    a.classList.add('nested');

  if (options.href)
    a.href = options.href;

  if (options.onclick)
    a.onclick = options.onclick;

  a.addEventListener('click', closeMenu);
  return a;
}

function appendMenu() {
  let helpButton = createMenuItem('Help', {
    onclick: async () => showHelp(),
  });

  let menuTitle = document.createElement('div');
  menuTitle.append('MakeTime phases');

  drawer.append(
      menuTitle, createMenuItem('Compose', {href: '/compose', nested: true}),
      createMenuItem('Triage', {href: '/triage', nested: true}),
      createMenuItem('Todo', {href: '/todo', nested: true}),
      createMenuItem('Calendar (alpha)', {href: '/calendar'}),
      createMenuItem('Settings', {href: '/settings'}), helpButton);
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

  appendMenu();
  await routeToCurrentLocation();
  await update();
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

    // Don't do updates if a new server version has been pushed and we will be
    // reloading soon since we don't want conflicting updaters to run on
    // different clients.
    let todoModel = await getTodoModel();
    let triageModel = await getTriageModel();
    todoModel.stopUpdating();
    triageModel.stopUpdating();

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
  if (!shouldUpdate_)
    return;

  // update can get called before any views are setup due to visibilitychange
  // and online handlers
  let view = await getView();
  if (!view || isUpdating_)
    return;
  isUpdating_ = true;

  try {
    // Do the todo model first since it doens't need to send anything through
    // MailProcessor, so is relatively constant time.
    let todoModel = await getTodoModel();
    let triageModel = await getTriageModel();
    await Promise.all(
        [todoModel.update(), triageModel.update(), view.update()]);

    await dailyLocalUpdates();
  } catch (e) {
    // TODO: Move this to Net.js once we've made it so that all network requests
    // that fail due to being offline get retried.
    if (getErrorMessage(e) === NETWORK_OFFLINE_ERROR_MESSAGE) {
      updateTitle(
          CONNECTION_FAILURE_KEY, 'Having trouble connecting to internet...');
    } else {
      throw e;
    }
  } finally {
    isUpdating_ = false;
  }
}

window.addEventListener(CONNECTION_FAILURE_KEY, () => {
  // Net.js fires this when a network request succeeds, which indicates we're no
  // longer offline.
  updateTitle(CONNECTION_FAILURE_KEY);
});

// Make sure links open in new tabs.
document.body.addEventListener('click', async (e) => {
  for (let node of e.path) {
    if (node.tagName == 'A') {
      let anchor = <HTMLAnchorElement>node;
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

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState == 'visible')
    update();
});

function showKeyboardShorcuts() {
  let table = document.createElement('table');

  let actions = getActions();
  let isFirst = true;
  for (let entry of actions) {
    let viewName = entry[0];
    let actions = entry[1];

    let headerRow = document.createElement('tr');
    if (!isFirst) {
      headerRow.style.cssText = `
        height: 40px;
        vertical-align: bottom;
      `;
    }
    isFirst = false;
    table.append(headerRow);

    headerRow.append(document.createElement('td'));

    let headerCell = document.createElement('td');
    headerCell.style.cssText = `
      font-weight: bold;
    `;
    headerCell.append(viewName);
    headerRow.append(headerCell);

    // TODO: These should probably be presented in a deliberate order and
    // grouped, e.g. navigation actions adjacent to each other.
    for (let action of actions) {
      let row = document.createElement('tr');
      table.append(row);

      let key = getActionKey(action);
      switch (key) {
        case ' ':
          key = '<space>';
          break;
        case 'Escape':
          key = '<esc>';
          break;
        case 'Enter':
          key = '<enter>';
          break;
      }

      let shortcut = document.createElement('td');
      shortcut.style.cssText = `
        font-weight: bold;
        color: green;
        text-align: right;
        padding-right: 4px;
      `;
      shortcut.append(key);
      row.append(shortcut);

      let name = document.createElement('td');
      name.style.cssText = `
        white-space: nowrap;
        padding-right: 10px;
      `;
      name.append(action.name);
      row.append(name);

      let description = document.createElement('td');
      description.append(action.description);
      row.append(description);
    }
  }

  let container = document.createElement('div');
  container.append('Keyboard Shortcuts', document.createElement('hr'), table);
  new HelpDialog(container);
}

document.body.addEventListener('keydown', async (e) => {
  if (!getView())
    return;

  if (isEditable(<Element>e.target))
    return;

  if (e.key == '?') {
    showKeyboardShorcuts();
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
  // everything we might care about. Add to this list over time as we find other
  // error types.
  let details = JSON.stringify(
      reason, ['stack', 'message', 'body', 'result', 'error', 'code']);

  let message = getErrorMessage(e.reason);
  if (message)
    ErrorLogger.log(message, details);
  else
    ErrorLogger.log(details);
});

window.addEventListener('offline', () => {
  updateTitle('main.offline', 'No network connection...');
});

window.addEventListener('online', () => {
  updateTitle('main.offline');
  update();
});
