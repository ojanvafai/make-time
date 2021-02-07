/*! (c) Andrea Giammarchi - ISC */

import { defined } from './Base.js';

// Adapted from https://github.com/ungap/event-target/blob/master/index.js This
// is only needed because Safari doesn't expose the EventTarget constructor.
type EventTargetOptions = {
  once?: boolean;
};
type EventTargetInfo = {
  options?: EventTargetOptions;
  listener: (event: Event) => void;
  target: EventTargetPolyfill;
};

export class EventTargetPolyfill {
  static wm: WeakMap<
    EventTargetPolyfill,
    { [property: string]: Array<EventTargetInfo> }
  > = new WeakMap();
  constructor() {
    EventTargetPolyfill.wm.set(this, Object.create(null));
  }
  _getSecret() {
    return defined(EventTargetPolyfill.wm.get(this));
  }
  addEventListener(type: string, listener: (event: Event) => void, options?: EventTargetOptions) {
    const secret = this._getSecret();
    if (!secret[type]) {
      secret[type] = [];
    }
    const listeners = secret[type];
    if (!listeners.find((x) => x.listener === listener)) {
      listeners.push({ target: this, listener, options });
    }
  }
  dispatchEvent(event: Event) {
    const listeners = this._getSecret()[event.type];
    if (listeners) {
      const defineParams = { configurable: true, writable: true, value: this };
      Object.defineProperty(event, 'target', defineParams);
      Object.defineProperty(event, 'currentTarget', defineParams);
      listeners.slice(0).forEach((info) => this.dispatch(info, event));
      // @ts-expect-error
      delete event.currentTarget;
      // @ts-expect-error
      delete event.target;
    }
    return true;
  }
  removeEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this._getSecret()[type];
    if (!listeners) {
      return;
    }
    const index = listeners.findIndex((x) => x.listener === listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }
  dispatch(info: EventTargetInfo, event: Event) {
    const options = info.options;
    const listener = info.listener;
    if (options && options.once) {
      info.target.removeEventListener(event.type, listener);
    }
    // TODO: Support {handleEvent:(event)=>{}} style listeners.
    listener.call(info.target, event);
  }
}
