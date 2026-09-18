const DB_TIMEOUT = 30000;
const TX_TIMEOUT = 20000;

function _withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`IDB timeout: ${label}`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export class IndexedDBService {
  constructor(options = {}) {
    this.dbName = options.dbName || 'NexusDB';
    this.dbVersion = options.dbVersion || 1;
    this.stores = options.stores || [
      { name: 'chunks', keyPath: 'id', indexes: [
        { name: 'path', keyPath: 'path', unique: false },
        { name: 'pathIndex', keyPath: ['path', 'index'], unique: true },
        { name: 'created', keyPath: 'created', unique: false },
      ]},
      { name: 'metadata', keyPath: 'path', indexes: [
        { name: 'type', keyPath: 'type', unique: false },
        { name: 'modified', keyPath: 'modified', unique: false },
        { name: 'size', keyPath: 'totalSize', unique: false },
      ]},
      { name: 'settings', keyPath: 'key', indexes: [] },
      { name: 'blobs', keyPath: 'id', indexes: [
        { name: 'created', keyPath: 'created', unique: false },
      ]},
      { name: 'kv', keyPath: 'key', indexes: [] },
    ];
    this.db = null;
    this.ready = false;
    this._openPromise = null;
    this._activeTx = new Set();
    this._stats = {
      opens: 0,
      transactions: 0,
      reads: 0,
      writes: 0,
      deletes: 0,
      errors: 0,
    };
  }

  async open() {
    if (this.db) return this.db;
    if (this._openPromise) return this._openPromise;
    this._openPromise = _withTimeout(new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        for (const spec of this.stores) {
          if (!db.objectStoreNames.contains(spec.name)) {
            const store = db.createObjectStore(spec.name, { keyPath: spec.keyPath });
            for (const idx of spec.indexes || []) {
              store.createIndex(idx.name, idx.keyPath, { unique: idx.unique });
            }
          }
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
          this.ready = false;
          this._openPromise = null;
        };
        this.ready = true;
        this._stats.opens++;
        resolve(this.db);
      };
      request.onerror = () => {
        this._openPromise = null;
        this._stats.errors++;
        reject(request.error);
      };
      request.onblocked = () => console.warn('[IndexedDB] upgrade blocked');
    }), DB_TIMEOUT, 'open');
    return this._openPromise;
  }

  async _ensureOpen() {
    if (!this.ready || !this.db) await this.open();
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.ready = false;
      this._openPromise = null;
    }
  }

  async destroy() {
    await this.close();
    await _withTimeout(new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(this.dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    }), DB_TIMEOUT, 'destroy');
  }

  async put(storeName, record, options = {}) {
    await this._ensureOpen();
    return this._tx(storeName, 'readwrite', (store) => {
      const request = store.put(record, options.key);
      this._stats.writes++;
      return request;
    });
  }

  async putBatch(storeName, records, options = {}) {
    await this._ensureOpen();
    if (!records.length) return { count: 0 };
    const tx = this.db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const record of records) {
      store.put(record, options.key);
      this._stats.writes++;
    }
    await this._txDone(tx);
    return { count: records.length };
  }

  async get(storeName, key) {
    await this._ensureOpen();
    return this._tx(storeName, 'readonly', (store) => {
      const request = store.get(key);
      this._stats.reads++;
      return request;
    });
  }

  async getMany(storeName, keys) {
    await this._ensureOpen();
    const results = [];
    const tx = this.db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    for (const key of keys) {
      const req = store.get(key);
      const promise = new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      results.push(promise);
      this._stats.reads++;
    }
    await this._txDone(tx);
    return Promise.all(results);
  }

  async getAll(storeName, query = null, count = null) {
    await this._ensureOpen();
    return this._tx(storeName, 'readonly', (store) => {
      const request = query !== null ? store.getAll(query, count) : store.getAll();
      this._stats.reads++;
      return request;
    });
  }

  async getAllByIndex(storeName, indexName, query = null, count = null) {
    await this._ensureOpen();
    return this._tx(storeName, 'readonly', (store) => {
      const index = store.index(indexName);
      const request = query !== null ? index.getAll(query, count) : index.getAll();
      this._stats.reads++;
      return request;
    });
  }

  async getByIndex(storeName, indexName, query) {
    await this._ensureOpen();
    return this._tx(storeName, 'readonly', (store) => {
      const index = store.index(indexName);
      const request = index.get(query);
      this._stats.reads++;
      return request;
    });
  }

  async count(storeName, query = null) {
    await this._ensureOpen();
    return this._tx(storeName, 'readonly', (store) => {
      const request = query !== null ? store.count(query) : store.count();
      return request;
    });
  }

  async delete(storeName, key) {
    await this._ensureOpen();
    return this._tx(storeName, 'readwrite', (store) => {
      const request = store.delete(key);
      this._stats.deletes++;
      return request;
    });
  }

  async deleteBatch(storeName, keys) {
    await this._ensureOpen();
    const tx = this.db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const key of keys) {
      store.delete(key);
      this._stats.deletes++;
    }
    await this._txDone(tx);
    return { count: keys.length };
  }

  async deleteRange(storeName, indexName, lower, upper) {
    await this._ensureOpen();
    const range = this._buildRange(lower, upper);
    const tx = this.db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    let removed = 0;
    await new Promise((resolve, reject) => {
      const cursor = index.openCursor(range);
      cursor.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          cur.delete();
          removed++;
          this._stats.deletes++;
          cur.continue();
        } else resolve();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    await this._txDone(tx);
    return { removed };
  }

  async clear(storeName) {
    await this._ensureOpen();
    return this._tx(storeName, 'readwrite', (store) => store.clear());
  }

  async clearAll() {
    await this._ensureOpen();
    for (const spec of this.stores) {
      await this.clear(spec.name);
    }
  }

  async *iterate(storeName, query = null, direction = 'next') {
    await this._ensureOpen();
    const tx = this.db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.openCursor(query, direction);
    const self = this;
    const buffer = [];
    let done = false;
    let resolveNext = null;

    const cursorPromise = new Promise((resolve, reject) => {
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          buffer.push(cursor.value);
          if (resolveNext) {
            resolveNext(buffer.shift());
            resolveNext = null;
          }
          cursor.continue();
        } else {
          done = true;
          if (resolveNext) {
            resolveNext(null);
            resolveNext = null;
          }
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });

    while (!done || buffer.length) {
      if (buffer.length) {
        yield buffer.shift();
        self._stats.reads++;
      } else if (done) {
        break;
      } else {
        const item = await new Promise((resolve) => { resolveNext = resolve; });
        if (item === null) break;
        yield item;
        self._stats.reads++;
      }
    }

    await cursorPromise.catch(() => {});
    await this._txDone(tx);
  }

  async *iterateIndex(storeName, indexName, query = null, direction = 'next') {
    await this._ensureOpen();
    const tx = this.db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.openCursor(query, direction);
    const buffer = [];
    let done = false;
    let resolveNext = null;

    const cursorPromise = new Promise((resolve, reject) => {
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          buffer.push(cursor.value);
          if (resolveNext) {
            resolveNext(buffer.shift());
            resolveNext = null;
          }
          cursor.continue();
        } else {
          done = true;
          if (resolveNext) {
            resolveNext(null);
            resolveNext = null;
          }
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });

    while (!done || buffer.length) {
      if (buffer.length) {
        yield buffer.shift();
      } else if (done) {
        break;
      } else {
        const item = await new Promise((resolve) => { resolveNext = resolve; });
        if (item === null) break;
        yield item;
      }
    }

    await cursorPromise.catch(() => {});
    await this._txDone(tx);
  }

  async transaction(storeNames, mode, fn) {
    await this._ensureOpen();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = this.db.transaction(names, mode);
    this._activeTx.add(tx);
    try {
      const result = await fn(tx);
      await this._txDone(tx);
      return result;
    } catch (err) {
      try { tx.abort(); } catch {}
      throw err;
    } finally {
      this._activeTx.delete(tx);
    }
  }

  async getQuota() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        return {
          usage: est.usage || 0,
          quota: est.quota || 0,
          percent: est.quota ? (est.usage / est.quota) * 100 : 0,
          available: Math.max(0, (est.quota || 0) - (est.usage || 0)),
        };
      } catch {}
    }
    return { usage: 0, quota: 0, percent: 0, available: 0 };
  }

  async requestPersistent() {
    if (navigator.storage && navigator.storage.persist) {
      try { return await navigator.storage.persist(); } catch { return false; }
    }
    return false;
  }

  async persisted() {
    if (navigator.storage && navigator.storage.persisted) {
      try { return await navigator.storage.persisted(); } catch { return false; }
    }
    return false;
  }

  async exportStore(storeName) {
    await this._ensureOpen();
    const all = await this.getAll(storeName);
    return {
      store: storeName,
      count: all.length,
      data: all,
      exported: Date.now(),
    };
  }

  async importStore(storeName, data, mode = 'merge') {
    await this._ensureOpen();
    if (mode === 'replace') await this.clear(storeName);
    await this.putBatch(storeName, data);
    return { count: data.length, mode };
  }

  async exportAll() {
    const out = { stores: {}, exported: Date.now(), dbName: this.dbName, version: this.dbVersion };
    for (const spec of this.stores) {
      out.stores[spec.name] = await this.exportStore(spec.name);
    }
    return out;
  }

  async importAll(data, mode = 'merge') {
    for (const [storeName, payload] of Object.entries(data.stores || {})) {
      if (!this.stores.some(s => s.name === storeName)) continue;
      await this.importStore(storeName, payload.data, mode);
    }
  }

  async getDatabaseSize() {
    let total = 0;
    for (const spec of this.stores) {
      try {
        const all = await this.getAll(spec.name);
        for (const record of all) {
          total += JSON.stringify(record).length * 2;
        }
      } catch {}
    }
    return total;
  }

  async getStoreStats() {
    const stats = {};
    for (const spec of this.stores) {
      try {
        stats[spec.name] = {
          count: await this.count(spec.name),
          indexes: spec.indexes?.map(i => i.name) || [],
        };
      } catch {
        stats[spec.name] = { count: 0, error: true };
      }
    }
    return stats;
  }

  getStats() {
    return { ...this._stats, activeTransactions: this._activeTx.size };
  }

  _tx(storeName, mode, fn) {
    return _withTimeout(new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, mode);
      this._activeTx.add(tx);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = fn(store);
      } catch (err) {
        this._activeTx.delete(tx);
        reject(err);
        return;
      }
      if (result && result.onsuccess !== undefined) {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      }
      tx.oncomplete = () => {
        this._activeTx.delete(tx);
        this._stats.transactions++;
        if (!result || result.onsuccess === undefined) resolve(result);
      };
      tx.onerror = () => {
        this._activeTx.delete(tx);
        this._stats.errors++;
        reject(tx.error);
      };
      tx.onabort = () => {
        this._activeTx.delete(tx);
        reject(tx.error || new Error('tx aborted'));
      };
    }), TX_TIMEOUT, `tx:${storeName}`);
  }

  _txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        this._stats.transactions++;
        resolve();
      };
      tx.onerror = () => {
        this._stats.errors++;
        reject(tx.error);
      };
      tx.onabort = () => reject(tx.error || new Error('tx aborted'));
    });
  }

  _buildRange(lower, upper) {
    if (lower != null && upper != null) return IDBKeyRange.bound(lower, upper);
    if (lower != null) return IDBKeyRange.lowerBound(lower);
    if (upper != null) return IDBKeyRange.upperBound(upper);
    return null;
  }
}

export const indexedDBService = new IndexedDBService();
