import 'document-register-element'
import 'css-paint-polyfill'

import type * as firebase from 'firebase';
import {firestoreUserCollection} from '../../../static/BaseMain.js';
import {ThreadListModel} from '../../../static/models/ThreadListModel';
import {ServerStorage} from '../../../static/ServerStorage.js';
import {Settings} from '../../../static/Settings.js';
import {Thread} from '../../../static/Thread';
import {MUTE_ACTION} from '../../../static/ThreadActions.js';

const fs = require('fs');
const util = require('util');

console.log = function(d: any) {
  fs.appendFileSync('./debug.log', util.format(d) + '\n');
};

// @ts-ignore
window.requestIdleCallback = window.setTimeout;

class ThreadFactory {
  maxThreadId = 0;
  maxMessageId = 0;

  public makeThread(): {id: Number, data: any} {
    const self = this;
    return {
      id: self.maxThreadId++, data: function() {
        return {
          messageIds: [self.maxMessageId++, self.maxMessageId++], muted: false
        }
      }
    }
  }
}

const threadFactory = new ThreadFactory();

class TestThreadListModel extends ThreadListModel {
  constructor() {
    super(new Settings(new ServerStorage()));
  }
  public getGroupName() {
    return 'test';
  }
  public compareThreads(_a: Thread, _b: Thread) {
    return 0;
  }
  setQuery(query: firebase.firestore.Query) {}

  public setFakeQuery() {
    console.log(JSON.stringify(firestoreUserCollection()));
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    metadataCollection.onSnapshot = function(onNext: any) {
      return onNext(
          {docs: [threadFactory.makeThread(), threadFactory.makeThread()]});
    };
    this.setQuery(metadataCollection.orderBy('blocked', 'asc'));
  }
}

test('Empty by default', () => {
  const testThreadListModel = new TestThreadListModel();
  expect(testThreadListModel.getThreads().length).toBe(0);
});

test('Add threads', () => {
  const testThreadListModel = new TestThreadListModel();
  testThreadListModel.setFakeQuery();
  expect(testThreadListModel.getThreads().length).toBe(2);
});

test('Mute thread', async () => {
  const testThreadListModel = new TestThreadListModel();
  testThreadListModel.setFakeQuery();
  expect(testThreadListModel.getThreads().length).toBe(2);

  const thread = testThreadListModel.getThreads()[0];

  expect(thread.isMuted()).toBe(false);
  await testThreadListModel.markTriaged(MUTE_ACTION, [thread]);
  // expect(thread.isMuted()).toBe(true);
});