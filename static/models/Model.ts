export abstract class Model extends EventTarget {
  constructor(
      protected updateTitle: (key: string, ...title: string[]) => void) {
    super();
  }
  abstract async loadFromDisk(): Promise<any>;
  abstract async update(): Promise<void>;
}
