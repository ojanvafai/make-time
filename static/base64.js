class Base64 {
  constructor() {
    // Use modules and then put these in the module scope instead of the constructor.
    this.b64c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";   // base64 dictionary
    this.b64u = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";   // base64url dictionary
    this.b64pad = '=';
  }

  /**
   * Decode a  base64url string to a JavaScript string.
   * Input is assumed to be a base64url encoded UTF-8 string.
   * Returned result is a JavaScript (UCS-2) string.
   */
  decode(data) {
    var dst = ""
    var i, a, b, c, d, z

    for (i = 0; i < data.length - 3; i += 4) {
      a = this.charIndex(data.charAt(i+0))
      b = this.charIndex(data.charAt(i+1))
      c = this.charIndex(data.charAt(i+2))
      d = this.charIndex(data.charAt(i+3))

      dst += String.fromCharCode((a << 2) | (b >>> 4))
      if (data.charAt(i+2) != this.b64pad)
        dst += String.fromCharCode(((b << 4) & 0xF0) | ((c >>> 2) & 0x0F))
      if (data.charAt(i+3) != this.b64pad)
        dst += String.fromCharCode(((c << 6) & 0xC0) | d)
    }

    return decodeURIComponent(escape(dst))
  }

  charIndex(c) {
    if (c == "+") return 62
    if (c == "/") return 63
    return this.b64u.indexOf(c)
  }
}
