/* IndexedDB wrapper for CertApp */
window.CertApp = window.CertApp || {};

(function () {
  var DB_NAME = 'certLedgerDB';
  var DB_VERSION = 1;
  var _dbPromise = null;

  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is not available in this browser/context.'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        var db = e.target.result;

        if (!db.objectStoreNames.contains('certificates')) {
          var certStore = db.createObjectStore('certificates', { keyPath: 'id' });
          certStore.createIndex('certificateNo', 'certificateNo', { unique: false });
          certStore.createIndex('category', 'category', { unique: false });
          certStore.createIndex('status', 'status', { unique: false });
          certStore.createIndex('issuedDate', 'issuedDate', { unique: false });
          certStore.createIndex('usedDate', 'usedDate', { unique: false });
          certStore.createIndex('expiryDate', 'expiryDate', { unique: false });
          certStore.createIndex('category_status', ['category', 'status'], { unique: false });
        }

        if (!db.objectStoreNames.contains('miscRevenueEntries')) {
          var mrStore = db.createObjectStore('miscRevenueEntries', { keyPath: 'id' });
          mrStore.createIndex('certificateId', 'certificateId', { unique: false });
          mrStore.createIndex('entryDate', 'entryDate', { unique: false });
          mrStore.createIndex('type', 'type', { unique: false });
        }

        if (!db.objectStoreNames.contains('auditLog')) {
          var alStore = db.createObjectStore('auditLog', { keyPath: 'id', autoIncrement: true });
          alStore.createIndex('certificateId', 'certificateId', { unique: false });
          alStore.createIndex('ts', 'ts', { unique: false });
        }

        if (!db.objectStoreNames.contains('importBatches')) {
          var ibStore = db.createObjectStore('importBatches', { keyPath: 'id' });
          ibStore.createIndex('importedAt', 'importedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };

      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
    return _dbPromise;
  }

  function tx(storeNames, mode) {
    return openDb().then(function (db) {
      return db.transaction(storeNames, mode);
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getAll(storeName) {
    return tx([storeName], 'readonly').then(function (t) {
      return reqToPromise(t.objectStore(storeName).getAll());
    });
  }

  function put(storeName, record) {
    return tx([storeName], 'readwrite').then(function (t) {
      return reqToPromise(t.objectStore(storeName).put(record));
    });
  }

  function putMany(storeName, records) {
    return tx([storeName], 'readwrite').then(function (t) {
      var store = t.objectStore(storeName);
      return Promise.all(records.map(function (r) { return reqToPromise(store.put(r)); }));
    });
  }

  function get(storeName, key) {
    return tx([storeName], 'readonly').then(function (t) {
      return reqToPromise(t.objectStore(storeName).get(key));
    });
  }

  function remove(storeName, key) {
    return tx([storeName], 'readwrite').then(function (t) {
      return reqToPromise(t.objectStore(storeName).delete(key));
    });
  }

  function removeMany(storeName, keys) {
    if (!keys || keys.length === 0) return Promise.resolve();
    return tx([storeName], 'readwrite').then(function (t) {
      var store = t.objectStore(storeName);
      return Promise.all(keys.map(function (k) { return reqToPromise(store.delete(k)); }));
    });
  }

  function clear(storeName) {
    return tx([storeName], 'readwrite').then(function (t) {
      return reqToPromise(t.objectStore(storeName).clear());
    });
  }

  var ALL_STORES = ['certificates', 'miscRevenueEntries', 'auditLog', 'importBatches', 'meta'];
  function clearAll() {
    return tx(ALL_STORES, 'readwrite').then(function (t) {
      return Promise.all(ALL_STORES.map(function (s) { return reqToPromise(t.objectStore(s).clear()); }));
    });
  }

  CertApp.db = {
    open: openDb,
    getAll: getAll,
    put: put,
    putMany: putMany,
    get: get,
    remove: remove,
    removeMany: removeMany,
    clear: clear,
    clearAll: clearAll
  };
})();
