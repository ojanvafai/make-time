import {defined} from './Base.js';
import {View} from './views/View.js';

export interface Action {
  name: string;
  shortName?: string;
  description: string;
  key?: string;
  hidden?: boolean;
  repeatable?: boolean;
  destination?: string|null;
}

let actions_: Map<string, Action[]> = new Map();
export function registerActions(viewName: string, actions: Action[]) {
  actions_.set(viewName, actions);
}

export function getActions() {
  return actions_;
}

// TODO: Should probably make Action a proper class and put this on Action.
export function getActionKey(action: Action) {
  if (action.key)
    return action.key;
  return action.name.charAt(0).toLowerCase();
}

export class Actions extends HTMLElement {
  private actions_: Action[];
  private overflow_?: Action[];
  private showOverfow_: boolean;

  constructor(private view_: View) {
    super();
    this.style.display = 'flex';

    this.actions_ = [];
    this.overflow_ = [];
    this.showOverfow_ = false;
  }

  setActions(actions: Action[], overflow?: Action[]) {
    this.actions_ = actions;
    this.overflow_ = overflow;
    this.render_();
  }

  allActions_() {
    return [...this.actions_, ...defined(this.overflow_)];
  }

  private render_() {
    this.textContent = '';

    let renderMini = !this.showOverfow_ && window.innerWidth < 600;
    let actions =
        (!renderMini && this.overflow_) ? this.allActions_() : this.actions_;

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      flex-wrap: wrap;
    `;
    this.append(buttonContainer);

    let backgroundColor = '#ddd';

    for (let action of actions) {
      if (action.hidden)
        continue;

      let button = document.createElement('button');
      button.style.cssText = `
        white-space: nowrap;
        overflow: hidden;
        max-width: max-content;
        min-width: 2em;
        position: relative;
        background-color: ${backgroundColor};
        user-select: none;
      `;

      if (renderMini) {
        button.style.flex = '1 1 0';
        button.style.paddingLeft = '1px';
        button.style.paddingRight = '1px';
      }

      button.setAttribute('tooltip', action.description);
      button.onclick = () => this.takeAction(action);

      let tooltipElement: HTMLElement;
      button.onmouseenter = () => {
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
          background-color: white;
          border: 1px solid;
          padding: 4px;
          width: 300px;
        `;

        let tooltip = <string>button.getAttribute('tooltip');
        text.append(tooltip);
        tooltipElement.append(text);
        this.append(tooltipElement);
      };
      button.onmouseleave = () => {
        tooltipElement.remove();
      };

      if (renderMini) {
        button.innerHTML = action.shortName || action.name;
      } else {
        let key = action.key || action.name.charAt(0);
        let name = action.key ? `:${action.name}` : action.name.slice(1);
        button.innerHTML =
            `<span class="shortcut">${key.toUpperCase()}</span>${name}`;
      }

      buttonContainer.append(button);
    }

    if (window.innerWidth < 600) {
      let overflowButton = document.createElement('div');
      overflowButton.style.cssText = `
        font-weight: bold;
        font-size: 2em;
        display: flex;
        align-items: center;
      `;
      overflowButton.textContent = this.showOverfow_ ? '«' : '»';
      overflowButton.addEventListener('click', () => {
        this.showOverfow_ = !this.showOverfow_;
        this.render_();
      });
      this.append(overflowButton);
    }
  }

  dispatchShortcut(e: KeyboardEvent) {
    let test = (action: Action) => {
      // Don't allow certain actions to apply in rapid succession for each
      // thread. This prevents accidents of archiving a lot of threads at once
      // when your stupid keyboard gets stuck holding the archive key down.
      // #sigh
      if (!action.repeatable && e.repeat)
        return false;
      return getActionKey(action) == e.key;
    };

    let action = this.allActions_().find(test);
    if (action)
      this.takeAction(action, e);
  }

  async takeAction(action: Action, opt_e?: KeyboardEvent) {
    if (this.view_.shouldSuppressActions())
      return;

    if (!navigator.onLine) {
      alert(`This action requires a network connection.`);
      return;
    }

    if (opt_e)
      opt_e.preventDefault();

    await this.view_.takeAction(action);
  }
}
window.customElements.define('mt-actions', Actions);
