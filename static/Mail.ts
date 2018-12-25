import {USER_ID} from './Base.js';
import {Base64} from './base64.js';
import {gapiFetch} from './Net.js';

interface Resource {
  raw: string, threadId?: string,
}

export async function send(
    text: string, to: string, subject: string, opt_extraHeaders?: string,
    opt_threadId?: string) {
  let email = `Subject: ${subject}
To: ${to}
Content-Type: text/html; charset="UTF-8"
`;

  if (opt_extraHeaders)
    email += opt_extraHeaders;

  // This newline between the headers and the email body is necessary.
  email += `
${text}`;

  let base64 = new Base64();
  let resource: Resource = {'raw': base64.encode(email)};
  if (opt_threadId)
    resource.threadId = opt_threadId;

  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  let response = await gapiFetch(gapi.client.gmail.users.messages.send, {
    'userId': USER_ID,
    'resource': resource,
  });
}
