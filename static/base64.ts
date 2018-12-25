
let b64u =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';  // base64url
                                                                         // dictionary
let b64pad = '=';

export class Base64 {
  base64decode(data: string) {
    var dst = ''
    var i, a, b, c, d;

    for (i = 0; i < data.length - 3; i += 4) {
      a = this.charIndex(data.charAt(i + 0));
      b = this.charIndex(data.charAt(i + 1));
      c = this.charIndex(data.charAt(i + 2));
      d = this.charIndex(data.charAt(i + 3));

      dst += String.fromCharCode((a << 2) | (b >>> 4));
      if (data.charAt(i + 2) != b64pad)
        dst += String.fromCharCode(((b << 4) & 0xF0) | ((c >>> 2) & 0x0F));
      if (data.charAt(i + 3) != b64pad)
        dst += String.fromCharCode(((c << 6) & 0xC0) | d);
    }
    return escape(dst);
  }

  /**
   * Decode a  base64url string to a JavaScript string.
   * Input is assumed to be a base64url encoded UTF-8 string.
   * Returned result is a JavaScript (UCS-2) string.
   */
  decode(data: string) {
    let dst = this.base64decode(data);
    return decodeURIComponent(dst);
  }

  encode(str: string) {
    var data = unescape(encodeURIComponent(str));
    var len = data.length;

    var dst = '';
    var i;

    for (i = 0; i <= len - 3; i += 3) {
      dst += b64u.charAt(data.charCodeAt(i) >>> 2);
      dst += b64u.charAt(
        ((data.charCodeAt(i) & 3) << 4) | (data.charCodeAt(i + 1) >>> 4));
      dst += b64u.charAt(
        ((data.charCodeAt(i + 1) & 15) << 2) | (data.charCodeAt(i + 2) >>> 6));
      dst += b64u.charAt(data.charCodeAt(i + 2) & 63);
    }

    if (len % 3 == 2) {
      dst += b64u.charAt(data.charCodeAt(i) >>> 2);
      dst += b64u.charAt(
        ((data.charCodeAt(i) & 3) << 4) | (data.charCodeAt(i + 1) >>> 4));
      dst += b64u.charAt(((data.charCodeAt(i + 1) & 15) << 2));
      dst += b64pad;
    } else if (len % 3 == 1) {
      dst += b64u.charAt(data.charCodeAt(i) >>> 2);
      dst += b64u.charAt(((data.charCodeAt(i) & 3) << 4));
      dst += b64pad;
      dst += b64pad;
    }

    return dst;
  }

  charIndex(c: string) {
    if (c == '+')
      return 62;
    if (c == '/')
      return 63;
    return b64u.indexOf(c);
  }
}
