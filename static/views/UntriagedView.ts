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
import { RenderedCard, Direction } from '../RenderedCard.js';
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
import { Thread } from '../Thread.js';

registerActions('Untriaged', [UNDO_ACTION, ADD_FILTER_ACTION]);

const CENTERED_FILL_CONTAINER_CLASS = 'absolute all-0 flex items-center justify-center';

interface DirectionalAction extends Action {
  direction: Direction;
  originalAction: Action;
}

const MIN_OFFSET_TO_DRAG = 10;
const MIN_OFFSET_FOR_ACTION = 100;

function shouldAllowLinkCLicks(e: KeyboardEvent | PointerEvent) {
  return e.metaKey || e.ctrlKey || e.shiftKey;
}

export class UntriagedView extends ThreadListViewBase {
  private renderedThreadContainer_: HTMLElement;
  private renderedCardContainer_: HTMLElement;
  private cards_: RenderedCard[];
  private cardsAnimatingOffScreen_: Set<RenderedCard>;
  private currentCard_?: RenderedCard;
  private threadAlreadyTriagedDialog_?: HTMLElement;
  private triageActions_: DirectionalAction[];
  private isTriageComplete_?: boolean;

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
    this.renderedThreadContainer_.append(this.renderedCardContainer_);
    this.cards_ = [];
    this.cardsAnimatingOffScreen_ = new Set();

    this.setupDragHandlers_();

    this.triageActions_ = [
      this.wrapAction_(Direction.left, ARCHIVE_ACTION),
      this.wrapAction_(Direction.up, PIN_ACTION),
      this.wrapAction_(Direction.down, BLOCKED_1D_ACTION),
      this.wrapAction_(Direction.right, MUST_DO_ACTION),
    ];
    this.render();
  }

  private updateShouldAllowClicks_(e: KeyboardEvent) {
    if (!this.currentCard_) {
      return;
    }
    this.currentCard_.setShouldAllowPointerEvents(shouldAllowLinkCLicks(e));
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
    // Don't show this until threads have loaded for the first time to avoid a
    // flicker on load.
    this.classList.add('untriaged-view-background');

    const allThreads = this.model.getThreads(true);
    let threads = allThreads.filter((x) => x.forceTriage() && !x.actionInProgress());

    if (!threads.length) {
      this.clearCurrentCard_();
      this.updateToolbar_();
      this.isTriageComplete_ = true;
      return;
    }
    this.isTriageComplete_ = false;

    if (
      this.currentCard_ &&
      !this.threadAlreadyTriagedDialog_ &&
      !threads.includes(this.currentCard_.thread)
    ) {
      this.renderAlreadyTriaged_();
      return;
    }

    this.cards_ = this.createCards_(threads);
    if (!this.currentCard_) {
      this.currentCard_ = this.cards_[0];
      // Ensure currentCard_ stays visually above other cards since we force it
      // to persist even if new cards come in.
      this.currentCard_.style.zIndex = '1';
    }

    this.removeStaleCards_();
    this.renderTopOfDeck_(this.currentCard_);
    this.updateToolbar_();
  }

  private renderTopOfDeck_(currentCard: RenderedCard) {
    for (let i = 0; i < Math.min(10, this.cards_.length); i++) {
      const card = this.cards_[i];
      // Only render the top 3 cards as a performance optimization. Also, don't
      // rotate the top 3 cards since we want them to render text and lines
      // axis-aligned.
      if (i < 3) {
        card.render();
      }
      // Render this.currentCard_ in case it's not in the top 3 anymore but got
      // new messages.
      currentCard.render();
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
  }

  private renderAlreadyTriaged_() {
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

  private createCards_(threads: Thread[]) {
    const newCards = [];
    for (const thread of threads) {
      const oldCard = this.cards_.find((x) => x.thread === thread);

      if (oldCard) {
        // There's a race between when we start the animation and finish the
        // triage. In that interim, if new threads come in, avoid adding it back
        // to the stack of cards since we don't want it to get set back to
        // this.currentCard_.
        if (!this.cardsAnimatingOffScreen_.has(oldCard)) {
          newCards.push(oldCard);
        }
        continue;
      }
      const card = new RenderedCard(thread, this.triageActions_);
      newCards.push(card);
    }
    return newCards;
  }

  private removeStaleCards_() {
    Array.from(this.renderedCardContainer_.children)
      .filter((child) => {
        const card = child as RenderedCard;
        return (
          !this.cards_.includes(card) &&
          !this.cardsAnimatingOffScreen_.has(card) &&
          this.currentCard_ !== card
        );
      })
      .forEach((card) => card.remove());
  }

  private setupDragHandlers_() {
    let isHorizontalDrag: boolean | null = null;
    let dragStartOffset: { x: number; y: number } | null = null;

    const distancedFromDragStart = (e: PointerEvent, getHorizontalDistance: boolean) => {
      const start = notNull(dragStartOffset);
      return getHorizontalDistance ? e.pageX - start.x : e.pageY - start.y;
    };

    const directionForDrag = (e: PointerEvent, isHorizontalDrag: boolean) => {
      const distance = distancedFromDragStart(e, isHorizontalDrag);
      if (Math.abs(distance) <= MIN_OFFSET_FOR_ACTION) {
        return;
      }
      return isHorizontalDrag
        ? distance > 0
          ? Direction.right
          : Direction.left
        : distance > 0
        ? Direction.down
        : Direction.up;
    };

    this.addEventListener('pointerdown', (e) => {
      if (this.isTriageComplete_) {
        this.routeToTodo_();
        return;
      }
      if (!this.currentCard_) {
        return;
      }
      if (this.currentCard_.areInternalPointerEventsAllowed()) {
        return;
      }
      dragStartOffset = { x: e.pageX, y: e.pageY };
      this.setPointerCapture(e.pointerId);
    });

    this.addEventListener('pointermove', (e) => {
      if (!dragStartOffset) {
        return;
      }
      if (!this.currentCard_) {
        return;
      }
      if (this.currentCard_.areInternalPointerEventsAllowed()) {
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
      const offset = distancedFromDragStart(e, isHorizontalDrag);
      const transform = `translate${axis}(${offset}px)`;
      this.currentCard_.style.transform = transform;
      this.currentCard_.setShouldShowToolbarButton(directionForDrag(e, isHorizontalDrag));
    });

    this.addEventListener('pointerup', (e) => {
      if (!this.currentCard_) {
        return;
      }
      const card = this.currentCard_;
      if (card.areInternalPointerEventsAllowed()) {
        return;
      }

      if (isHorizontalDrag !== null) {
        const direction = directionForDrag(e, isHorizontalDrag);
        if (direction) {
          this.takeDirectionalAction_(direction);
        } else {
          this.currentCard_.setShouldShowToolbarButton();
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
    if (this.currentCard_) {
      this.currentCard_.style.zIndex = '';
      this.clearCurrentCard_();
    }
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
    this.updateShouldAllowClicks_(e);
    return true;
  }

  async handleKeyUp(e: KeyboardEvent) {
    this.updateShouldAllowClicks_(e);
  }

  private animateCardOffscreen_(card: RenderedCard, action: DirectionalAction) {
    let axis;
    let offset;
    switch (action.direction) {
      case Direction.up:
        axis = 'translateY';
        offset = -window.innerHeight;
        break;

      case Direction.right:
        axis = 'translateX';
        offset = window.innerWidth;
        break;

      case Direction.down:
        axis = 'translateY';
        offset = window.innerHeight;
        break;

      case Direction.left:
        axis = 'translateX';
        offset = -window.innerWidth;
        break;

      default:
        assertNotReached();
    }

    const endTransform = `${axis}(${offset}px)`;
    card.animate([{ transform: endTransform }], {
      duration: 300,
    }).onfinish = () => {
      this.cardsAnimatingOffScreen_.delete(card);
      card.style.transform = endTransform;
      card.remove();
    };

    this.cardsAnimatingOffScreen_.add(card);
    card.setShouldShowToolbarButton(action.direction, true);
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
