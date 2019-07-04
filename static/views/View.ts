import {Action, Actions} from '../Actions.js';
import {AppShell} from './AppShell.js';

export abstract class View extends HTMLElement {
  private actions_: Actions;

  constructor() {
    super();
    AppShell.setFooter();
    this.actions_ = new Actions(this);
  }

  async takeAction(_action: Action): Promise<void> {}

  tearDown() {}
  async init() {}
  async goBack() {}
  toggleView() {}
  openOverflowMenu(_container: HTMLElement) {}
  forceRender() {}

  async dispatchShortcut(e: KeyboardEvent) {
    if (this.actions_)
      await this.actions_.dispatchShortcut(e);
  };

  protected setActions(
      actions: (Action|Action[])[], supplementalActions?: (Action|Action[])[]) {
    this.actions_.setActions(actions, supplementalActions);
    AppShell.setFooter(this.actions_);
  }
}
