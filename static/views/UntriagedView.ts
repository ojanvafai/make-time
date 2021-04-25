import { Action, ActionGroup, registerActions } from '../Actions.js';
import { assert, createMktimeButton, defined } from '../Base.js';
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

const CENTERED_FILL_CONTAINER_CLASS = 'absolute all-0 flex items-center justify-center';

export class UntriagedView extends ThreadListViewBase {
  private renderedThreadContainer_: HTMLElement;
  private currentCard_?: RenderedCard;
  private threadAlreadyTriagedDialog_?: HTMLElement;

  constructor(model: ThreadListModel, appShell: AppShell, settings: Settings) {
    super(model, appShell, settings);

    this.renderedThreadContainer_ = document.createElement('div');
    this.renderedThreadContainer_.className = 'theme-max-width mx-auto absolute all-0';
    this.append(this.renderedThreadContainer_);

    this.setActions(TOOLBAR);
    this.render();
  }

  protected getGroups() {
    return [];
  }

  private updateViewContents_(element: HTMLElement) {
    this.clearAlreadyTriagedThreadState_();
    this.renderedThreadContainer_.textContent = '';
    this.renderedThreadContainer_.append(element);
  }

  protected async renderFrame() {
    if (!this.model.hasFetchedThreads()) {
      return;
    }

    const allThreads = this.model.getThreads(true);
    let threads = allThreads.filter((x) => x.forceTriage() && !x.actionInProgress());

    if (threads.length) {
      // TODO: Render the top N card shells so it looks like a stack of cards.
      // TODO: Prerender the next card's message contents
      // TODO: Make swiping the cards work on mobile and with two fingers on desktop trackpad.
      if (!this.currentCard_) {
        this.currentCard_ = new RenderedCard(threads[0]);
        this.updateViewContents_(this.currentCard_);
        await this.currentCard_.render();
        this.enableActionToolbar();
        return;
      }

      if (!threads.includes(this.currentCard_.thread) && !this.threadAlreadyTriagedDialog_) {
        this.threadAlreadyTriagedDialog_ = document.createElement('div');
        const contents = document.createElement('div');
        contents.className =
          'overlay-background-color overlay-border-and-shadow theme-text-color p2 m4 center flex flex-column';
        contents.append(
          'This thread has already been triaged elsewhere. Press any key to go to next thread.',
          createMktimeButton(() => this.clearAlreadyTriagedThreadState_(), 'Go to next thread'),
        );
        this.threadAlreadyTriagedDialog_.append(contents);
        this.threadAlreadyTriagedDialog_.className = `${CENTERED_FILL_CONTAINER_CLASS} darken2`;
        this.renderedThreadContainer_.append(this.threadAlreadyTriagedDialog_);
      }
    } else {
      this.clearCurrentCard_();

      const contents = document.createElement('div');
      contents.className = `${CENTERED_FILL_CONTAINER_CLASS} theme-text-color p1`;
      contents.append('All done triaging. Press any key or click anywhere to go to todo view.');
      contents.onclick = () => this.routeToTodo_();
      this.updateViewContents_(contents);
    }

    this.disableActionToolbar();
  }

  private routeToTodo_() {
    let a = document.createElement('a');
    a.href = '/todo';
    this.append(a);
    a.click();
  }

  private clearCurrentCard_() {
    this.currentCard_ = undefined;
  }

  private clearAlreadyTriagedThreadState_() {
    if (!this.threadAlreadyTriagedDialog_) {
      return false;
    }
    defined(this.threadAlreadyTriagedDialog_).remove();
    this.threadAlreadyTriagedDialog_ = undefined;
    this.clearCurrentCard_();
    this.render();
    return true;
  }

  async dispatchShortcut(e: KeyboardEvent) {
    if (this.clearAlreadyTriagedThreadState_()) {
      return;
    }
    if (this.currentCard_) {
      super.dispatchShortcut(e);
      return;
    }
    this.routeToTodo_();
  }

  async takeAction(action: Action) {
    // The toolbar should be disabled when this dialog is up.
    assert(!this.threadAlreadyTriagedDialog_);

    // The toolbar should be disabled when there is no currentCard_, so it
    // should always be defined here..
    const thread = assert(this.currentCard_).thread;
    switch (action) {
      case UNDO_ACTION:
        this.clearCurrentCard_();
        this.model.undoLastAction();
        return;

      case VIEW_IN_GMAIL_ACTION:
        this.openThreadInGmail(thread);
        return;

      default:
        this.clearCurrentCard_();
        // TODO: Have the triage action animate the card off the screen
        await this.model.markTriaged(action, [thread]);
    }
  }
}
window.customElements.define('mt-untriaged-view', UntriagedView);
