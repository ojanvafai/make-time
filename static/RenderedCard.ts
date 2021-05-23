import { Message } from './Message.js';
import { RenderedMessage } from './RenderedMessage.js';
import { Thread, UpdatedEvent } from './Thread.js';
import { LabelState, ThreadRow } from './views/ThreadRow.js';
import { create, defined } from './Base.js';

export enum Edge {
  top,
  right,
  bottom,
  left,
}

export class RenderedCard extends HTMLElement {
  private boundRender_: () => void;
  private noPointerEventsContainer_: HTMLElement;
  private lastRenderedMessageId_?: string;
  private anchoredToolbars_?: HTMLElement[];

  constructor(public thread: Thread, private triageActionNames_: Map<Edge, string>) {
    super();
    this.className =
      'absolute left-align reading-max-width p2 break-word card-shadow mx-auto thread-background-color';

    const horizontalOffset = 20 - 2 * (Math.random() - 0.5);
    this.style.cssText = `
      top: 20px;
      right: ${horizontalOffset}px;
      bottom: 20px;
      left: ${horizontalOffset}px;
    `;
    // Sigh. Safari does not support overscroll-behavior and on iOS needs this
    // to prevent rubberband scrolling when in fullscreen/hide-toolbar mode. In
    // addition to being undesirable, Safari stops the drag when rubberband
    // scrolling kicks in.
    this.addEventListener('touchmove', (e) => e.preventDefault());
    // Wrap the email contents in a noevents container so that clicking on links
    // doesn't work and so that nested scrollers don't scroll. The latter is
    // especially important on iOS to get decent dragging behavior.
    this.noPointerEventsContainer_ = create('div');
    this.noPointerEventsContainer_.className = 'flex flex-column no-user-select absolute all-0';
    this.append(this.noPointerEventsContainer_);

    this.setShouldAllowPointerEvents(false);
    this.boundRender_ = this.handleThreadUpdated_.bind(this);
  }

  private appendAnchoredToolbarButtons_() {
    if (this.anchoredToolbars_) {
      return this.anchoredToolbars_;
    }

    const createToolbar = () => {
      const toolbar = document.createElement('div');
      toolbar.className = 'absolute justify-center items-center flex all-0 no-user-select noevents';
      toolbar.style.transition = 'opacity ease-out 0.5s';
      toolbar.style.opacity = '0';
      return toolbar;
    };

    const createButton = (edge: Edge) => {
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
      button.append(defined(this.triageActionNames_.get(edge)));
      return button;
    };

    const toolbarOffset = `75px`;
    const topToolbar = createToolbar();
    topToolbar.append(createButton(Edge.top));
    topToolbar.style.bottom = 'auto';
    topToolbar.style.top = `-${toolbarOffset}`;

    const rightToolbar = createToolbar();
    rightToolbar.append(createButton(Edge.right));
    rightToolbar.style.left = 'auto';
    rightToolbar.style.right = `-${toolbarOffset}`;

    const bottomToolbar = createToolbar();
    bottomToolbar.append(createButton(Edge.bottom));
    bottomToolbar.style.top = 'auto';
    bottomToolbar.style.bottom = `-${toolbarOffset}`;

    const leftToolbar = createToolbar();
    leftToolbar.append(createButton(Edge.left));
    leftToolbar.style.right = 'auto';
    leftToolbar.style.left = `-${toolbarOffset}`;

    this.anchoredToolbars_ = [topToolbar, rightToolbar, bottomToolbar, leftToolbar];
    this.append(...this.anchoredToolbars_);
    return this.anchoredToolbars_;
  }

  setShouldShowToolbarButton(edge?: Edge) {
    const toolbars = this.appendAnchoredToolbarButtons_();
    // Do this on the next animation frame in case we just appended the toolbars
    // since we need a style recalc to happen for the transition to trigger.
    requestAnimationFrame(() => {
      for (let i = 0; i < toolbars.length; i++) {
        toolbars[i].style.opacity = i === edge ? '1' : '0';
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

  setShouldRotate(shouldRotate: boolean) {
    // Only take action if there is a rotate to avoid overriding the transforms
    // set by dragging. This works because we should always have cleared the
    // rotation before we get to starting dragging since we disableRotation on
    // the top two cards.
    const isAlreadyRotated = this.style.transform.includes('rotate');
    if (shouldRotate && !isAlreadyRotated) {
      const angle = 2 * (Math.random() - 0.5);
      this.style.transform = `rotate(${angle}deg)`;
    } else if (!shouldRotate && isAlreadyRotated) {
      this.style.transform = '';
    }
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
    subject.className = 'strongest p1 flex justify-between';
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
