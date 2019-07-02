import {assert, defined, Labels} from './Base.js';
import {firestore, firestoreUserCollection} from './BaseMain.js';

export class SnapshotEvent extends Event {
  static NAME = 'snapshot';
  constructor() {
    super(SnapshotEvent.NAME);
  }
}

export class QueueNames extends EventTarget {
  private static nameIds_?: {[property: string]: string};
  private static idNames_?: {[property: string]: string};
  private static instance_?: QueueNames;

  static create() {
    if (!this.instance_)
      this.instance_ = new QueueNames();
    return this.instance_;
  }

  getNameIdsDocument_() {
    return firestoreUserCollection().doc('NameIds');
  }

  async getAllNames(includeBuiltIns?: boolean) {
    await this.fetch();
    let nameIds = defined(QueueNames.nameIds_);
    let names = Object.keys(nameIds);
    if (includeBuiltIns) {
      // If the labels haven't ever been applied to threads, they won't be in
      // QueueNames yet (and Labels.Archive is never applied)..
      if (!names.includes(Labels.Archive))
        names.push(Labels.Archive);
      if (!names.includes(Labels.Fallback))
        names.push(Labels.Fallback);
    } else {
      names = names.filter(x => x !== Labels.Archive && x !== Labels.Fallback);
    }
    return names;
  }

  setNameIds_(data: any) {
    QueueNames.nameIds_ = data.map;
    QueueNames.idNames_ = {};
    for (var key in data.map) {
      QueueNames.idNames_[data.map[key]] = key;
    }
  }

  async fetch() {
    if (QueueNames.nameIds_)
      return;

    let doc = this.getNameIdsDocument_();
    let snapshot = await doc.get();

    if (snapshot.exists) {
      this.setNameIds_(snapshot.data());
    } else {
      let data = {
        lastId: 0,
        map: {},
      };
      await doc.set(data);
      this.setNameIds_(data);
    }

    doc.onSnapshot((snapshot) => {
      this.setNameIds_(snapshot.data());
      this.dispatchEvent(new SnapshotEvent());
    });
  }

  getName(id: number) {
    return defined(QueueNames.idNames_)[id];
  }

  async delete(name: string) {
    let docRef = this.getNameIdsDocument_();
    return await firestore().runTransaction((transaction) => {
      return transaction.get(docRef).then((doc) => {
        if (!doc.exists) {
          throw 'Document does not exist!';
        }

        let data = defined(doc.data());
        delete data.map[name];
        transaction.update(docRef, data);
      });
    })
  }

  async getId(name: string) {
    await this.fetch();
    let id = defined(QueueNames.nameIds_)[name];
    if (id)
      return id;

    let docRef = this.getNameIdsDocument_();
    return await firestore().runTransaction((transaction) => {
      return transaction.get(docRef).then((doc) => {
        if (!doc.exists) {
          throw 'Document does not exist!';
        }

        let data = defined(doc.data());
        // Another client must have created an ID for this name.
        if (data.map[name])
          return data.map[name];

        // Intentionally always increment before setting the id so that 0 is not
        // a valid ID and we can null check IDs throughout the codebase to test
        // for existence.
        let newId = data.lastId + 1;

        let allIds = Object.values(data.map);
        // Ensure we don't create two names with the same id.
        assert(!allIds.includes(newId));
        data.lastId = newId;
        data.map[name] = newId;
        transaction.update(docRef, data);
        return newId;
      });
    })
  }
}