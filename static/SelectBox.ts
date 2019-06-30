import {DISABLED, NONE, SELECTED_PROPERTY, SIZE_PROPERTY, STATE_PROPERTY, ALL} from './SelectBoxPainter.js';

// Kinda gross that we need to expose the typescript output directory in the
// code. :(
// @ts-ignore
if (CSS && CSS.paintWorklet)
  // @ts-ignore
  CSS.paintWorklet.addModule('./gen/SelectBoxPainter.js');

export class SelectBox extends HTMLElement {
  private selected_!: string;

  constructor() {
    super();
    this.style.cssText = `
      width: 40px;
      height: 40px;
      background-image: paint(select-box);
    `;
    this.style.setProperty(SIZE_PROPERTY, '16');
    this.select(NONE);
  }

  isFullySelected() {
    return this.selected_ === ALL;
  }

  selected() {
    return this.selected_;
  }

  select(value: string) {
    this.selected_ = value;
    this.style.setProperty(SELECTED_PROPERTY, value);
  }

  setDisabled(disabled: boolean) {
    this.style.setProperty(STATE_PROPERTY, disabled ? DISABLED : '');
  }
}
window.customElements.define('mt-select-box', SelectBox);
