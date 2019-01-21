import {getCurrentWeekNumber, getPreviousWeekNumber} from './Base.js';
import {IDBKeyVal} from './idb-keyval.js';
import {Labels} from './Labels.js';
import {Message} from './Message.js';
import {ProcessedMessageData} from './ProcessedMessageData.js';

interface SerializedMessages {
  historyId?: string;
  messages?: gapi.client.gmail.Message[];
}

// A place for ThreadData and Thread to share code. Don't want to use
// inheritance because we don't ever want to accidentally pass a ThreadData
// where we need a Thread.
export class ThreadUtils {
  static getKey(weekNumber: number, threadId: string) {
    return `thread-${weekNumber}-${threadId}`;
  }

  static async fetchFromDisk(id: string): Promise<SerializedMessages|null> {
    let currentWeekKey = ThreadUtils.getKey(getCurrentWeekNumber(), id);
    let localData = await IDBKeyVal.getDefault().get(currentWeekKey);

    let oldKey;
    if (!localData) {
      oldKey = ThreadUtils.getKey(getPreviousWeekNumber(), id);
      localData = await IDBKeyVal.getDefault().get(oldKey);
    }

    if (!localData)
      return null;

    if (oldKey) {
      await IDBKeyVal.getDefault().del(oldKey);
      await IDBKeyVal.getDefault().set(currentWeekKey, localData);
    }

    return JSON.parse(localData);
  }

  static async serializeMessageData(
      messages: gapi.client.gmail.Message[], messageOrThreadId: string,
      historyId: string) {
    let key = ThreadUtils.getKey(getCurrentWeekNumber(), messageOrThreadId);
    try {
      await IDBKeyVal.getDefault().set(key, JSON.stringify({
        messages: messages,
        historyId: historyId,
      }));
    } catch (e) {
      console.log('Fail storing message details in IDB.', e);
    }
  }

  static async processMessages(
      messages: gapi.client.gmail.Message[], oldMessages: Message[],
      labels: Labels) {
    let processed = new ProcessedMessageData(messages, oldMessages, labels);
    await processed.processLabelNames();
    return processed;
  }
}
