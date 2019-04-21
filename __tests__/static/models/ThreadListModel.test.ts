import {ThreadListModel} from '../../../static/models/ThreadListModel';
// import {Base64} from '../../../static/base64';

jest.mock('firebase', () => {
  const data = {name: 'unnamed'};
  const snapshot = {val: () => data};
  return {
    initializeApp: jest.fn().mockReturnValue({
      database: jest.fn().mockReturnValue({
        ref: jest.fn().mockReturnThis(),
        once: jest.fn(() => Promise.resolve(snapshot))
      })
    })
  };
});

test('sanity check', () => {
  expect(ThreadListModel).toBe(ThreadListModel);
});