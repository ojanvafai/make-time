import { Action, ActionList, Actions } from '../Actions.js';

import { AppShell } from './AppShell.js';

export abstract class View extends HTMLElement {
  private actions_: Actions;

  constructor() {
    super();
    AppShell.setFooter();
    this.actions_ = new Actions(this);
  }

  async takeAction(_action: Action): Promise<boolean> {
    return false;
  }

  tearDown() {}
  async init() {}
  async goBack() {}
  toggleView() {}
  openOverflowMenu(_container: HTMLElement) {}
  forceRender() {}
  visibilityChanged() {}

  async dispatchShortcut(e: KeyboardEvent) {
    return this.actions_ && (await this.actions_.dispatchShortcut(e));
  }

  async handleKeyUp(_e: KeyboardEvent) {}

  protected setActions(actions: ActionList, supplementalActions?: ActionList) {
    this.enableActionToolbar();
    this.actions_.setActions(actions, supplementalActions);
    AppShell.setFooter(this.actions_);
  }

  protected disableActionToolbar() {
    this.actions_.disable();
  }

  protected enableActionToolbar() {
    this.actions_.enable();
  }
}
