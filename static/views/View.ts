import {Model} from '../models/Model.js';

export abstract class View extends HTMLElement {
  constructor() {
    super();
  }

  abstract getModel(): Model;
  tearDown() {
    this.setFooter();
  }
  async init() {};
  async goBack() {}
  async update() {}
  async dispatchShortcut(_e: KeyboardEvent) {};

  protected setFooter(dom?: HTMLElement) {
    let footer = <HTMLElement>document.getElementById('footer');
    footer.textContent = '';
    if (dom)
      footer.append(dom);
  }
}
