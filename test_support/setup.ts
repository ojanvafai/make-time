class WorkerMock {
  url: string | URL;
  constructor(stringUrl: string | URL, _options?: WorkerOptions) {
    this.url = stringUrl;
  }
  onmessage(_ev: MessageEvent): any {}
  onmessageerror(_ev: MessageEvent): any {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent(): boolean {
    return true;
  }
  onerror() {}
  postMessage(_msg: string) {
    this.onmessage(new MessageEvent('message'));
  }
}

global.Worker = WorkerMock;
global.URL.createObjectURL = jest.fn();
