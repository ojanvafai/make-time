import { Thread } from "../Thread";

export abstract class View extends HTMLElement {
  constructor() {
    super();
  }

  abstract tearDown(): void;
  abstract async addThread(thread: Thread): Promise<void>;
  abstract async goBack(): Promise<void>;
  abstract async renderFromDisk(): Promise<void>;
  abstract async update(): Promise<void>;
  abstract async fetch(shouldBatch?: boolean): Promise<void>;
  abstract async dispatchShortcut(e: KeyboardEvent): Promise<void>;
  abstract pushBestEffort(): void;
}
