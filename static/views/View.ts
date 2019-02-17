import {Action, Actions} from '../Actions.js';
import {getDefinitelyExistsElementById} from '../Base.js';

// Extract this before rendering any threads since the threads can have
// elements with IDs in them.
const footer = getDefinitelyExistsElementById('footer');

export abstract class View extends HTMLElement {
  private actions_: Actions;

  constructor() {
    super();
    this.setFooter();
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
    this.setFooter(this.actions_);
  }

  protected setFooter(dom?: HTMLElement) {
    footer.textContent = '';
    if (dom)
      footer.append(dom);
  }

  protected addToFooter(dom: HTMLElement) {
    footer.append(dom);
  }
}
