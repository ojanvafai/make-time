type RequestIdleCallbackHandle = any;
type RequestIdleCallbackOptions = {
  timeout: number;
};
type RequestIdleCallbackDeadline = {
  readonly didTimeout: boolean; timeRemaining: (() => number);
};

declare global {
  interface Window {
    requestIdleCallback:
        ((
             callback: ((deadline: RequestIdleCallbackDeadline) => void),
             opts?: RequestIdleCallbackOptions,
             ) => RequestIdleCallbackHandle);
    cancelIdleCallback: ((handle: RequestIdleCallbackHandle) => void);
  }

  interface Navigator {
    standalone: boolean;
  }

  interface Node {
    after: ((...nodes: Node[]|string[]) => void);
    before: ((...nodes: Node[]|string[]) => void);
  }

  interface CharacterData {
    // Technically textContent accepts null as a value in the setter,
    // but that's not a feature we need and needing to null check every
    // use of the getter is a pain. See
    // https://github.com/Microsoft/TypeScript/issues/10315.
    textContent: string;
  }

  interface Element {
    // Technically textContent accepts null as a value in the setter,
    // but that's not a feature we need and needing to null check every
    // use of the getter is a pain. See
    // https://github.com/Microsoft/TypeScript/issues/10315.
    textContent: string;
  }

  interface Event {
    // TODO: Technically this is only in InputEvent.
    readonly inputType: string;
    readonly path: HTMLElement[];
  }

  interface ErrorEvent {
    readonly body: string;
    readonly stack: string;
  }

  interface InputEvent extends UIEvent {
    readonly data: string;
    readonly inputType: string;
    readonly isComposing: boolean;

    // TODO: Add these. Too lazy to figure out the proper types.
    // readonly dataTransfer
    // getTargetRanges()
  }

  interface CSSStyleDeclaration {
    webkitLineClamp: string;
  }
}

export {};
