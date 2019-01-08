import {updateLoaderTitle} from '../BaseMain.js';

export abstract class Model extends EventTarget {
  constructor() {
    super();
  }

  async loadFromDisk() {}

  async update() {}

  protected updateTitle(key: string, count: number, ...title: (HTMLElement|string)[]) {
    return updateLoaderTitle(key, count, ...title);
  }
}
