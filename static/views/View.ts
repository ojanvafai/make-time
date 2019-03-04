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

  async dispatchShortcut(e: KeyboardEvent) {
    if (this.actions_)
      this.actions_.dispatchShortcut(e);
  };

  shouldSuppressActions() {
    return false;
  }

  protected setActions(actions: Action[]) {
    this.actions_.setActions(actions);
    AppShell.setFooter(this.actions_);
  }
}
