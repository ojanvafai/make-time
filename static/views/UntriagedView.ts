import { Action, ActionGroup, registerActions, ActionList } from '../Actions.js';
import { assert, createMktimeButton, defined, Labels } from '../Base.js';
import { MailProcessor } from '../MailProcessor.js';
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
import {
  ThreadListViewBase,
  VIEW_IN_GMAIL_ACTION,
  OTHER_MENU_ACTION,
} from './ThreadListViewBase.js';
import { AddFilterDialog } from './AddFilterDialog.js';

let UNDO_ACTION = {
  name: `Undo`,
  description: `Undoes the last action taken.`,
  key: 'u',
  actionGroup: ActionGroup.Other,
};

let ADD_FILTER_ACTION = {
  name: `Filter`,
  description: `Add a new filter rule for this thread.`,
  key: 'f',
  actionGroup: ActionGroup.Other,
};

const HAS_CURRENT_CARD_TOOLBAR = [
  UNTRIAGED_ARCHIVE_ACTION,
  UNTRIAGED_PIN_ACTION,
  UNTRIAGED_MUST_DO_ACTION,
  UNTRIAGED_STUCK_1D_ACTION,
  VIEW_IN_GMAIL_ACTION,
];

registerActions('Untriaged', [...HAS_CURRENT_CARD_TOOLBAR, UNDO_ACTION, ADD_FILTER_ACTION]);

const CENTERED_FILL_CONTAINER_CLASS = 'absolute all-0 flex items-center justify-center';

export class UntriagedView extends ThreadListViewBase {
  private renderedThreadContainer_: HTMLElement;
  private currentCard_?: RenderedCard;
  private threadAlreadyTriagedDialog_?: HTMLElement;

  constructor(
    model: ThreadListModel,
    appShell: AppShell,
    settings: Settings,
    private getMailProcessor_: () => Promise<MailProcessor>,
  ) {
    super(model, appShell, settings);

    this.renderedThreadContainer_ = document.createElement('div');
    this.renderedThreadContainer_.className = 'theme-max-width mx-auto absolute all-0';
    this.append(this.renderedThreadContainer_);

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

  private updateToolbar_() {
    let actions: ActionList = [];
    const otherMenuActions = [];

    if (this.currentCard_) {
      actions = [...HAS_CURRENT_CARD_TOOLBAR];
      if (this.currentCard_.thread.getLabel() === Labels.Fallback) {
        otherMenuActions.push(ADD_FILTER_ACTION);
      }
    }
    if (this.model.hasUndoActions()) {
      otherMenuActions.push(UNDO_ACTION);
    }

    if (otherMenuActions.length === 1) {
      actions.push(otherMenuActions[0]);
    } else if (otherMenuActions.length > 1) {
      actions.push([OTHER_MENU_ACTION, otherMenuActions]);
    }
    this.setActions(actions);
  }

  protected async renderFrame() {
    if (!this.model.hasFetchedThreads()) {
      return;
    }

    const allThreads = this.model.getThreads(true);
    let threads = allThreads.filter((x) => x.forceTriage() && !x.actionInProgress());

    if (!threads.length) {
      this.clearCurrentCard_();

      const contents = document.createElement('div');
      contents.className = `${CENTERED_FILL_CONTAINER_CLASS} theme-text-color p1 center mx-auto pre-wrap`;
      contents.style.maxWidth = '250px';
      contents.append('All done triaging.\n\nPress any key or click anywhere to go to todo view.');
      contents.onclick = () => this.routeToTodo_();
      this.updateViewContents_(contents);
      this.updateToolbar_();
      return;
    }

    // TODO: Render the top N card shells so it looks like a stack of cards.
    // TODO: Prerender the next card's message contents
    // TODO: Make swiping the cards work on mobile and with two fingers on desktop trackpad.
    if (!this.currentCard_) {
      const thread = threads[0];
      const labelSelectTemplate = await this.settings.getLabelSelectTemplate();
      this.currentCard_ = new RenderedCard(thread, labelSelectTemplate);
      this.updateViewContents_(this.currentCard_);
      await this.currentCard_.render();
      this.updateToolbar_();
    } else if (!threads.includes(this.currentCard_.thread) && !this.threadAlreadyTriagedDialog_) {
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
      this.updateToolbar_();
    }
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
    if (await super.dispatchShortcut(e)) {
      return true;
    }
    // This is after the dispatchShortcut in case the user does an undo action.
    if (this.clearAlreadyTriagedThreadState_()) {
      return true;
    }
    if (!this.currentCard_) {
      this.routeToTodo_();
    }
    return true;
  }

  async takeAction(action: Action) {
    // The toolbar should be disabled when this dialog is up.
    assert(!this.threadAlreadyTriagedDialog_);

    switch (action) {
      case OTHER_MENU_ACTION:
        return true;

      case ADD_FILTER_ACTION:
        new AddFilterDialog(
          this.settings,
          assert(this.currentCard_).thread,
          this.getMailProcessor_,
          () => this.updateToolbar_(),
        );
        return true;

      case UNDO_ACTION:
        this.clearCurrentCard_();
        this.model.undoLastAction();
        return true;

      case VIEW_IN_GMAIL_ACTION:
        if (this.currentCard_) {
          this.openThreadInGmail(this.currentCard_.thread);
        }
        return true;

      default:
        const thread = assert(this.currentCard_).thread;
        this.clearCurrentCard_();
        // TODO: Have the triage action animate the card off the screen
        return await this.model.markTriaged(action, [thread]);
    }
  }
}

window.customElements.define('mt-untriaged-view', UntriagedView);
