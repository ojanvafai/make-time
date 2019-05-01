import {View} from './views/View.js';

export interface Action {
  name: string;
  shortName?: string;
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

let actions_: Map<string, Action[]> = new Map();
export function registerActions(viewName: string, actions: Action[]) {
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
  private actions_: Action[];

  constructor(private view_: View, private showHiddenActions_?: boolean) {
    super();
    this.style.display = 'flex';
    this.actions_ = [];
  }

  setActions(actions: Action[]) {
    this.actions_ = actions;
    this.render_();
  }

  private render_() {
    this.textContent = '';

    let renderMini = window.innerWidth < 600;

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
      if (!this.showHiddenActions_ && action.hidden)
        continue;

      let button = document.createElement('button');
      button.style.cssText = `
        white-space: nowrap;
        overflow: hidden;
        position: relative;
        user-select: none;
        min-width: 3em;
      `;

      if (renderMini) {
        button.style.paddingLeft = '1px';
        button.style.paddingRight = '1px';
      }

      button.setAttribute('tooltip', action.description);
      button.onclick = () => this.view_.takeAction(action);

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

        let tooltip = <string>button.getAttribute('tooltip');
        text.append(tooltip);
        tooltipElement.append(text);
        this.append(tooltipElement);
      };
      button.onpointerleave = () => {
        tooltipElement.remove();
      };

      if (renderMini) {
        button.innerHTML = action.shortName || action.name;
      } else {
        let key =
            action.key ? shortcutString(action.key) : action.name.charAt(0);
        let name = action.key ? `:${action.name}` : action.name.slice(1);
        button.innerHTML =
            `<span style="font-weight: bold; text-decoration: underline;">${
                key.toUpperCase()}</span>${name}`;
      }

      buttonContainer.append(button);
    }
  }

  matchesEvent_(e: KeyboardEvent, shortcut?: string|Shortcut) {
    if (!shortcut)
      return false;

    if (typeof shortcut === 'string')
      shortcut = new Shortcut(shortcut);
    return shortcut.matches(e);
  }

  async dispatchShortcut(e: KeyboardEvent) {
    let test = (action: Action) => {
      // Don't allow certain actions to apply in rapid succession for each
      // thread. This prevents accidents of archiving a lot of threads at once
      // when your stupid keyboard gets stuck holding the archive key down.
      // #sigh
      if (!action.repeatable && e.repeat)
        return false;

      return this.matchesEvent_(e, getPrimaryShortcut(action)) ||
          this.matchesEvent_(e, action.secondaryKey);
    };

    let action = this.actions_.find(test);
    if (action) {
      e.preventDefault();
      await this.view_.takeAction(action);
    }
  }
}
window.customElements.define('mt-actions', Actions);
