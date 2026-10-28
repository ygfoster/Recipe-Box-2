// IndexedDB の薄い層(v1 の app.js から移植)。keyPath は 'id'
// openDb({ name, version, stores, onBlocked, onVersionChange }) → { all, put, del, batch }
export function openDb({ name, version = 1, stores, onBlocked, onVersionChange }) {
  let conn;
  const open = () => conn || (conn = new Promise((res, rej) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      stores.forEach((s) => { if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' }); });
    };
    // 古い版のアプリが別のタブで開いていると、保存場所の更新が待たされる
    req.onblocked = () => { if (onBlocked) onBlocked(); };
    req.onsuccess = () => {
      const d = req.result;
      // 新しい版が保存場所を更新しようとしたら、こちらは身を引く
      d.onversionchange = () => {
        d.close();
        conn = null;
        if (onVersionChange) onVersionChange();
      };
      res(d);
    };
    req.onerror = () => rej(req.error);
  }));
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && out.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    put: (store, r) => tx(store, 'readwrite', (s) => s.put(r)),
    del: (store, id) => tx(store, 'readwrite', (s) => s.delete(id)),
    // まとめて書く。ops = [{ type:'put', d } | { type:'del', id }]
    batch: (store, ops) => tx(store, 'readwrite', (s) => {
      ops.forEach((op) => (op.type === 'del' ? s.delete(op.id) : s.put(op.d)));
    }),
  };
}
