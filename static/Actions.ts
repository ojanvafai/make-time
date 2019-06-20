import {View} from './views/View.js';

export interface Action {
  name: string;
  description: string;
  key?: Shortcut|string;
  secondaryKey?: Shortcut|string;
  hidden?: boolean;
  repeatable?: boolean;
}

const USES_META_FOR_CTRL = navigator.platform.includes('Mac');

export class Shortcut {
  constructor(
      public key: string, public ctrlMeta?: boolean, public shift?: boolean) {}

  toString() {
    let val = '';
    if (this.ctrlMeta)
      val += USES_META_FOR_CTRL ? '<cmd> + ' : '<ctrl> + ';
    if (this.shift)
      val += '<shift> + ';
    return val + humanReadableKeyName(this.key);
  }

  matches(e: KeyboardEvent) {
    return this.key === e.key && !!this.shift === e.shiftKey &&
        (USES_META_FOR_CTRL ? !!this.ctrlMeta === e.metaKey :
                              !!this.ctrlMeta === e.ctrlKey)
  }
}

function humanReadableKeyName(key: string) {
  switch (key) {
    case ' ':
      return '<space>';
    case 'ArrowDown':
      return '⬇';
    case 'ArrowUp':
      return '⬆';
    case 'Escape':
      return '<esc>';
    case 'Enter':
      return '<enter>';
    default:
      return key;
  }
}

export function shortcutString(shortcut: Shortcut|string) {
  if (typeof shortcut === 'string')
    return humanReadableKeyName(shortcut);
  return shortcut.toString();
}

let actions_: Map<string, (Action | Action[])[]> = new Map();
export function registerActions(
    viewName: string, actions: (Action|Action[])[]) {
  actions_.set(viewName, actions);
}

export function getActions() {
  return actions_;
}

// TODO: Should probably make Action a proper class and put this on Action.
export function getPrimaryShortcut(action: Action) {
  if (action.key)
    return action.key;
  return action.name.charAt(0).toLowerCase();
}

export class Actions extends HTMLElement {
  private actions_: (Action|Action[])[];
  private supplementalActions_: Action[];
  private menu_?: HTMLElement;

  constructor(private view_: View) {
    super();
    this.style.display = 'flex';
    this.actions_ = [];
    this.supplementalActions_ = [];
  }

  setActions(actions: (Action|Action[])[], supplementalActions?: Action[]) {
    this.actions_ = actions;
    this.supplementalActions_ = supplementalActions || [];
    this.render_();
  }

  private render_() {
    this.textContent = '';

    // window.innerWidth makes more logical sense for this, but chrome has bugs.
    // crbug.com/960803.
    let renderMini = window.outerWidth < 600;

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      flex: 1;
      justify-content: center;
      align-items: center;
    `;
    this.append(buttonContainer);

    for (let action of this.actions_) {
      if (Array.isArray(action)) {
        let actionList = action as Action[];
        let button = this.createButton_(actionList[0], renderMini);
        if (button) {
          buttonContainer.append(button);
          button.addEventListener('pointerdown', (e: Event) => {
            this.openMenu_(
                e.target as HTMLButtonElement, renderMini, actionList.slice(1));
          });
        }
        continue;
      }

      let button = this.createButton_(action, renderMini);
      if (button)
        buttonContainer.append(button);
    }
  }

  private openMenu_(
      button: HTMLElement, renderMini: boolean, actions: Action[]) {
    // Since we reuse the menu if it was left open due to pointerup
    // outside the menu, clear the contents.
    if (this.menu_)
      this.menu_.textContent = '';

    this.menu_ = document.createElement('div');
    for (let subAction of actions.reverse()) {
      let button = this.createButton_(subAction, renderMini, true);
      if (button)
        this.menu_.append(button);
    }

    // TODO: Center the menu above the button
    let rect = button.getBoundingClientRect();
    this.menu_.style.cssText = `
        position: fixed;
        bottom: ${window.innerHeight - rect.top}px;
        left: ${rect.left}px;
        display: flex;
        flex-direction: column;
      `;
    document.body.append(this.menu_);

    // TODO: Capture pointer up on the whole document so we close the menu
    // if you pointer up not on a button.
    button.addEventListener('pointerup', () => {this.removeMenu_()});
  }

  removeMenu_() {
    if (this.menu_)
      this.menu_.remove();
  }

  createButton_(action: Action, renderMini: boolean, isSubAction?: boolean) {
    if (action.hidden)
      return null;

    let button = document.createElement('button');
    button.className = 'mktime-button';
    button.style.cssText = `
      white-space: nowrap;
      overflow: hidden;
      position: relative;
      user-select: none;
      min-width: 3em;
    `;

    // TODO: Make this color match the theme.
    if (isSubAction)
      button.style.backgroundColor = '#fff';

    if (renderMini) {
      button.style.paddingLeft = '1px';
      button.style.paddingRight = '1px';
    }

    button.setAttribute('tooltip', action.description);

    button.addEventListener(isSubAction ? 'pointerup' : 'click', () => {
      this.removeMenu_();
      this.view_.takeAction(action);
    });

    let tooltipElement: HTMLElement;
    button.onpointerenter = () => {
      tooltipElement = document.createElement('div');
      tooltipElement.style.cssText = `
        position: absolute;
        bottom: ${this.offsetHeight}px;
        left: 0;
        right: 0;
        display: flex;
        justify-content: center;
      `;

      let text = document.createElement('div');
      text.style.cssText = `
        background-color: #ffffff;
        border: 1px solid;
        padding: 4px;
        width: 300px;
      `;

      let key = action.key ? shortcutString(action.key) :
                             action.name.charAt(0).toLowerCase();

      let tooltip = <string>button.getAttribute('tooltip');
      let bold = document.createElement('b');
      bold.append(`${key}: `);
      text.append(bold, tooltip);
      tooltipElement.append(text);
      this.append(tooltipElement);
    };
    button.onpointerleave = () => {
      tooltipElement.remove();
    };

    button.append(action.name);
    return button;
  }

  static matchesEvent_(e: KeyboardEvent, shortcut?: string|Shortcut) {
    if (!shortcut)
      return false;

    if (typeof shortcut === 'string')
      shortcut = new Shortcut(shortcut);
    return shortcut.matches(e);
  }

  static matchesAction(e: KeyboardEvent, action: Action) {
    // Don't allow certain actions to apply in rapid succession for each
    // thread. This prevents accidents of archiving a lot of threads at once
    // when your stupid keyboard gets stuck holding the archive key down.
    // #sigh
    if (!action.repeatable && e.repeat)
      return false;

    return this.matchesEvent_(e, getPrimaryShortcut(action)) ||
        this.matchesEvent_(e, action.secondaryKey);
  }

  static getMatchingAction(e: KeyboardEvent, actions: (Action|Action[])[]) {
    for (let action of actions) {
      if (Array.isArray(action)) {
        let match = action.find(x => this.matchesAction(e, x));
        if (match)
          return match;
      } else if (this.matchesAction(e, action)) {
        return action;
      }
    }
    return null;
  }

  async dispatchShortcut(e: KeyboardEvent) {
    let action = Actions.getMatchingAction(e, this.actions_) ||
        Actions.getMatchingAction(e, this.supplementalActions_);
    if (action) {
      e.preventDefault();
      await this.view_.takeAction(action);
    }
  }
}
window.customElements.define('mt-actions', Actions);
