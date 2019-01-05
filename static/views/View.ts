import {Action, Actions} from '../Actions.js';

export abstract class View extends HTMLElement {
  private actions_: Actions;

  constructor() {
    super();
    this.actions_ = new Actions(this);
  }

  abstract async takeAction(action: Action): Promise<void>;

  tearDown() {
    this.setFooter();
  }
  async init() {};
  async goBack() {}
  async update() {}

  async dispatchShortcut(e: KeyboardEvent) {
    if (this.actions_)
      this.actions_.dispatchShortcut(e);
  };

  shouldSuppressActions() {
    return false;
  }

  protected setActions(actions: Action[]) {
    this.actions_.setActions(actions);
    this.setFooter(this.actions_);
  }

  protected setFooter(dom?: HTMLElement) {
    let footer = <HTMLElement>document.getElementById('footer');
    footer.textContent = '';
    if (dom)
      footer.append(dom);
  }

  protected addToFooter(dom: HTMLElement) {
    let footer = <HTMLElement>document.getElementById('footer');
    footer.append(dom);
  }
}
