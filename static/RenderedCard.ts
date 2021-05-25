import { Message } from './Message.js';
import { RenderedMessage } from './RenderedMessage.js';
import { Thread, UpdatedEvent } from './Thread.js';
import { LabelState, ThreadRow } from './views/ThreadRow.js';
import { create, defined } from './Base.js';

// The string values of this enum need to match the Shortcut values for the
// arrow keys since they are used as the argument to Shortcut in UntriagedView.
export enum Direction {
  up = 'ArrowUp',
  right = 'ArrowRight',
  down = 'ArrowDown',
  left = 'ArrowLeft',
}

interface DirectionAndName {
  direction: Direction;
  name: string | HTMLElement | SVGElement;
}

interface AnchoredToolbars {
  [Direction.up]: HTMLDivElement;
  [Direction.right]: HTMLDivElement;
  [Direction.down]: HTMLDivElement;
  [Direction.left]: HTMLDivElement;
}

export class RenderedCard extends HTMLElement {
  private boundRender_: () => void;
  private noPointerEventsContainer_: HTMLElement;
  private lastRenderedMessageId_?: string;
  private anchoredToolbars_?: AnchoredToolbars;
  private currentlyShownToolbarDirection_?: Direction;

  constructor(public thread: Thread, private triageActionNames_: DirectionAndName[]) {
    super();
    this.className =
      'absolute left-align reading-max-width p2 break-word mx-auto all-0';

    // Sigh. Safari does not support overscroll-behavior and on iOS needs this
    // to prevent rubberband scrolling when in fullscreen/hide-toolbar mode. In
    // addition to being undesirable, Safari stops the drag when rubberband
    // scrolling kicks in.
    this.addEventListener('touchmove', (e) => e.preventDefault());
    // Wrap the email contents in a noevents container so that clicking on links
    // doesn't work and so that nested scrollers don't scroll. The latter is
    // especially important on iOS to get decent dragging behavior.
    this.noPointerEventsContainer_ = create('div');
    this.noPointerEventsContainer_.className =
      'flex flex-column no-user-select absolute all-0 thread-background-color card-shadow';
    this.append(this.noPointerEventsContainer_);

    const horizontalOffset = 20 * (Math.random() - 0.5);
    const verticalOffset = 20 * (Math.random() - 0.5);
    this.noPointerEventsContainer_.style.cssText = `
      top: ${20 + verticalOffset}px;
      right: ${20 + horizontalOffset}px;
      bottom: ${20 - verticalOffset}px;
      left: ${20 - horizontalOffset}px;
    `;

    this.setShouldAllowPointerEvents(false);
    this.boundRender_ = this.handleThreadUpdated_.bind(this);
  }

  private createToolbar_(direction: Direction) {
    const toolbar = document.createElement('div');
    toolbar.className = 'absolute justify-center items-center flex all-0 no-user-select noevents';
    toolbar.style.transition = 'opacity ease-out 0.5s';
    toolbar.style.opacity = '0';

    const toolbarOffset = `-75px`;
    switch (direction) {
      case Direction.down:
        toolbar.style.bottom = 'auto';
        toolbar.style.top = toolbarOffset;
        break;
      case Direction.left:
        toolbar.style.left = 'auto';
        toolbar.style.right = toolbarOffset;
        break;
      case Direction.up:
        toolbar.style.top = 'auto';
        toolbar.style.bottom = toolbarOffset;
        break;
      case Direction.right:
        toolbar.style.right = 'auto';
        toolbar.style.left = toolbarOffset;
        break;
    }

    const button = document.createElement('div');
    button.className = 'justify-center items-center flex';
    button.style.cssText = `
      width: 50px;
      height: 50px;
      background-color: var(--inverted-overlay-background-color);
      color: var(--inverted-text-color);
      border-radius: 25px;
      box-shadow: 0px 0px 4px var(--border-and-hover-color);
      text-align: center;
    `;
    button.append(defined(this.triageActionNames_.find((x) => x.direction === direction)).name);

    toolbar.append(button);
    this.append(toolbar);
    return toolbar;
  }

  private appendAnchoredToolbarButtons_() {
    if (!this.anchoredToolbars_) {
      this.anchoredToolbars_ = {
        [Direction.up]: this.createToolbar_(Direction.up),
        [Direction.right]: this.createToolbar_(Direction.right),
        [Direction.down]: this.createToolbar_(Direction.down),
        [Direction.left]: this.createToolbar_(Direction.left),
      };
    }
    return this.anchoredToolbars_;
  }

  setShouldShowToolbarButton(direction?: Direction, disableAnimation?: boolean) {
    const toolbars = this.appendAnchoredToolbarButtons_();
    // Do this on the next animation frame in case we just appended the toolbars
    // since we need a style recalc to happen for the transition to trigger.
    requestAnimationFrame(() => {
      if (this.currentlyShownToolbarDirection_) {
        toolbars[this.currentlyShownToolbarDirection_].style.opacity = '0';
      }
      if (direction) {
        this.currentlyShownToolbarDirection_ = direction;
        const toolbar = toolbars[direction];
        toolbar.style.opacity = '1';
        if (disableAnimation) {
          toolbar.style.transition = '';
        }
      }
    });
  }

  connectedCallback() {
    this.thread.addEventListener(UpdatedEvent.NAME, this.boundRender_);
  }

  disconnectedCallback() {
    this.thread.removeEventListener(UpdatedEvent.NAME, this.boundRender_);
  }

  private handleThreadUpdated_() {
    this.render();
  }

  private async renderMessage_(message: Message) {
    const rendered = new RenderedMessage(message, await message.getQuoteElidedMessage());
    rendered.style.flex = '1';
    rendered.style.overflow = 'hidden';
    return rendered;
  }

  setShouldAllowPointerEvents(shouldAllow: boolean) {
    this.noPointerEventsContainer_.classList.toggle('noevents', !shouldAllow);
  }

  areInternalPointerEventsAllowed() {
    return !this.noPointerEventsContainer_.classList.contains('noevents');
  }

  async render() {
    const messages = this.thread.getMessages();
    if (!messages.length) {
      return;
    }

    // Early return if if the rendering of this card is still up to date (i.e.
    // the lastRenderedMessage_ matches the last Message on the thread.
    // Do this before any awaits so that subsequent calls to render before the awaits have finished will early retursn.
    const lastMessageId = messages[messages.length - 1].id;
    if (this.lastRenderedMessageId_ === lastMessageId) {
      return;
    }
    this.lastRenderedMessageId_ = lastMessageId;

    const container = this.noPointerEventsContainer_;
    container.textContent = '';

    let labelContainer = document.createElement('div');
    labelContainer.className = 'ml2';
    let labelState = new LabelState(this.thread, '');
    ThreadRow.appendLabels(labelContainer, labelState, this.thread);
    container.append(labelContainer);

    const subject = document.createElement('div');
    subject.className = 'strongest p1 flex justify-between break-word';
    subject.append(this.thread.getSubject(), labelContainer);
    container.append(subject, await this.renderMessage_(messages[0]));

    if (messages.length > 1) {
      const divider = document.createElement('div');
      divider.className = 'p1 border-top border-bottom text-darken3 center';
      const extraMessageCount = messages.length - 2;
      divider.textContent =
        extraMessageCount > 0
          ? `${extraMessageCount} more message${extraMessageCount > 1 ? 's' : ''}`
          : '\xA0';
      container.append(divider, await this.renderMessage_(messages[messages.length - 1]));
    }
  }
}
window.customElements.define('mt-rendered-card', RenderedCard);
