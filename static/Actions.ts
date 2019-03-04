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

  constructor(private view_: View) {
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
    `;
    this.append(buttonContainer);

    for (let action of this.actions_) {
      if (action.hidden)
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
            `<span style="font-weight: bold; text-decoration: underline;">${
                key.toUpperCase()}</span>${name}`;
      }

      buttonContainer.append(button);
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

    let action = this.actions_.find(test);
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
