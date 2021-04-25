import { Action, ActionGroup, registerActions } from '../Actions.js';
import { createMktimeButton } from '../Base.js';
import { ThreadListModel } from '../models/ThreadListModel.js';
import { RenderedCard } from '../RenderedCard.js';
import { Settings } from '../Settings.js';
import {
  UNTRIAGED_ARCHIVE_ACTION,
  UNTRIAGED_MUST_DO_ACTION,
  UNTRIAGED_STUCK_1D_ACTION,
  UNTRIAGED_PIN_ACTION,
} from '../ThreadActions.js';

import { AppShell } from './AppShell.js';
import { ThreadListViewBase, VIEW_IN_GMAIL_ACTION } from './ThreadListViewBase.js';

let UNDO_ACTION = {
  name: `Undo`,
  description: `Undoes the last action taken.`,
  key: 'u',
  actionGroup: ActionGroup.Other,
};

const TOOLBAR = [
  UNTRIAGED_ARCHIVE_ACTION,
  UNTRIAGED_PIN_ACTION,
  UNTRIAGED_MUST_DO_ACTION,
  UNTRIAGED_STUCK_1D_ACTION,
  VIEW_IN_GMAIL_ACTION,
  UNDO_ACTION,
];

registerActions('Untriaged', TOOLBAR);

export class UntriagedView extends ThreadListViewBase {
  private renderedThreadContainer_: HTMLElement;
  private currentCard_?: RenderedCard;

  constructor(model: ThreadListModel, appShell: AppShell, settings: Settings) {
    super(model, appShell, settings);
    this.className = 'absolute left-0 right-0';

    this.renderedThreadContainer_ = document.createElement('div');
    this.renderedThreadContainer_.className = 'theme-max-width mx-auto relative center';
    this.append(this.renderedThreadContainer_);

    this.setActions(TOOLBAR);
    this.render();
  }

  protected getGroups() {
    return [];
  }

  protected async renderFrame() {
    if (!this.model.hasFetchedThreads()) {
      return;
    }

    this.renderedThreadContainer_.textContent = '';

    const allThreads = this.model.getThreads(true);
    let threads = allThreads.filter((x) => x.forceTriage() && !x.actionInProgress());

    if (threads.length) {
      // TODO: Render the top N card shells so it looks like a stack of cards.
      // TODO: Prerender the next card's message contents
      // TODO: Make swiping the cards work on mobile and with two fingers on desktop trackpad.
      this.currentCard_ = new RenderedCard(threads[0]);
      this.renderedThreadContainer_.append(this.currentCard_);
      await this.currentCard_.render();
    } else {
      this.currentCard_ = undefined;

      const allDoneLink = createMktimeButton(
        this.routeToTodo_,
        'All done triaging. Press any key or click here to go to todo view.',
      );
      // Use inline style because otherwise mktime button overrides the margin
      // from the classname.
      allDoneLink.style.margin = '20px auto';
      this.renderedThreadContainer_.append(allDoneLink);
    }
  }

  private routeToTodo_() {
    let a = document.createElement('a');
    a.href = '/todo';
    a.click();
  }

  async dispatchShortcut(e: KeyboardEvent) {
    if (this.currentCard_) {
      super.dispatchShortcut(e);
    } else {
      this.routeToTodo_();
    }
  }

  async takeAction(action: Action) {
    if (!this.currentCard_) {
      return;
    }

    const thread = this.currentCard_.thread;
    switch (action) {
      case UNDO_ACTION:
        this.model.undoLastAction();
        return;

      case VIEW_IN_GMAIL_ACTION:
        this.openThreadInGmail(thread);
        return;

      default:
        // TODO: Have the triage action animate the card off the screen
        await this.model.markTriaged(action, [thread]);
    }
  }
}
window.customElements.define('mt-untriaged-view', UntriagedView);
