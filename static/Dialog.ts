export class CloseEvent extends Event {
  static NAME = 'close';
  constructor() {
    super(CloseEvent.NAME);
  }
}

const FOCUSABLE_ELEMENTS = [
  'a[href]',
  'input:not([disabled]):not([type="hidden"]):not([aria-hidden])',
  'select:not([disabled]):not([aria-hidden])',
  'textarea:not([disabled]):not([aria-hidden])',
  'button:not([disabled]):not([aria-hidden])',
  '[contenteditable]',
  '[tabindex]:not([tabindex^="-"])',
  '.mktime-button:not([disabled])',
];

export class Dialog extends HTMLElement {
  private backdrop_: HTMLElement;
  private oldActiveElement_: Element | null;
  private handleKeyEvent_: (e: KeyboardEvent) => void;
  private boundRetainFocus_: (e: FocusEvent) => void;

  constructor(
    contents: Node | string,
    buttons: HTMLElement[],
    positionRect?: { top?: string; right?: string; bottom?: string; left?: string },
  ) {
    super();
    this.style.cssText = `
      max-width: calc(100% - 32px);
      max-height: calc(100% - 32px);
      overscroll-behavior: none;
    `;

    this.className =
      'p1 z4 fixed flex flex-column overlay-background-color overlay-border-and-shadow theme-text-color';
    if (positionRect) {
      Object.assign(this.style, positionRect);
    } else {
      this.style.width = 'min(600px, calc(100% - 12px))';
      this.classList.add('center-popup');
    }
    this.oldActiveElement_ = null;

    this.backdrop_ = document.createElement('div');
    this.backdrop_.className = 'z3 fixed all-0 darken2';
    this.backdrop_.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.remove();
    });

    const contentContainer = document.createElement('div');
    contentContainer.className = 'overflow-auto';
    contentContainer.append(contents);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'flex justify-end';
    this.append(contentContainer, buttonContainer);
    if (buttons.length) {
      buttonContainer.append(...buttons);
    }

    this.handleKeyEvent_ = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.remove();
      }
      e.stopPropagation();
    };

    this.boundRetainFocus_ = (e: FocusEvent) => this.retainFocus_(e);

    this.oldActiveElement_ = document.activeElement;

    this.setAttribute('aria-hidden', 'false');
    this.addEventListener('keydown', this.handleKeyEvent_);
    document.body.addEventListener('blur', this.boundRetainFocus_, true);
    document.body.style.overflow = 'hidden';

    document.body.append(this.backdrop_, this);

    this.focusFirstNode_();
  }

  disconnectedCallback() {
    this.backdrop_.remove();

    this.setAttribute('aria-hidden', 'true');
    this.removeEventListener('keydown', this.handleKeyEvent_);
    document.body.removeEventListener('blur', this.boundRetainFocus_, true);
    document.body.style.overflow = '';

    if (this.oldActiveElement_ && (this.oldActiveElement_ as HTMLElement).focus) {
      (this.oldActiveElement_ as HTMLElement).focus();
    }
    this.dispatchEvent(new CloseEvent());
  }

  private getFocusableNodes_() {
    return this.querySelectorAll(FOCUSABLE_ELEMENTS.join(',')) as NodeListOf<HTMLElement>;
  }

  private focusFirstNode_() {
    const focusableNodes = this.getFocusableNodes_();
    if (focusableNodes.length) {
      focusableNodes[0].focus();
    }
  }

  private retainFocus_(e: FocusEvent) {
    if (this.contains(e.relatedTarget as Node)) {
      return;
    }
    const focusableNodes = this.getFocusableNodes_();
    if (!focusableNodes.length) {
      return;
    }
    const mostRecentlyFocused = e.target;
    const firstFocusable = focusableNodes[0];
    const lastFocusable = focusableNodes[focusableNodes.length - 1];
    if (mostRecentlyFocused === firstFocusable) {
      lastFocusable.focus();
    } else if (mostRecentlyFocused === lastFocusable) {
      firstFocusable.focus();
    }
  }
}
window.customElements.define('mt-dialog', Dialog);
