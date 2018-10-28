// Modified version of https://github.com/jakearchibald/idb-keyval.
class IDBKeyVal {
  constructor(dbName = 'keyval-store', storeName = 'keyval') {
    this.storeName = storeName;
    this._dbp = new Promise((resolve, reject) => {
      const openreq = indexedDB.open(dbName, 1);
      openreq.onerror = () => reject(openreq.error);
      openreq.onsuccess = () => resolve(openreq.result);
      // First time setup: create an empty object store
      openreq.onupgradeneeded = () => {
        openreq.result.createObjectStore(storeName);
      };
    });
  }
  _withIDBStore(type, callback) {
    return this._dbp.then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, type);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
      callback(transaction.objectStore(this.storeName));
    }));
  }
  get(key) {
    let req;
    return this._withIDBStore('readonly', store => {
      req = store.get(key);
    }).then(() => req.result);
  }
  set(key, value) {
    return this._withIDBStore('readwrite', store => {
      store.put(value, key);
    });
  }
  del(key) {
    return this._withIDBStore('readwrite', store => {
      store.delete(key);
    });
  }
  clear() {
    return this._withIDBStore('readwrite', store => {
      store.clear();
    });
  }
  keys() {
    let req;
    return this._withIDBStore('readonly', store => {
      req = store.getAllKeys();
    }).then(() => req.result);
  }
}

IDBKeyVal.getDefault = () => {
  if (!IDBKeyVal.store_)
    IDBKeyVal.store_ = new IDBKeyVal();
  return IDBKeyVal.store_;
}
