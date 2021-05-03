import { createMktimeButton, defined, isMobileUserAgent, isSafari, notNull } from './Base.js';
import { View } from './views/View.js';

export enum ActionGroup {
  Ignore = 'ignore',
  Priority = 'priority',
  Date = 'date',
  Other = 'other',
  Reply = 'reply',
}

export interface Action {
  name: string | HTMLElement | SVGElement;
  description: string;
  key: Shortcut | string;
  secondaryKey?: Shortcut | string;
  hidden?: boolean;
  repeatable?: boolean;
  actionGroup?: ActionGroup;
  disabled?: boolean;
}

type SubActionRow = Action[];
type GroupedActions = (Action | SubActionRow)[];
// TODO: Make this a proper class so it can have an iterator instead of needing
// to know to use flat(2).
export type ActionList = (Action | GroupedActions)[];

interface ButtonWithAction extends HTMLButtonElement {
  action: Action;
}

const USES_META_FOR_CTRL = ['iPhone', 'iPad', 'Mac'].find((x) => navigator.platform.includes(x));
const MARGIN = 4;

export function primaryModifierKey(e: KeyboardEvent) {
  return USES_META_FOR_CTRL ? e.metaKey : e.ctrlKey;
}

export class Shortcut {
  constructor(
    public key: string,
    public ctrlMeta?: boolean,
    public shift?: boolean,
    public code?: string,
  ) {}

  toString() {
    let val = '';
    if (this.ctrlMeta) val += USES_META_FOR_CTRL ? '⌘+' : '^+';
    if (this.shift) val += '<shift>+';
    return val + humanReadableKeyName(this.key);
  }

  matches(e: KeyboardEvent) {
    return (
      (this.code ? this.code === e.code : this.key === e.key) &&
      !!this.shift === e.shiftKey &&
      !!this.ctrlMeta === primaryModifierKey(e)
    );
  }
}

function humanReadableKeyName(key: string) {
  switch (key) {
    case ' ':
      return '<space>';
    // TODO: Replace the unicode characters with SVGs.
    case 'ArrowDown':
      return '⇩';
    case 'ArrowUp':
      return '⇧';
    case 'ArrowLeft':
      return '⇦';
    case 'ArrowRight':
      return '⇨';
    case 'Escape':
      return '<esc>';
    case 'Enter':
      return '<enter>';
    default:
      return key;
  }
}

export function shortcutString(shortcut: Shortcut | string) {
  if (typeof shortcut === 'string') return humanReadableKeyName(shortcut);
  return shortcut.toString();
}

let actions_: Map<string, ActionList> = new Map();
export function registerActions(viewName: string, actions: ActionList) {
  actions_.set(viewName, actions);
}

export function getActions() {
  return actions_;
}

export function cloneAndDisable(action: Action) {
  const clone = { ...action };
  clone.disabled = true;
  return clone;
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

  enable() {
    this.classList.remove('quieter', 'noevents');
  }

  disable() {
    this.disableElement_(this);
  }

  private disableElement_(element: HTMLElement) {
    element.classList.add('quieter', 'noevents');
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

  private setTextSelectionEnabledMobileSafari_(isEnabled: boolean) {
    // -webkit-user-select: none on iOS still selects surrounding text
    // when you long press on a button. Prevent selection on the whole
    // page when the pointer is down on a toolbar button.
    if (isMobileUserAgent() && isSafari()) {
      document.documentElement.style.webkitUserSelect = isEnabled ? '' : 'none';
    }
  }

  private createButtonList_(action: Action | GroupedActions, container: HTMLElement) {
    let button: ButtonWithAction | null;
    if (Array.isArray(action)) {
      let actionList = action as Action[];
      button = this.createButton_(actionList[0]);
      if (button) {
        button.classList.add('centered-up-arrow');

        let updateMenuItemHover = (e: PointerEvent) => {
          // TODO: unify hover handling for menu and non-menu buttons.
          // Right now non-menu buttons are handled in global stylesheet.
          if (!this.menu_) return;

          let hitButton = this.hitButton_(e);
          this.updateTooltip_(hitButton ? hitButton.action : null, this.menu_);

          for (let child of this.menu_.querySelectorAll('.mktime-button')) {
            let element = child as HTMLElement;
            element.style.backgroundColor =
              element === hitButton ? 'var(--border-and-hover-color)' : '';
          }
        };

        button.addEventListener('pointermove', updateMenuItemHover);

        button.addEventListener('pointerdown', (e: PointerEvent) => {
          this.setTextSelectionEnabledMobileSafari_(false);

          let firstAction = actionList.slice(1);
          this.openMenu_(button!, firstAction);
          updateMenuItemHover(e);

          // Set this so we can have the same implementation for touch and
          // mouse since touch does this implicitly.
          button!.setPointerCapture(e.pointerId);
        });
      }
    } else {
      button = this.createButton_(action);
    }

    if (!button) return;

    container.append(button);

    button.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        this.view_.takeAction(notNull(button).action);
        // Prevent the threadlist from consuming the action to show the
        // currently focused thread.
        e.stopPropagation();
      }
    });

    button.addEventListener('pointerup', (e: MouseEvent) => {
      this.setTextSelectionEnabledMobileSafari_(true);

      // rAF to avoid triggering click events on elements that aren't yet in the
      // DOM to workaround crbug.com/988262.
      requestAnimationFrame(() => this.handlePointerUp_(button!, e));
    });
  }

  private handlePointerUp_(button: ButtonWithAction, e: MouseEvent) {
    let hitButton = this.hitButton_(e);
    if (hitButton && (hitButton === button || (this.menu_ && this.menu_.contains(hitButton)))) {
      this.view_.takeAction(hitButton.action);
    }

    if (this.menu_) this.menu_.remove();
    this.menu_ = undefined;

    if (this.tooltip_) this.centerAbove_(this.tooltip_, button!);
  }

  private hitButton_(e: MouseEvent) {
    let hitElement = document.elementFromPoint(e.x, e.y) as Node | null;
    let buttonWithAction;
    while (hitElement && !buttonWithAction) {
      let asButtonWithAction = hitElement as ButtonWithAction;
      if (asButtonWithAction.action) return asButtonWithAction;
      hitElement = hitElement.parentNode;
    }
    return null;
  }

  private openMenu_(button: HTMLElement, actions: ActionList) {
    this.menu_ = document.createElement('div');
    this.menu_.className = 'toolbar';
    this.menu_.style.cssText = `
      position: fixed;
      margin: 0;
      border-radius: 5px 5px 0 0;
      overflow: hidden;
      background-color: var(--main-background);
    `;
    document.body.append(this.menu_);

    for (let subActionList of actions) {
      if (!Array.isArray(subActionList)) subActionList = [subActionList];
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex;
        justify-content: center;
        background-color: var(--nested-background-color);
      `;
      for (let subAction of subActionList) {
        let menuButton = this.createButton_(subAction as Action);
        if (menuButton) {
          menuButton.style.cssText = `
            margin: 6px;
            width: 70px;
            height: 70px;
            font-size: 30px;
          `;
          row.append(menuButton);
        }
      }
      this.menu_.prepend(row);
    }

    // Put a bigger margin on mobile so that you can see the button under your
    // finger.
    this.centerAbove_(this.menu_, button, isMobileUserAgent() ? 20 : 0);
    if (this.tooltip_) this.centerAbove_(this.tooltip_, this.menu_);
  }

  centerAbove_(element: HTMLElement, relativeTo: HTMLElement, extraBottomMargin?: number) {
    let rect = relativeTo.getBoundingClientRect();
    let itemWidth = element.offsetWidth;

    let bottomMargin = MARGIN;
    if (extraBottomMargin) bottomMargin += extraBottomMargin;

    element.style.bottom = `${window.innerHeight - rect.top + bottomMargin}px`;
    // Center the menu over the reference, but keep it bound within the window.
    element.style.left = `${Math.max(
      MARGIN,
      Math.min(
        window.innerWidth - itemWidth - MARGIN,
        rect.left - Math.max(0, itemWidth - rect.width) / 2,
      ),
    )}px`;
  }

  createButton_(action: Action) {
    if (action.hidden) return null;

    let name = document.createElement('div');
    name.style.cssText = `
        position: absolute;
        left: 0px;
        right: 0px;
        bottom: 2px;
        color: var(--dim-text-color);
        font-size: 0.5em;
      `;
    name.append(action.name);

    let button = createMktimeButton(
      undefined,
      shortcutString(action.key),
      name,
    ) as ButtonWithAction;
    button.classList.add('action-button');
    button.action = action;
    button.onpointerleave = () => this.tooltip_!.remove();
    button.onpointerenter = () => {
      this.appendTooltip_(action);
      this.centerAbove_(this.tooltip_!, button);
    };
    button.oncontextmenu = (e: Event) => e.preventDefault();

    if (action.actionGroup) button.classList.add(`group-${action.actionGroup}`);

    if (action.disabled) {
      this.disableElement_(button);
    }

    return button;
  }

  private updateTooltip_(action: Action | null, relativeTo: HTMLElement) {
    let tooltip = defined(this.tooltip_);
    if (!action) {
      tooltip.style.display = 'none';
      return;
    }
    tooltip.style.display = '';
    tooltip.textContent = '';
    tooltip.append(action.description);
    this.centerAbove_(tooltip, relativeTo);
  }

  private appendTooltip_(action: Action) {
    this.tooltip_ = document.createElement('div');
    this.tooltip_.style.cssText = `
      position: absolute;
      display: flex;
      background-color: var(--overlay-background-color);
      border: 1px solid var(--border-and-hover-color);
      border-radius: 2px;
      color: var(--dim-text-color);
      padding: 4px;
      width: 300px;
    `;

    this.append(this.tooltip_);
    this.updateTooltip_(action, this);
  }

  static matchesEvent_(e: KeyboardEvent, shortcut?: string | Shortcut) {
    if (!shortcut) return false;

    if (typeof shortcut === 'string') shortcut = new Shortcut(shortcut);
    return shortcut.matches(e);
  }

  static matchesAction(e: KeyboardEvent, action: Action) {
    // Don't allow certain actions to apply in rapid succession for each
    // thread. This prevents accidents of archiving a lot of threads at once
    // when your stupid keyboard gets stuck holding the archive key down.
    // #sigh
    if (!action.repeatable && e.repeat) return false;

    return this.matchesEvent_(e, action.key) || this.matchesEvent_(e, action.secondaryKey);
  }

  static getMatchingAction(e: KeyboardEvent, actions: ActionList) {
    for (let action of actions.flat()) {
      if (Array.isArray(action)) {
        let match = action.find((x) => this.matchesAction(e, x));
        if (match) return match;
      } else if (this.matchesAction(e, action)) {
        return action;
      }
    }
    return null;
  }

  async dispatchShortcut(e: KeyboardEvent) {
    let action =
      Actions.getMatchingAction(e, this.actions_) ||
      Actions.getMatchingAction(e, this.supplementalActions_);
    if (action) {
      e.preventDefault();
      return await this.view_.takeAction(action);
    }
    return false;
  }
}
window.customElements.define('mt-actions', Actions);
