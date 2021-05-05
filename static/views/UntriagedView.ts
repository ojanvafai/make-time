import { Action, registerActions, ActionList, cloneAndDisable, Shortcut } from '../Actions.js';
import { assert, createMktimeButton, defined, Labels, assertNotReached, notNull } from '../Base.js';
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
const MIN_OFFSET_FOR_ACTION = 200;

export class UntriagedView extends ThreadListViewBase {
  private renderedThreadContainer_: HTMLElement;
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

    this.renderedThreadContainer_ = document.createElement('div');
    this.renderedThreadContainer_.className = 'theme-max-width mx-auto absolute all-0';
    this.append(this.renderedThreadContainer_);

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
    this.clearAlreadyTriagedThreadState_();
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

    if (!this.currentCard_) {
      const thread = threads[0];
      this.currentCard_ = new RenderedCard(thread);
      this.setupDragHandlers_(this.currentCard_);
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

  private setupDragHandlers_(card: RenderedCard) {
    let isHorizontalDrag: boolean | null = null;
    let dragStartOffset: { x: number; y: number } | null = null;

    const distancedFromDragStart = (e: PointerEvent, getHorizontalDistance: boolean) => {
      const start = notNull(dragStartOffset);
      return getHorizontalDistance ? e.pageX - start.x : e.pageY - start.y;
    };

    card.addEventListener('pointerdown', (e) => {
      dragStartOffset = { x: e.pageX, y: e.pageY };
      card.setPointerCapture(e.pointerId);
    });

    card.addEventListener('pointermove', (e) => {
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
      card.style.transform = `translate${axis}(${distancedFromDragStart(e, isHorizontalDrag)}px)`;
    });

    card.addEventListener('pointerup', (e) => {
      if (isHorizontalDrag !== null) {
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
          card.style.transform = ``;
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

  private animateCurrentCardOffscreen_(action: DirectionalAction) {
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

    const card = defined(this.currentCard_);
    card.style.transition = 'transform 0.3s';
    card.style.transform = `${axis}(${offset}px)`;
  }

  private async takeDirectionalAction_(direction: Direction) {
    const action = assert(this.triageActions_.find((x) => x.direction === direction));
    this.animateCurrentCardOffscreen_(action);
    const thread = defined(this.currentCard_).thread;
    this.clearCurrentCard_();
    return await this.model.markTriaged(action.originalAction, [thread]);
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
          this.getAllUnfilteredUntriagedThreads(),
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
        return await this.takeDirectionalAction_((action as DirectionalAction).direction);
    }
  }
}

window.customElements.define('mt-untriaged-view', UntriagedView);
