import {USER_ID} from './Base.js';
import {Base64} from './base64.js';
import {gapiFetch} from './Net.js';

interface Resource {
  raw: string;
  threadId?: string;
}

function isAscii(str: string) {
  return !!(str.match(/^[\p{ASCII}]*$/u));
}

export async function send(
    text: string, to: string, subject: string, opt_extraHeaders?: string,
    opt_threadId?: string) {
  let base64 = new Base64();

  // See https://ncona.com/2011/06/using-utf-8-characters-on-an-e-mail-subject/
  if (!isAscii(subject))
    subject = `=?utf-8?B?${base64.encode(subject)}?=`;

  let email = `Subject: ${subject}
To: ${to}
Content-Type: text/html; charset="UTF-8"
`;

  if (opt_extraHeaders)
    email += opt_extraHeaders;

  // This newline between the headers and the email body is necessary.
  email += `
${text}`;

  let resource: Resource = {'raw': base64.encode(email)};
  if (opt_threadId)
    resource.threadId = opt_threadId;

  await gapiFetch(gapi.client.gmail.users.messages.send, {
    'userId': USER_ID,
    'resource': resource,
  });
}
