import { View } from './views/View.js';

export interface Action {
  name: string;
  description: string;
  key?: string;
  hidden?: boolean;
  repeatable?: boolean;
  destination?: string|null;
}

export class Actions extends HTMLElement {
  private actions_: Action[];

  constructor(private view_: View) {
    super();
    this.style.display = 'flex';
    this.style.flexWrap = 'wrap';
    this.actions_ = [];
  }

  setActions(actions: Action[]) {
    this.actions_ = actions;
    this.textContent = '';

    for (let action of actions) {
      if (action.hidden)
        continue;
      let button = document.createElement('button');
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
      let name = action.name;
      button.innerHTML =
          `<span class="shortcut">${name.charAt(0)}</span>${name.slice(1)}`;
      this.append(button);
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
      if (action.key)
        return action.key == e.key;
      return action.name.charAt(0).toLowerCase() == e.key;
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
