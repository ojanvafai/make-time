import { gapiFetch } from './Net.js';
import { Thread } from './Thread.js';
import { ThreadCache } from './ThreadCache.js';

export let USER_ID = 'me';
let threadCache_: ThreadCache;

export function getCurrentWeekNumber() {
  let today = new Date();
  var januaryFirst = new Date(today.getFullYear(), 0, 1);
  var msInDay = 86400000;
  // @ts-ignore TODO: Make subtracting date types from each other actually work.
  return Math.ceil((((today - januaryFirst) / msInDay) + januaryFirst.getDay()) / 7);
}

async function getCachedThread(response: any) {
  if (!threadCache_)
    threadCache_ = new ThreadCache();
  return await threadCache_.get(response);
}

interface FetchRequestParameters {
  userId: string;
  q: string;
  pageToken: string;
}

export async function fetchThreads(forEachThread: (thread: Thread) => void, options: any) {
  // Chats don't expose their bodies in the gmail API, so just skip them.
  let query = '-in:chats ';

  if (options.query)
    query += ' ' + options.query;

  // let daysToShow = (await getSettings()).get(ServerStorage.KEYS.DAYS_TO_SHOW);
  // if (daysToShow)
  //   query += ` newer_than:${daysToShow}d`;

  let getPageOfThreads = async (opt_pageToken?: string) => {
    let requestParams = <FetchRequestParameters> {
      'userId': USER_ID,
      'q': query,
    };

    if (opt_pageToken)
      requestParams.pageToken = opt_pageToken;

    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let resp = await gapiFetch(gapi.client.gmail.users.threads.list, requestParams);
    let threads = resp.result.threads || [];
    for (let rawThread of threads) {
      let thread = await getCachedThread(rawThread);
      await forEachThread(thread);
    }

    let nextPageToken = resp.result.nextPageToken;
    if (nextPageToken)
      await getPageOfThreads(nextPageToken);
  };

  await getPageOfThreads();
}

export async function fetchThread(id: string) {
  let requestParams = {
    'userId': USER_ID,
    'id': id,
  };
  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  let resp = await gapiFetch(gapi.client.gmail.users.threads.get, requestParams);
  let thread = await getCachedThread(resp.result);
  // If we have a stale thread we just fetched, then it's not stale anymore.
  // This can happen if we refetch a thread that wasn't actually modified
  // by a modify call.
  thread.stale = false;
  return thread;
}
