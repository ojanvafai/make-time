import {Model} from '../models/Model.js';

export abstract class View extends HTMLElement {
  constructor() {
    super();
  }

  abstract getModel(): Model;
  abstract tearDown(): void;
  abstract async goBack(): Promise<void>;
  abstract async renderFromDisk(): Promise<void>;
  abstract async update(): Promise<void>;
  abstract async dispatchShortcut(e: KeyboardEvent): Promise<void>;
}
