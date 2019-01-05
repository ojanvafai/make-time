import {updateLoaderTitle} from '../BaseMain.js';

export abstract class Model extends EventTarget {
  constructor() {
    super();
  }

  async loadFromDisk() {}

  async update() {}

  protected updateTitle(key: string, ...title: string[]) {
    updateLoaderTitle(key, ...title);
  }
}
