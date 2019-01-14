import {getCurrentWeekNumber} from './Base.js';
import {IDBKeyVal} from './idb-keyval.js';
import {Labels} from './Labels.js';
import {Message} from './Message.js';
import {ProcessedMessageData} from './ProcessedMessageData.js';

// A place for ThreadData and Thread to share code. Don't want to use
// inheritance because we don't ever want to accidentally pass a ThreadData
// where we need a Thread.
export class ThreadUtils {
  static getKey(weekNumber: number, historyId: string) {
    return `thread-${weekNumber}-${historyId}`;
  }

  static async serializeMessageData(
      messages: gapi.client.gmail.Message[], historyId: string) {
    let key = ThreadUtils.getKey(getCurrentWeekNumber(), historyId);
    try {
      await IDBKeyVal.getDefault().set(key, JSON.stringify(messages));
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
