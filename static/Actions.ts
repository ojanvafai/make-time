import {createMktimeButton, notNull} from './Base.js';
import {View} from './views/View.js';

export interface Action {
  name: string|HTMLElement|SVGElement;
  description: string;
  key: Shortcut|string;
  secondaryKey?: Shortcut|string;
  hidden?: boolean;
  repeatable?: boolean;
}

export type ActionList = (Action|Action[])[];

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
    // TODO: Replace the unicode characters with SVGs.
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

let actions_: Map<string, ActionList> = new Map();
export function registerActions(viewName: string, actions: ActionList) {
  actions_.set(viewName, actions);
}

export function getActions() {
  return actions_;
}

export class Actions extends HTMLElement {
  private actions_: ActionList;
  private supplementalActions_: ActionList;
  private menu_?: HTMLElement;
  private tooltip_?: HTMLElement;

  constructor(private view_: View) {
    super();
    this.style.display = 'flex';
    this.actions_ = [];
    this.supplementalActions_ = [];
  }

  setActions(actions: ActionList, supplementalActions?: ActionList) {
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

          let hitButton = this.hitButton_(e);
          for (let child of this.menu_.children) {
            let element = child as HTMLElement;
            element.style.backgroundColor = element === hitButton ?
                'var(--border-and-hover-color)' :
                'var(--overlay-background-color)';
          }
        };

        button.addEventListener('pointermove', updateMenuItemHover);

        button.addEventListener('pointerdown', (e: PointerEvent) => {
          this.openMenu_(e.target as HTMLButtonElement, actionList.slice(1));
          updateMenuItemHover(e);

          // Set this so we can have the same implementation for touch and
          // mouse since touch does this implicitly.
          button!.setPointerCapture(e.pointerId);
        });
      }
    } else {
      button = this.createButton_(action);
    }

    if (!button)
      return;

    container.append(button);

    button.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        this.view_.takeAction(notNull(button).action);
        // Prevent the threadlist from consuming the action to show the
        // currently focused thread.
        e.stopPropagation();
      }
    });

    button.addEventListener('pointerup', (e: PointerEvent) => {
      let hitButton = this.hitButton_(e);
      if (hitButton &&
          (hitButton === button ||
           (this.menu_ && this.menu_.contains(hitButton)))) {
        this.view_.takeAction(hitButton.action);
      }

      if (this.menu_)
        this.menu_.remove();
      this.menu_ = undefined;
    });
  }

  private hitButton_(e: PointerEvent) {
    let hitElement = document.elementFromPoint(e.x, e.y) as Node | null;
    let buttonWithAction;
    while (hitElement && !buttonWithAction) {
      let asButtonWithAction = hitElement as ButtonWithAction;
      if (asButtonWithAction.action)
        return asButtonWithAction;
      hitElement = hitElement.parentNode;
    }
    return null;
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
      border-radius: 3px;
      width: 50vw;
      max-width: 200px;
      background-color: var(--overlay-background-color);
      border: 1px solid var(--border-and-hover-color);
    `;
    document.body.append(this.menu_);

    let buttonRect = button.getBoundingClientRect();
    let menuWidth = this.menu_.offsetWidth;
    this.menu_.style.bottom = `${window.innerHeight - buttonRect.top + 4}px`;
    // Center the menu over the button, but keep it bound withing the window.
    this.menu_.style.left = `${
        Math.max(
            0,
            Math.min(
                window.innerWidth - menuWidth,
                buttonRect.left -
                    (Math.max(0, (menuWidth - buttonRect.width)) / 2)))}px`;
  }

  createButton_(action: Action) {
    if (action.hidden)
      return null;

    let button = createMktimeButton(action.name) as ButtonWithAction;
    button.action = action;
    button.onpointerleave = () => this.tooltip_!.remove();
    button.onpointerenter = () => this.appendTooltip_(action);
    return button;
  }

  private appendTooltip_(action: Action) {
    this.tooltip_ = document.createElement('div');
    this.tooltip_.style.cssText = `
      position: absolute;
      bottom: ${this.offsetHeight + 4}px;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      pointer-events: none;
    `;

    let text = document.createElement('div');
    text.style.cssText = `
      background-color: var(--overlay-background-color);
      border: 1px solid;
      padding: 4px;
      width: 300px;
    `;

    let bold = document.createElement('b');
    bold.append(`${shortcutString(action.key)}: `);
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

    return this.matchesEvent_(e, action.key) ||
        this.matchesEvent_(e, action.secondaryKey);
  }

  static getMatchingAction(e: KeyboardEvent, actions: ActionList) {
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
