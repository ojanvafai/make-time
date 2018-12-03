type RequestIdleCallbackHandle = any;
type RequestIdleCallbackOptions = {
  timeout: number;
};
type RequestIdleCallbackDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: (() => number);
};

declare global {
  interface Window {
    requestIdleCallback: ((
      callback: ((deadline: RequestIdleCallbackDeadline) => void),
      opts?: RequestIdleCallbackOptions,
    ) => RequestIdleCallbackHandle);
    cancelIdleCallback: ((handle: RequestIdleCallbackHandle) => void);
  }

  interface Node {
    after: ((...nodes: Node[] | string[]) => void);
    before: ((...nodes: Node[] | string[]) => void);
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

}

export { };
