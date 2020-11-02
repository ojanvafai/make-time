
// @ts-ignore TS errors importing this in jest, but it still functions.
import MockFirebase from '../../node_modules/mock-cloud-firestore';
import {EventTargetPolyfill} from '../../static/EventTargetPolyfill.js';
import {GmailLabelUpdate, LABEL_LABEL_NAME, MailProcessor, MAKE_TIME_LABEL_NAME, PRIORITY_LABEL_NAME, SOFT_MUTE_LABEL_NAME} from '../../static/MailProcessor.js';
import {ServerStorage} from '../../static/ServerStorage';
import {Settings} from '../../static/Settings.js';
import {Priority} from '../../static/Thread';

const fixtureData = {
  __collection__: {
    users: {
      __doc__: {
        user_a: {
          age: 15,
          username: 'user_a',
        }
      }
    }
  }
};
const firebase = new MockFirebase(fixtureData);
const db = firebase.firestore();
const serverStorageDocumentReference =
    db.collection('server-storage-collection').doc('server-storage-doc');

export class MockServerStorage extends EventTargetPolyfill {
  async fetch() {}
  getDocument_() {
    return serverStorageDocumentReference;
  }
  get() {}
  async writeUpdates() {}
};

class MockGmailMessage {
  constructor(public id: string, public labelIds: string[]) {}
}

class MockGmailLabel {
  constructor(public id: string, public name: string) {}
}

const mktimeLabelIdPrefix = 'mktime-label-id-';
const label1FirestoreId = 1;
const mktimeLabel1 = new MockGmailLabel(
    `${mktimeLabelIdPrefix}${label1FirestoreId}`,
    `${LABEL_LABEL_NAME}/${label1FirestoreId}`)
const mktimePriority1 =
    new MockGmailLabel('mktime-priority-id-1', `${PRIORITY_LABEL_NAME}/1`)
const mktimeRootLabel =
    new MockGmailLabel('mktime-root-id', MAKE_TIME_LABEL_NAME);
const mktimeSoftMuteLabel =
    new MockGmailLabel('mktime-soft-mute-id', SOFT_MUTE_LABEL_NAME);
const nonMktimeLabel = new MockGmailLabel('label-id-1', 'label1');

const allMktimeGmailLabels: gapi.client.gmail.Label[] = [
  new MockGmailLabel('INBOX', 'INBOX'),
  mktimeLabel1,
  mktimePriority1,
  mktimeRootLabel,
  mktimeSoftMuteLabel,
  nonMktimeLabel,
];

const mockEnsureLabelsExist = async(
    allMktimeGmailLabels: gapi.client.gmail.Label[],
    ..._labelNames: string[]): Promise<gapi.client.gmail.Label[]> => {
  return allMktimeGmailLabels;
};

test('populateGmailLabelsToPush_ muted with label and priority', async () => {
  const mockSettings = new Settings(new MockServerStorage());
  const mailProcessor = new MailProcessor(mockSettings);
  const allMessages: gapi.client.gmail.Message[]|undefined = [
    new MockGmailMessage(
        '1',
        [
          nonMktimeLabel.id, 'INBOX', mktimeLabel1.id, mktimePriority1.id,
          mktimeRootLabel.id
        ]),
  ];
  const gmailLabelUpdate = new GmailLabelUpdate(['1']);
  await mailProcessor['populateGmailLabelsToPush_'](
      allMktimeGmailLabels, mktimeRootLabel.id, allMessages, {muted: true},
      gmailLabelUpdate);
  expect(gmailLabelUpdate.addLabelIds).toEqual([]);
  expect(gmailLabelUpdate.removeLabelIds).toEqual([
    mktimeLabel1.id, mktimePriority1.id, 'INBOX', mktimeRootLabel.id
  ]);
});

test('populateGmailLabelsToPush_ soft muted', async () => {
  const mockSettings = new Settings(new MockServerStorage());
  const mailProcessor = new MailProcessor(mockSettings);
  jest.spyOn(mailProcessor as any, 'ensureLabelsExist_')
      .mockImplementation(mockEnsureLabelsExist as any);

  const allMessages: gapi.client.gmail.Message[]|undefined = [
    new MockGmailMessage('1', ['INBOX', mktimeRootLabel.id]),
  ];
  const gmailLabelUpdate = new GmailLabelUpdate(['1']);
  await mailProcessor['populateGmailLabelsToPush_'](
      allMktimeGmailLabels, mktimeRootLabel.id, allMessages, {softMuted: true},
      gmailLabelUpdate);
  expect(gmailLabelUpdate.addLabelIds).toEqual([mktimeSoftMuteLabel.id]);
  expect(gmailLabelUpdate.removeLabelIds).toEqual([
    'INBOX', mktimeRootLabel.id
  ]);
});

test('populateGmailLabelsToPush_ hasLabel and hasPriority', async () => {
  const mockSettings = new Settings(new MockServerStorage());
  const mailProcessor = new MailProcessor(mockSettings);
  const allMessages: gapi.client.gmail.Message[]|undefined = [
    new MockGmailMessage('1', ['INBOX', mktimeRootLabel.id]),
  ];
  const gmailLabelUpdate = new GmailLabelUpdate(['1']);
  await mailProcessor['populateGmailLabelsToPush_'](
      allMktimeGmailLabels, mktimeRootLabel.id, allMessages, {hasLabel: true},
      gmailLabelUpdate);
  expect(gmailLabelUpdate.addLabelIds).toEqual([]);
  expect(gmailLabelUpdate.removeLabelIds).toEqual([]);

  await mailProcessor['populateGmailLabelsToPush_'](
      allMktimeGmailLabels, mktimeRootLabel.id, allMessages,
      {hasPriority: true}, gmailLabelUpdate);
  expect(gmailLabelUpdate.addLabelIds).toEqual([]);
  expect(gmailLabelUpdate.removeLabelIds).toEqual([]);
});

test(
    'populateGmailLabelsToPush_ not in inbox hasLabel and hasPriority',
    async () => {
      const mockSettings = new Settings(new MockServerStorage());
      const mailProcessor = new MailProcessor(mockSettings);
      const allMessages: gapi.client.gmail.Message[]|undefined = [
        new MockGmailMessage('1', []),
      ];
      const gmailLabelUpdate = new GmailLabelUpdate(['1']);
      await mailProcessor['populateGmailLabelsToPush_'](
          allMktimeGmailLabels, mktimeRootLabel.id, allMessages,
          {hasLabel: true}, gmailLabelUpdate);
      expect(gmailLabelUpdate.addLabelIds).toEqual([
        'INBOX', mktimeRootLabel.id
      ]);
      expect(gmailLabelUpdate.removeLabelIds).toEqual([]);

      const secondGmailLabelUpdate = new GmailLabelUpdate(['1']);
      await mailProcessor['populateGmailLabelsToPush_'](
          allMktimeGmailLabels, mktimeRootLabel.id, allMessages,
          {hasPriority: true}, secondGmailLabelUpdate);
      expect(secondGmailLabelUpdate.addLabelIds).toEqual([
        'INBOX', mktimeRootLabel.id
      ]);
      expect(secondGmailLabelUpdate.removeLabelIds).toEqual([]);
    });

test(
    'populateGmailLabelsToPush_ in inbox, !hasLabel, !muted, and !hasPriority',
    async () => {
      const mockSettings = new Settings(new MockServerStorage());
      const mailProcessor = new MailProcessor(mockSettings);
      const allMessages: gapi.client.gmail.Message[]|undefined = [
        new MockGmailMessage('1', ['INBOX']),
      ];
      const gmailLabelUpdate = new GmailLabelUpdate(['1']);
      await mailProcessor['populateGmailLabelsToPush_'](
          allMktimeGmailLabels, mktimeRootLabel.id, allMessages, {},
          gmailLabelUpdate);
      expect(gmailLabelUpdate.addLabelIds).toEqual([]);
      expect(gmailLabelUpdate.removeLabelIds).toEqual([
        mktimeRootLabel.id, 'INBOX'
      ]);
    });

test(
    'populateGmailLabelsToPush_ hasLabel pushes label and not priority',
    async () => {
      const mockSettings = new Settings(new MockServerStorage());
      jest.spyOn(mockSettings, 'get')
          .mockImplementation(
              (setting: string) =>
                  setting === ServerStorage.KEYS.PUSH_LABELS_TO_GMAIL);

      const mailProcessor = new MailProcessor(mockSettings);
      jest.spyOn(mailProcessor as any, 'ensureLabelsExist_')
          .mockImplementation(mockEnsureLabelsExist as any);
      jest.spyOn(mailProcessor as any, 'getAllMktimeGmailLabels_')
          .mockImplementation(async () => allMktimeGmailLabels);

      const mockGetLabelName = (labelId: number) => {
        if (`${mktimeLabelIdPrefix}${labelId}` === mktimeLabel1.id) {
          return label1FirestoreId;
        }
        throw new Error(`Invalid label name ${labelId}`);
      };
      jest.spyOn(mailProcessor as any, 'getLabelName_')
          .mockImplementation(mockGetLabelName as any);

      const allMessages: gapi.client.gmail.Message[]|undefined = [
        new MockGmailMessage('1', []),
      ];
      const gmailLabelUpdate = new GmailLabelUpdate(['1']);
      await mailProcessor['populateGmailLabelsToPush_'](
          allMktimeGmailLabels, mktimeRootLabel.id, allMessages, {
            hasLabel: true,
            labelId: label1FirestoreId,
            priorityId: Priority.Backlog
          },
          gmailLabelUpdate);
      expect(gmailLabelUpdate.addLabelIds).toEqual([
        'INBOX', mktimeRootLabel.id, mktimeLabel1.id
      ]);
      expect(gmailLabelUpdate.removeLabelIds).toEqual([]);
    });

test(
    'populateGmailLabelsToPush_ hasPriority pushes label and priority',
    async () => {
      const mockSettings = new Settings(new MockServerStorage());
      jest.spyOn(mockSettings, 'get')
          .mockImplementation(
              (setting: string) =>
                  setting === ServerStorage.KEYS.PUSH_LABELS_TO_GMAIL);

      const mailProcessor = new MailProcessor(mockSettings);
      jest.spyOn(mailProcessor as any, 'ensureLabelsExist_')
          .mockImplementation(mockEnsureLabelsExist as any);
      jest.spyOn(mailProcessor as any, 'getAllMktimeGmailLabels_')
          .mockImplementation(async () => allMktimeGmailLabels);

      const mockGetLabelName = (labelId: number) => {
        if (`${mktimeLabelIdPrefix}${labelId}` === mktimeLabel1.id) {
          return label1FirestoreId;
        }
        throw new Error(`Invalid label name ${labelId}`);
      };
      jest.spyOn(mailProcessor as any, 'getLabelName_')
          .mockImplementation(mockGetLabelName as any);

      const allMessages: gapi.client.gmail.Message[]|undefined = [
        new MockGmailMessage('1', []),
      ];
      const gmailLabelUpdate = new GmailLabelUpdate(['1']);
      await mailProcessor['populateGmailLabelsToPush_'](
          allMktimeGmailLabels, mktimeRootLabel.id, allMessages, {
            hasPriority: true,
            labelId: label1FirestoreId,
            priorityId: Priority.Backlog
          },
          gmailLabelUpdate);
      expect(gmailLabelUpdate.addLabelIds).toEqual([
        'INBOX', mktimeRootLabel.id, mktimeLabel1.id
      ]);
      expect(gmailLabelUpdate.removeLabelIds).toEqual([]);
    });
