import {getPrimaryAccountDisplayName, ParsedAddress, serializeAddress, USER_ID} from './Base.js';
import {Base64} from './base64.js';
import {gapiFetch} from './Net.js';

interface Resource {
  raw: string;
  threadId?: string;
}

let base64 = new Base64();

function isAscii(str: string) {
  return !!(str.match(/^[\p{ASCII}]*$/u));
}

async function encode(str: string) {
  // See https://ncona.com/2011/06/using-utf-8-characters-on-an-e-mail-subject/
  if (isAscii(str))
    return str;
  return `=?UTF-8?B?${await base64.encode(str)}?=`;
}

export async function send(
    text: string, to: ParsedAddress[], subject: string,
    sender: gapi.client.gmail.SendAs, opt_extraHeaders?: string,
    opt_threadId?: string) {
  let encodedTo = [];

  for (let x of to) {
    encodedTo.push(
        serializeAddress({name: await encode(x.name), address: x.address}));
  }

  // TODO: This doesn't work if there are unicode characters in the local or
  // domain parts of the email address. Not quite sure what the fix is. Using
  // the encode method above, even on just the parts of the address causes a 400
  // from gmail API.
  let email = `Subject: ${await encode(subject)}
To: ${encodedTo.join(',')}
Content-Type: text/html; charset="UTF-8"
`;

  if (opt_extraHeaders)
    email += opt_extraHeaders;

  if (sender) {
    let displayName = sender.displayName || '';
    if (!displayName && sender.isPrimary)
      displayName = await getPrimaryAccountDisplayName();

    let sendAsEmail = sender.sendAsEmail || '';
    email += `From: ${
        serializeAddress(
            {name: await encode(displayName), address: sendAsEmail})}\n`;

    // Gmail doesn't include names in reply-to headers, so we won't either.
    if (sender.replyToAddress)
      email += `Reply-To: ${sender.replyToAddress}\n`;
  }

  // This newline between the headers and the email body is necessary.
  email += `
${text}`;

  let resource: Resource = {'raw': await base64.urlEncode(email)};
  if (opt_threadId)
    resource.threadId = opt_threadId;

  let response = await gapiFetch(gapi.client.gmail.users.messages.send, {
    'userId': USER_ID,
    'resource': resource,
  });
  return response.result;
}
