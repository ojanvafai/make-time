import 'document-register-element'
import 'css-paint-polyfill'

import {firestoreUserCollection} from '../../../static/BaseMain.js';
import {ThreadListModel} from '../../../static/models/ThreadListModel';
import {Thread} from '../../../static/Thread';

const fs = require('fs');
const util = require('util');
const log_file = fs.createWriteStream('./debug.log', {flags: 'w'});

console.log = function(d: any) {
  log_file.write(util.format(d) + '\n');
};

// @ts-ignore
window.requestIdleCallback = window.setTimeout;

class TestThreadListModel extends ThreadListModel {
  public getGroupName() {
    return 'test';
  }
  public compareThreads(_a: Thread, _b: Thread) {
    return 0;
  }

  public defaultCollapsedState() {
    return true;
  }

  public setFakeQuery() {
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    this.setQuery(metadataCollection.orderBy('blocked', 'asc'));
  }
}

test('Empty by default', () => {
  const testThreadListModel = new TestThreadListModel();
  expect(testThreadListModel.getThreads().length).toBe(0);
});

test('Add thread', () => {
  const testThreadListModel = new TestThreadListModel();
  testThreadListModel.setFakeQuery();
  expect(testThreadListModel.getThreads().length).toBe(2);
});