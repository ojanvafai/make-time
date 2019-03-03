import { AppShell } from '../views/AppShell.js';

export abstract class Model extends EventTarget {
  constructor() {
    super();
  }

  async loadFromDisk() {}

  async update() {}

  protected updateTitle(key: string, count: number, ...title: (HTMLElement|string)[]) {
    return AppShell.updateLoaderTitle(key, count, ...title);
  }
}
