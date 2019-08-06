import {createRect, createSvgContainer} from './Base.js';

export const ALL = 'all';
export const SOME = 'some';
export const NONE = 'none';
export const DISABLED = 'disabled';

export class SelectChangedEvent extends Event {
  static NAME = 'select-changed';
  constructor(public rangeSelect: boolean) {
    super(SelectChangedEvent.NAME, {bubbles: true});
  }
}

export class SelectBox extends HTMLElement {
  private hovered_: boolean;
  private selected_!: string;
  private svg_: SVGElement;

  constructor() {
    super();
    this.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px;
      border-radius: 3px;
    `;

    this.hovered_ = false;

    this.svg_ = createSvgContainer('0 0 24 24', createRect(5, 5, 14, 14));
    this.svg_.style.cssText = `
      background: var(--inverted-text-color);
      width: 20px;
      height: 20px;
      border: 2px solid;
      box-sizing: border-box;
      border-radius: 3px;
    `;
    this.append(this.svg_);

    // Prevent the default behavior of text selection on shift+click this is
    // used for range selections. Need to do it on mousedown unfortunately
    // since that's when the selection is modified on some platforms (e.g.
    // mac).
    this.addEventListener('mousedown', e => {
      if (e.shiftKey)
        e.preventDefault();
    });

    this.addEventListener('click', e => {
      this.select(this.selected_ === NONE ? ALL : NONE);
      this.dispatchEvent(new SelectChangedEvent(e.shiftKey));
    });

    this.addEventListener('pointerover', () => {
      this.setHovered(true);
    });
    this.addEventListener('pointerout', () => {
      this.setHovered(false);
    });

    this.select(NONE);
  }

  setHovered(hovered: boolean) {
    this.hovered_ = hovered;
    this.render_();
  }

  isFullySelected() {
    return this.selected_ === ALL;
  }

  selected() {
    return this.selected_;
  }

  select(value: string) {
    this.selected_ = value;
    this.render_();
  }

  setDisabled(disabled: boolean) {
    this.select(disabled ? DISABLED : NONE);
  }

  render_() {
    let fill;
    let borderColor;
    if (this.selected_ === ALL) {
      fill = 'var(--text-color)';
      borderColor = 'var(--text-color)';
    } else if (this.selected_ === SOME) {
      fill = 'var(--midpoint-color)';
      borderColor = 'var(--text-color)';
    } else if (this.selected_ === DISABLED) {
      fill = 'var(--inverted-text-color)';
      borderColor = 'var(--midpoint-color)';
    } else if (!this.hovered_) {
      fill = 'var(--inverted-text-color)';
      borderColor = 'var(--dim-text-color)';
    } else {
      fill = 'var(--inverted-text-color)';
      borderColor = 'var(--text-color)';
    }

    this.svg_.style.borderColor = borderColor;
    this.svg_.style.fill = fill;
  }
}
window.customElements.define('mt-select-box', SelectBox);
