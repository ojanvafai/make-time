import { Action, registerActions, ActionList, cloneAndDisable, Shortcut } from '../Actions.js';
import {
  assert,
  createMktimeButton,
  defined,
  Labels,
  assertNotReached,
  notNull,
  create,
} from '../Base.js';
import { MailProcessor } from '../MailProcessor.js';
import { ThreadListModel } from '../models/ThreadListModel.js';
import { RenderedCard } from '../RenderedCard.js';
import { Settings } from '../Settings.js';
import { MUST_DO_ACTION, ARCHIVE_ACTION, PIN_ACTION, BLOCKED_1D_ACTION } from '../ThreadActions.js';

import { AppShell } from './AppShell.js';
import {
  ThreadListViewBase,
  VIEW_IN_GMAIL_ACTION,
  OTHER_MENU_ACTION,
  UNDO_ACTION,
  ADD_FILTER_ACTION,
} from './ThreadListViewBase.js';
import { AddFilterDialog } from './AddFilterDialog.js';

registerActions('Untriaged', [UNDO_ACTION, ADD_FILTER_ACTION]);

const CENTERED_FILL_CONTAINER_CLASS = 'absolute all-0 flex items-center justify-center';

enum Direction {
  ArrowUp = 'ArrowUp',
  ArrowRight = 'ArrowRight',
  ArrowDown = 'ArrowDown',
  ArrowLeft = 'ArrowLeft',
}

interface DirectionalAction extends Action {
  direction: Direction;
  originalAction: Action;
}

const MIN_OFFSET_TO_DRAG = 10;
const MIN_OFFSET_FOR_ACTION = 100;

export class UntriagedView extends ThreadListViewBase {
  private renderedThreadContainer_: HTMLElement;
  private renderedCardContainer_: HTMLElement;
  private cards_: RenderedCard[];
  private cardsAnimatingOffScreen_: RenderedCard[];
  private currentCard_?: RenderedCard;
  private threadAlreadyTriagedDialog_?: HTMLElement;
  private triageActions_: DirectionalAction[];

  constructor(
    model: ThreadListModel,
    appShell: AppShell,
    settings: Settings,
    private getMailProcessor_: () => Promise<MailProcessor>,
  ) {
    super(model, appShell, settings);

    this.renderedThreadContainer_ = create('div');
    this.renderedThreadContainer_.className = 'theme-max-width mx-auto absolute all-0';
    this.append(this.renderedThreadContainer_);
    this.renderedCardContainer_ = create('div');
    this.cards_ = [];
    this.cardsAnimatingOffScreen_ = [];

    this.setupDragHandlers_();

    this.triageActions_ = [
      this.wrapAction_(Direction.ArrowLeft, ARCHIVE_ACTION),
      this.wrapAction_(Direction.ArrowUp, PIN_ACTION),
      this.wrapAction_(Direction.ArrowDown, BLOCKED_1D_ACTION),
      this.wrapAction_(Direction.ArrowRight, MUST_DO_ACTION),
    ];
    this.render();
  }

  private wrapAction_(direction: Direction, action: Action) {
    return {
      ...action,
      key: new Shortcut(direction),
      secondaryKey: action.key,
      direction: direction,
      originalAction: action,
    };
  }

  protected getGroups() {
    return [];
  }

  private updateViewContents_(element: HTMLElement) {
    this.renderedThreadContainer_.textContent = '';
    this.renderedThreadContainer_.append(element);
  }

  private updateToolbar_() {
    let actions: ActionList;

    if (this.currentCard_) {
      const otherMenuActions = [
        this.model.hasUndoActions() ? UNDO_ACTION : cloneAndDisable(UNDO_ACTION),
      ];
      otherMenuActions.push(
        this.currentCard_.thread.getLabel() === Labels.Fallback
          ? ADD_FILTER_ACTION
          : cloneAndDisable(ADD_FILTER_ACTION),
      );
      actions = [
        ...this.triageActions_,
        VIEW_IN_GMAIL_ACTION,
        [OTHER_MENU_ACTION, otherMenuActions],
      ];
    } else {
      actions = this.model.hasUndoActions() ? [UNDO_ACTION] : [];
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

    if (
      this.currentCard_ &&
      !threads.includes(this.currentCard_.thread) &&
      !this.threadAlreadyTriagedDialog_
    ) {
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
      return;
    }

    const newCards = [];
    for (const thread of threads) {
      const oldCard = this.cards_.find((x) => x.thread === thread);
      if (oldCard) {
        newCards.push(oldCard);
        continue;
      }
      const card = new RenderedCard(thread);
      newCards.push(card);
    }
    this.cards_ = newCards;

    if (!this.currentCard_) {
      this.currentCard_ = this.cards_[0];
      // Ensure currentCard_ stays visually above other cards since we force it
      // to persist even if new cards come in.
      this.currentCard_.style.zIndex = '1';
    }

    const cardsToRemove = Array.from(this.renderedCardContainer_.children).filter((child) => {
      const card = child as RenderedCard;
      return (
        !this.cards_.includes(card) &&
        !this.cardsAnimatingOffScreen_.includes(card) &&
        this.currentCard_ !== card
      );
    });

    for (const card of cardsToRemove) {
      card.remove();
    }

    newCards.slice(0, 3).forEach((card) => card.render());

    for (let i = 0; i < Math.min(10, this.cards_.length); i++) {
      const card = this.cards_[i];
      // Only render the top 3 cards as a performance optimization. Also, don't
      // rotate the top 3 cards since we want them to render text and lines
      // axis-aligned.
      if (i < 3) {
        card.render();
        card.setShouldRotate(false);
      } else {
        card.setShouldRotate(true);
      }
      // Render this.currentCard_ in case it's not in the top 3 anymore but got
      // new messages.
      this.currentCard_.render();
      if (this.currentCard_ === card && this.currentCard_.parentNode) {
        continue;
      }

      // As a performance optimization don't reappend the card if it's already
      // in the right order in the DOM. In particular, if its the first card and
      // already at the end of the container, or it's not the first card but
      // it's next sibling is the previously appended card.
      if (
        i === 0
          ? this.renderedCardContainer_.lastElementChild === card
          : card.nextSibling === this.cards_[i - 1]
      ) {
        continue;
      }
      // The deck is ordered such that the top card of the deck is the last
      // child since later children will render on top of earlier ones with
      // default z-index.
      this.renderedCardContainer_.prepend(card);
    }

    if (!this.renderedCardContainer_.parentNode) {
      this.updateViewContents_(this.renderedCardContainer_);
    }

    this.updateToolbar_();
  }

  private setupDragHandlers_() {
    let isHorizontalDrag: boolean | null = null;
    let dragStartOffset: { x: number; y: number } | null = null;

    const distancedFromDragStart = (e: PointerEvent, getHorizontalDistance: boolean) => {
      const start = notNull(dragStartOffset);
      return getHorizontalDistance ? e.pageX - start.x : e.pageY - start.y;
    };

    this.addEventListener('pointerdown', (e) => {
      dragStartOffset = { x: e.pageX, y: e.pageY };
      this.setPointerCapture(e.pointerId);
    });

    this.addEventListener('pointermove', (e) => {
      if (!dragStartOffset) {
        return;
      }
      if (isHorizontalDrag === null) {
        const x = Math.abs(distancedFromDragStart(e, true));
        const y = Math.abs(distancedFromDragStart(e, false));
        if (x > MIN_OFFSET_TO_DRAG || y > MIN_OFFSET_TO_DRAG) {
          isHorizontalDrag = x > y;
        } else {
          return;
        }
      }
      const axis = isHorizontalDrag ? 'X' : 'Y';
      defined(this.currentCard_).style.transform = `translate${axis}(${distancedFromDragStart(
        e,
        isHorizontalDrag,
      )}px)`;
    });

    this.addEventListener('pointerup', (e) => {
      if (isHorizontalDrag !== null) {
        const card = defined(this.currentCard_);
        const distance = distancedFromDragStart(e, isHorizontalDrag);
        if (Math.abs(distance) > MIN_OFFSET_FOR_ACTION) {
          const direction = isHorizontalDrag
            ? distance > 0
              ? Direction.ArrowRight
              : Direction.ArrowLeft
            : distance > 0
            ? Direction.ArrowDown
            : Direction.ArrowUp;
          this.takeDirectionalAction_(direction);
        } else {
          card.animate([{ transform: 'translate(0px)' }], {
            duration: 300,
          }).onfinish = () => (card.style.transform = '');
        }
      }
      isHorizontalDrag = null;
      dragStartOffset = null;
    });
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

  private putCurrentCardBackInStack_() {
    defined(this.currentCard_).style.zIndex = '';
    this.clearCurrentCard_();
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

  private animateCardOffscreen_(card: RenderedCard, action: DirectionalAction) {
    let axis;
    let offset;
    switch (action.direction) {
      case Direction.ArrowUp:
        axis = 'translateY';
        offset = -window.innerHeight;
        break;

      case Direction.ArrowRight:
        axis = 'translateX';
        offset = window.innerWidth;
        break;

      case Direction.ArrowDown:
        axis = 'translateY';
        offset = window.innerHeight;
        break;

      case Direction.ArrowLeft:
        axis = 'translateX';
        offset = -window.innerWidth;
        break;

      default:
        assertNotReached();
    }
    const endTransform = `${axis}(${offset}px)`;
    card.animate([{ transform: endTransform }], {
      duration: 300,
    }).onfinish = () => (card.style.transform = endTransform);

    this.cardsAnimatingOffScreen_.push(card);
  }

  private async takeDirectionalAction_(direction: Direction) {
    const card = defined(this.currentCard_);
    this.clearCurrentCard_();
    const action = assert(this.triageActions_.find((x) => x.direction === direction));
    this.animateCardOffscreen_(card, action);
    return await this.model.markTriaged(action.originalAction, [card.thread]);
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
          defined(this.currentCard_).thread,
          this.getAllUnfilteredUntriagedThreads(),
          this.getMailProcessor_,
          () => this.updateToolbar_(),
        );
        return true;

      case UNDO_ACTION:
        this.putCurrentCardBackInStack_();
        this.model.undoLastAction();
        return true;

      case VIEW_IN_GMAIL_ACTION:
        if (this.currentCard_) {
          this.openThreadInGmail(this.currentCard_.thread);
        }
        return true;

      default:
        return await this.takeDirectionalAction_((action as DirectionalAction).direction);
    }
  }
}

window.customElements.define('mt-untriaged-view', UntriagedView);
