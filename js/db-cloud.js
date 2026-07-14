/* Supabase-backed persistence — a drop-in replacement for CertApp.db (IndexedDB) with the exact
   same interface (open/getAll/put/putMany/get/remove/removeMany/clear/clearAll), so every other
   module keeps working unchanged. Each app "store" maps to one Postgres table of { key, data },
   where `data` is the record exactly as the app uses it. Plus subscribe() for realtime: when any
   PC changes data, the others update their in-memory cache and re-render.
   Active only when cloud is configured (see config.js); otherwise db.js (local) stays in use. */
window.CertApp = window.CertApp || {};
CertApp.dbCloud = (function () {
  var STORE = {
    certificates:       { table: 'certificates',         key: 'id' },
    miscRevenueEntries: { table: 'misc_revenue_entries', key: 'id' },
    auditLog:           { table: 'audit_log',            key: 'id' },
    importBatches:      { table: 'import_batches',        key: 'id' },
    meta:               { table: 'meta',                  key: 'key' }
  };
  var PAGE = 1000;      // Supabase caps a select at 1000 rows/request — page through
  var CHUNK = 500;      // rows per bulk upsert/delete request
  // Shared client (see config.js) so the login session applies to every DB call.
  function client() { return CertApp.supabaseClient(); }
  function chk(res) { if (res && res.error) throw new Error(res.error.message || 'Supabase error'); return res; }
  function keyCol(store) { return STORE[store].key === 'key' ? 'key' : 'id'; }
  function keyOf(store, record) {
    var kf = STORE[store].key;
    if (!record[kf]) record[kf] = CertApp.uuid(); // auditLog had autoIncrement locally
    return record[kf];
  }
  function toRow(store, record) { var row = {}; row[keyCol(store)] = keyOf(store, record); row.data = record; return row; }

  function open() { client(); return Promise.resolve(); }

  function getAll(store) {
    var table = STORE[store].table, out = [];
    function page(from) {
      return client().from(table).select('data').range(from, from + PAGE - 1).then(function (res) {
        chk(res);
        var rows = (res.data || []).map(function (r) { return r.data; });
        out = out.concat(rows);
        return rows.length === PAGE ? page(from + PAGE) : out;
      });
    }
    return page(0);
  }

  function get(store, key) {
    return client().from(STORE[store].table).select('data').eq(keyCol(store), key).maybeSingle()
      .then(function (res) { chk(res); return res.data ? res.data.data : undefined; });
  }

  function put(store, record) {
    return client().from(STORE[store].table).upsert(toRow(store, record)).then(chk).then(function () { return record; });
  }

  function putMany(store, records) {
    if (!records || !records.length) return Promise.resolve();
    var rows = records.map(function (r) { return toRow(store, r); });
    var chain = Promise.resolve();
    for (var i = 0; i < rows.length; i += CHUNK) {
      (function (batch) { chain = chain.then(function () { return client().from(STORE[store].table).upsert(batch).then(chk); }); })(rows.slice(i, i + CHUNK));
    }
    return chain;
  }

  function remove(store, key) {
    return client().from(STORE[store].table).delete().eq(keyCol(store), key).then(chk);
  }

  function removeMany(store, keys) {
    if (!keys || !keys.length) return Promise.resolve();
    var col = keyCol(store), chain = Promise.resolve();
    for (var i = 0; i < keys.length; i += CHUNK) {
      (function (batch) { chain = chain.then(function () { return client().from(STORE[store].table).delete().in(col, batch).then(chk); }); })(keys.slice(i, i + CHUNK));
    }
    return chain;
  }

  function clear(store) {
    // delete every row (an always-true filter — no key ever equals this sentinel)
    return client().from(STORE[store].table).delete().neq(keyCol(store), '__never_matches__').then(chk);
  }
  function clearAll() { return Promise.all(Object.keys(STORE).map(clear)); }

  // Realtime: mirror remote row changes into the in-memory cache, then call onChanged() (which the
  // caller debounces into a re-render). Only the two cached stores are subscribed; auditLog and
  // importBatches are re-fetched whenever their views open.
  function subscribe(onChanged) {
    function upsertInto(arr, rec) {
      var i = arr.findIndex(function (x) { return x.id === rec.id; });
      if (i === -1) arr.push(rec); else arr[i] = rec;
    }
    function removeFrom(arr, id) {
      var i = arr.findIndex(function (x) { return x.id === id; });
      if (i !== -1) arr.splice(i, 1);
    }
    function handler(cacheArr) {
      return function (payload) {
        if (payload.eventType === 'DELETE') { if (payload.old) removeFrom(cacheArr, payload.old.id); }
        else if (payload.new && payload.new.data) upsertInto(cacheArr, payload.new.data);
        onChanged();
      };
    }
    client().channel('cert-ledger')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'certificates' }, handler(CertApp.cache.certificates))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'misc_revenue_entries' }, handler(CertApp.cache.miscRevenue))
      .subscribe();
  }

  return {
    open: open, getAll: getAll, put: put, putMany: putMany, get: get,
    remove: remove, removeMany: removeMany, clear: clear, clearAll: clearAll, subscribe: subscribe
  };
})();

// Install as the active persistence layer when cloud is configured (this file loads after db.js,
// so it overrides the IndexedDB CertApp.db).
if (CertApp.cloudEnabled && CertApp.cloudEnabled()) {
  CertApp.db = CertApp.dbCloud;
}
