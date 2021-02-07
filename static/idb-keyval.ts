// Modified version of https://github.com/jakearchibald/idb-keyval.
export class IDBKeyVal {
  _dbp: Promise<any>;
  static store_: IDBKeyVal;
  static getDefault: () => IDBKeyVal;

  constructor(dbName = 'keyval-store', private storeName_ = 'keyval') {
    this._dbp = new Promise((resolve, reject) => {
      const openreq = indexedDB.open(dbName, 1);
      openreq.onerror = () => reject(openreq.error);
      openreq.onsuccess = () => resolve(openreq.result);
      // First time setup: create an empty object store
      openreq.onupgradeneeded = () => {
        openreq.result.createObjectStore(storeName_);
      };
    });
  }
  _withIDBStore(type: any, callback: any) {
    return this._dbp.then(
      (db) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction(this.storeName_, type);
          transaction.oncomplete = () => resolve();
          transaction.onabort = transaction.onerror = () => reject(transaction.error);
          callback(transaction.objectStore(this.storeName_));
        }),
    );
  }
  get(key: string) {
    let req: any;
    return this._withIDBStore('readonly', (store: any) => {
      req = store.get(key);
    }).then(() => req.result);
  }
  set(key: string, value: any) {
    return this._withIDBStore('readwrite', (store: any) => {
      store.put(value, key);
    });
  }
  del(key: string) {
    return this._withIDBStore('readwrite', (store: any) => {
      store.delete(key);
    });
  }
  clear() {
    return this._withIDBStore('readwrite', (store: any) => {
      store.clear();
    });
  }
  keys() {
    let req: any;
    return this._withIDBStore('readonly', (store: any) => {
      req = store.getAllKeys();
    }).then(() => req.result);
  }
}

IDBKeyVal.getDefault = () => {
  if (!IDBKeyVal.store_) IDBKeyVal.store_ = new IDBKeyVal();
  return IDBKeyVal.store_;
};
