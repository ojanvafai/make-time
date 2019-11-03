enum WorkerCommand {
  decode,
  encode,
  urlDecode,
  urlEncode,
}

let worker = new Worker(`data:,
let b64UrlEncodeDictionary = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let b64pad = '=';

function decode(data) {
  var dst = ''
  var i, a, b, c, d;

  for (i = 0; i < data.length - 3; i += 4) {
    a = charIndex_(data.charAt(i + 0));
    b = charIndex_(data.charAt(i + 1));
    c = charIndex_(data.charAt(i + 2));
    d = charIndex_(data.charAt(i + 3));

    dst += String.fromCharCode((a << 2) | (b >>> 4));
    if (data.charAt(i + 2) != b64pad)
      dst += String.fromCharCode(((b << 4) & 0xF0) | ((c >>> 2) & 0x0F));
    if (data.charAt(i + 3) != b64pad)
      dst += String.fromCharCode(((c << 6) & 0xC0) | d);
  }
  return escape(dst);
}

function encode(str) {
  var b64EncodeDictionary =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  return encode_(str, b64EncodeDictionary);
}

function urlDecode(data) {
  let dst = decode(data);
  return decodeURIComponent(dst);
}

function urlEncode(str) {
  return encode_(str, b64UrlEncodeDictionary);
}

function encode_(str, dict) {
  let data = unescape(encodeURIComponent(str));
  var len = data.length;

  var dst = '';
  var i;

  for (i = 0; i <= len - 3; i += 3) {
    dst += dict.charAt(data.charCodeAt(i) >>> 2);
    dst += dict.charAt(
        ((data.charCodeAt(i) & 3) << 4) | (data.charCodeAt(i + 1) >>> 4));
    dst += dict.charAt(
        ((data.charCodeAt(i + 1) & 15) << 2) |
        (data.charCodeAt(i + 2) >>> 6));
    dst += dict.charAt(data.charCodeAt(i + 2) & 63);
  }

  if (len % 3 == 2) {
    dst += dict.charAt(data.charCodeAt(i) >>> 2);
    dst += dict.charAt(
        ((data.charCodeAt(i) & 3) << 4) | (data.charCodeAt(i + 1) >>> 4));
    dst += dict.charAt(((data.charCodeAt(i + 1) & 15) << 2));
    dst += b64pad;
  } else if (len % 3 == 1) {
    dst += dict.charAt(data.charCodeAt(i) >>> 2);
    dst += dict.charAt(((data.charCodeAt(i) & 3) << 4));
    dst += b64pad;
    dst += b64pad;
  }

  return dst;
}

function charIndex_(c) {
  if (c == '+')
    return 62;
  if (c == '/')
    return 63;
  return b64UrlEncodeDictionary.indexOf(c);
}

self.onmessage = (msg) => {
  let response;

  switch (msg.data.command) {
    case ${WorkerCommand.decode}:
      response = decode(msg.data.value);
      break;

    case ${WorkerCommand.encode}:
      response = encode(msg.data.value);
      break;

    case ${WorkerCommand.urlDecode}:
      response = urlDecode(msg.data.value);
      break;

    case ${WorkerCommand.urlEncode}:
      response = urlEncode(msg.data.value);
      break;

    default:
      throw 'Invalid decode command';
  }

  self.postMessage({
    id: msg.data.id,
    response: response,
  });
}
`);

let sent = new Map();

worker.addEventListener('message', (msg: MessageEvent) => {
  let id = msg.data.id;
  sent.get(id)(msg.data.response);
  sent.delete(id);
});

export class Base64 {
  private guid_ = 1;

  private async doInWorker_(command: WorkerCommand, data: string):
      Promise<string> {
    let promise: Promise<string> = new Promise((resolve, _reject) => {
      let id = this.guid_++;
      sent.set(id, resolve);

      worker.postMessage({
        id: id,
        command: command,
        value: data,
      });
    });
    return promise;
  }

  async decode(data: string) {
    return this.doInWorker_(WorkerCommand.decode, data);
  }

  async encode(str: string) {
    return this.doInWorker_(WorkerCommand.encode, str);
  }

  /**
   * Decode a  base64url string to a JavaScript string.
   * Input is assumed to be a base64url encoded UTF-8 string.
   * Returned result is a JavaScript (UCS-2) string.
   */
  async urlDecode(data: string) {
    return this.doInWorker_(WorkerCommand.urlDecode, data);
  }

  async urlEncode(str: string) {
    return this.doInWorker_(WorkerCommand.urlEncode, str);
  }
}
