import {View} from './views/View.js';

export interface Action {
  name: string;
  description: string;
  key?: Shortcut|string;
  secondaryKey?: Shortcut|string;
  hidden?: boolean;
  repeatable?: boolean;
}

interface ButtonWithAction extends HTMLButtonElement {
  action: Action;
}

const USES_META_FOR_CTRL = navigator.platform.includes('Mac');

export class Shortcut {
  constructor(
      public key: string, public ctrlMeta?: boolean, public shift?: boolean,
      public code?: string) {}

  toString() {
    let val = '';
    if (this.ctrlMeta)
      val += USES_META_FOR_CTRL ? '<cmd> + ' : '<ctrl> + ';
    if (this.shift)
      val += '<shift> + ';
    return val + humanReadableKeyName(this.key);
  }

  matches(e: KeyboardEvent) {
    return (this.code ? this.code === e.code : this.key === e.key) &&
        !!this.shift === e.shiftKey &&
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
  private supplementalActions_: (Action|Action[])[];
  private menu_?: HTMLElement;
  private tooltip_?: HTMLElement;

  constructor(private view_: View) {
    super();
    this.style.display = 'flex';
    this.actions_ = [];
    this.supplementalActions_ = [];
  }

  setActions(
      actions: (Action|Action[])[], supplementalActions?: (Action|Action[])[]) {
    this.actions_ = actions;
    this.supplementalActions_ = supplementalActions || [];
    this.render_();
  }

  private render_() {
    this.textContent = '';

    let container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      flex: 1;
      justify-content: center;
      align-items: center;
    `;
    this.append(container);

    for (let action of this.actions_) {
      this.createButtonList_(action, container);
    }
  }

  private createButtonList_(action: Action|Action[], container: HTMLElement) {
    let button: ButtonWithAction|null;
    if (Array.isArray(action)) {
      let actionList = action as Action[];
      button = this.createButton_(actionList[0]);
      if (button) {
        button.classList.add('centered-up-arrow');

        let updateMenuItemHover = (e: PointerEvent) => {
          // TODO: unify hover handling for menu and non-menu buttons.
          // Right now non-menu buttons are handled in global stylesheet.
          if (!this.menu_)
            return;

          let hitElement = document.elementFromPoint(e.x, e.y);
          for (let child of this.menu_.children) {
            let element = child as HTMLElement;
            element.style.backgroundColor =
                element === hitElement ? '#ccc' : '#fff';
          }
        };

        button.addEventListener('pointermove', updateMenuItemHover);

        button.addEventListener('pointerdown', (e: PointerEvent) => {
          this.openMenu_(e.target as HTMLButtonElement, actionList.slice(1));

          // Set this so we can have the same implementation for touch and
          // mouse since touch does this implicitly.
          button!.setPointerCapture(e.pointerId);
          updateMenuItemHover(e);
        });
      }
    } else {
      button = this.createButton_(action);
    }

    if (!button)
      return;

    container.append(button);

    button.addEventListener('pointerup', (e: PointerEvent) => {
      let hitElement = document.elementFromPoint(e.x, e.y);
      if (hitElement === button ||
          (this.menu_ && this.menu_.contains(hitElement))) {
        this.view_.takeAction((hitElement as ButtonWithAction).action);
      }

      if (this.menu_)
        this.menu_.remove();
      this.menu_ = undefined;
    });
  }

  private openMenu_(button: HTMLElement, actions: Action[]) {
    if (this.tooltip_)
      this.tooltip_.remove();

    this.menu_ = document.createElement('div');
    for (let subAction of actions.reverse()) {
      let button = this.createButton_(subAction);
      if (button)
        this.menu_.append(button);
    }

    this.menu_.style.cssText = `
      position: fixed;
      display: flex;
      flex-direction: column;
      border-radius: 5px;
      min-width: 50vw;
    `;
    document.body.append(this.menu_);

    let buttonRect = button.getBoundingClientRect();
    let menuWidth = this.menu_.offsetWidth;
    this.menu_.style.bottom = `${window.innerHeight - buttonRect.top}px`;
    // Center the menu over the button.
    this.menu_.style.left = `${
        buttonRect.left - (Math.max(0, (menuWidth - buttonRect.width)) / 2)}px`;
  }

  createButton_(action: Action) {
    if (action.hidden)
      return null;

    let button = document.createElement('button') as ButtonWithAction;
    button.className = 'mktime-button';
    button.style.cssText = `
      white-space: nowrap;
      overflow: hidden;
      position: relative;
      user-select: none;
      min-width: 3em;
      touch-action: none;
    `;

    button.action = action;
    button.onpointerleave = () => this.tooltip_!.remove();
    button.onpointerenter = () => this.appendTooltip_(action);
    button.append(action.name);

    return button;
  }

  private appendTooltip_(action: Action) {
    this.tooltip_ = document.createElement('div');
    this.tooltip_.style.cssText = `
      position: absolute;
      bottom: ${this.offsetHeight}px;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      pointer-events: none;
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

    let bold = document.createElement('b');
    bold.append(`${key}: `);
    text.append(bold, action.description);
    this.tooltip_.append(text);

    this.append(this.tooltip_);
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
