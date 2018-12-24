export abstract class Model extends EventTarget {
  constructor(protected updateTitle: any) {
    super();
  }
  abstract async loadFromDisk(): Promise<any>;
  abstract async update(): Promise<void>;
}
