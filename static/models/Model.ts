import { EventTargetPolyfill } from '../EventTargetPolyfill.js';
import { AppShell } from '../views/AppShell.js';

export abstract class Model extends EventTargetPolyfill {
  constructor() {
    super();
  }

  async loadFromDisk() {}
  async update() {}

  protected updateTitle(key: string, count: number, ...title: (HTMLElement | string)[]) {
    return AppShell.updateLoaderTitle(key, count, ...title);
  }
}
