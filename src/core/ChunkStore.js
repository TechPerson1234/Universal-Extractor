const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 64;
const DEFAULT_MAX_CACHE_BYTES = 64 * 1024 * 1024;
const COMPRESS_THRESHOLD = 4096;
const IDB_TIMEOUT = 30000;

function _uid() {
  return Math.random().toString(36).slice(2, 12);
}

function _toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (data instanceof Uint8Array) {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return data.buffer;
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  if (data && data.buffer instanceof ArrayBuffer) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  if (typeof data === 'string') return new TextEncoder().encode(data).buffer;
  if (Array.isArray(data)) return new Uint8Array(data).buffer;
  throw new TypeError('Unsupported chunk data type');
}

function _concat(parts) {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

function _hex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

async function _sha256(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return _hex(new Uint8Array(hash));
}

function _withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export class StreamingHasher {
  constructor(algorithm = 'SHA-256') {
    this.algorithm = algorithm;
    this.chunks = [];
    this.total = 0;
    this._finalized = null;
  }

  update(data) {
    if (!data) return;
    let view;
    if (data instanceof ArrayBuffer) view = new Uint8Array(data);
    else if (data instanceof Uint8Array) view = data;
    else if (data.buffer instanceof ArrayBuffer) view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else view = new Uint8Array(data);
    this.chunks.push(view);
    this.total += view.byteLength;
    this._finalized = null;
  }

  async digest() {
    if (this._finalized) return this._finalized;
    const combined = new Uint8Array(this.total);
    let off = 0;
    for (const c of this.chunks) {
      combined.set(c, off);
      off += c.byteLength;
    }
    const hash = await crypto.subtle.digest(this.algorithm, combined.buffer);
    this._finalized = _hex(new Uint8Array(hash));
    this.chunks = [];
    return this._finalized;
  }

  reset() {
    this.chunks = [];
    this.total = 0;
    this._finalized = null;
  }
}

export class ChunkStore {
  constructor(options = {}) {
    this.dbName = options.dbName || 'NexusChunks';
    this.dbVersion = options.dbVersion || 1;
    this.chunkStoreName = 'chunks';
    this.metaStoreName = 'chunkmeta';
    this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
    this.maxCacheEntries = options.maxCacheEntries || DEFAULT_MAX_CACHE_ENTRIES;
    this.maxCacheBytes = options.maxCacheBytes || DEFAULT_MAX_CACHE_BYTES;
    this.compressEnabled = options.compress !== false;
    this.db = null;
    this.ready = false;
    this._cache = new Map();
    this._cacheBytes = 0;
    this._writeChains = new Map();
    this._observers = new Set();
    this._openPromise = null;
    this._stats = {
      reads: 0,
      writes: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
      bytesWritten: 0,
      bytesRead: 0,
      deletes: 0,
      compressions: 0,
      decompressions: 0,
      errors: 0,
    };
  }

  async open() {
    if (this.db) return this.db;
    if (this._openPromise) return this._openPromise;
    this._openPromise = _withTimeout(new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.chunkStoreName)) {
          const store = db.createObjectStore(this.chunkStoreName, { keyPath: 'id' });
          store.createIndex('path', 'path', { unique: false });
          store.createIndex('pathIndex', ['path', 'index'], { unique: true });
          store.createIndex('created', 'created', { unique: false });
        }
        if (!db.objectStoreNames.contains(this.metaStoreName)) {
          const meta = db.createObjectStore(this.metaStoreName, { keyPath: 'path' });
          meta.createIndex('updated', 'updated', { unique: false });
          meta.createIndex('size', 'totalSize', { unique: false });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
          this.ready = false;
          this._openPromise = null;
        };
        this.ready = true;
        resolve(this.db);
      };
      req.onerror = () => {
        this._openPromise = null;
        reject(req.error);
      };
      req.onblocked = () => console.warn('[ChunkStore] blocked');
    }), IDB_TIMEOUT, 'open');
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
    }), IDB_TIMEOUT, 'destroy');
  }

  _chunkId(path, index) {
    return `${path}::${index}`;
  }

  async _idbPut(storeName, record) {
    await this._ensureOpen();
    return _withTimeout(new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }), IDB_TIMEOUT, `put:${storeName}`);
  }

  async _idbGet(storeName, key) {
    await this._ensureOpen();
    return _withTimeout(new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }), IDB_TIMEOUT, `get:${storeName}`);
  }

  async _idbDelete(storeName, key) {
    await this._ensureOpen();
    return _withTimeout(new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }), IDB_TIMEOUT, `delete:${storeName}`);
  }

  async _idbClear(storeName) {
    await this._ensureOpen();
    return _withTimeout(new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }), IDB_TIMEOUT, `clear:${storeName}`);
  }

  async _idbGetAll(storeName) {
    await this._ensureOpen();
    return _withTimeout(new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }), IDB_TIMEOUT, `getAll:${storeName}`);
  }

  async _idbCount(storeName) {
    await this._ensureOpen();
    return _withTimeout(new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }), IDB_TIMEOUT, `count:${storeName}`);
  }

  _txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('tx aborted'));
    });
  }

  async _compress(buffer) {
    if (!this.compressEnabled) return { data: buffer, compressed: false };
    if (buffer.byteLength < COMPRESS_THRESHOLD) return { data: buffer, compressed: false };
    if (typeof CompressionStream === 'undefined') return { data: buffer, compressed: false };
    try {
      const cs = new CompressionStream('gzip');
      const blob = new Blob([buffer]);
      const stream = blob.stream().pipeThrough(cs);
      const out = await new Response(stream).arrayBuffer();
      if (out.byteLength >= buffer.byteLength) return { data: buffer, compressed: false };
      this._stats.compressions++;
      return { data: out, compressed: true };
    } catch {
      this._stats.errors++;
      return { data: buffer, compressed: false };
    }
  }

  async _decompress(buffer) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream unavailable');
    }
    const ds = new DecompressionStream('gzip');
    const blob = new Blob([buffer]);
    const stream = blob.stream().pipeThrough(ds);
    this._stats.decompressions++;
    return new Response(stream).arrayBuffer();
  }

  async writeChunk(path, index, data, options = {}) {
    await this._ensureOpen();
    const buffer = _toArrayBuffer(data);
    const id = this._chunkId(path, index);
    const checksum = options.checksum || (options.hash ? await _sha256(buffer) : null);
    const { data: stored, compressed } = options.compress === false
      ? { data: buffer, compressed: false }
      : await this._compress(buffer);
    const record = {
      id,
      path,
      index,
      data: stored,
      size: buffer.byteLength,
      storedSize: stored.byteLength,
      compressed,
      checksum,
      created: Date.now(),
    };
    const prev = this._writeChains.get(path) || Promise.resolve();
    const next = prev.then(() => this._idbPut(this.chunkStoreName, record));
    this._writeChains.set(path, next.catch(() => {}));
    await next;
    this._cachePut(id, buffer);
    this._stats.writes++;
    this._stats.bytesWritten += buffer.byteLength;
    this._notify('write', { path, index, size: buffer.byteLength });
    return { id, size: buffer.byteLength, storedSize: stored.byteLength, compressed, checksum };
  }

  async writeChunks(path, chunks) {
    await this._ensureOpen();
    if (!chunks || !chunks.length) return { count: 0, bytes: 0 };
    const tx = this.db.transaction(this.chunkStoreName, 'readwrite');
    const store = tx.objectStore(this.chunkStoreName);
    let totalBytes = 0;
    for (const c of chunks) {
      const buffer = _toArrayBuffer(c.data);
      const id = this._chunkId(path, c.index);
      store.put({
        id,
        path,
        index: c.index,
        data: buffer,
        size: buffer.byteLength,
        storedSize: buffer.byteLength,
        compressed: false,
        checksum: c.checksum || null,
        created: Date.now(),
      });
      this._cachePut(id, buffer);
      totalBytes += buffer.byteLength;
      this._stats.writes++;
    }
    await this._txDone(tx);
    this._stats.bytesWritten += totalBytes;
    this._notify('writeBatch', { path, count: chunks.length, size: totalBytes });
    return { count: chunks.length, bytes: totalBytes };
  }

  async appendChunk(path, data, options = {}) {
    const meta = await this.readMeta(path);
    const nextIndex = meta && typeof meta.chunkCount === 'number' ? meta.chunkCount : 0;
    const buffer = _toArrayBuffer(data);
    await this.writeChunk(path, nextIndex, buffer, options);
    const updated = {
      path,
      chunkCount: nextIndex + 1,
      totalSize: (meta?.totalSize || 0) + buffer.byteLength,
      updated: Date.now(),
      created: meta?.created || Date.now(),
    };
    await this.writeMeta(path, updated);
    return updated;
  }

  async readChunk(path, index) {
    await this._ensureOpen();
    const id = this._chunkId(path, index);
    this._stats.reads++;
    if (this._cache.has(id)) {
      this._stats.hits++;
      const entry = this._cache.get(id);
      this._cache.delete(id);
      this._cache.set(id, entry);
      return entry.data.slice(0);
    }
    this._stats.misses++;
    const record = await this._idbGet(this.chunkStoreName, id);
    if (!record) return null;
    let buffer = record.data;
    if (record.compressed) {
      try {
        buffer = await this._decompress(buffer);
      } catch (e) {
        this._stats.errors++;
        return null;
      }
    }
    this._stats.bytesRead += record.size;
    this._cachePut(id, buffer);
    return buffer.slice(0);
  }

  async readRange(path, start, end) {
    await this._ensureOpen();
    if (end <= start) return new Uint8Array(0);
    const first = Math.floor(start / this.chunkSize);
    const last = Math.floor((end - 1) / this.chunkSize);
    const parts = [];
    for (let i = first; i <= last; i++) {
      const chunk = await this.readChunk(path, i);
      if (!chunk) continue;
      const chunkStart = i * this.chunkSize;
      const ls = Math.max(0, start - chunkStart);
      const le = Math.min(chunk.byteLength, end - chunkStart);
      if (le > ls) parts.push(new Uint8Array(chunk, ls, le - ls));
    }
    return _concat(parts);
  }

  async *iterateChunks(path, chunkCount) {
    await this._ensureOpen();
    const total = typeof chunkCount === 'number'
      ? chunkCount
      : (await this.readMeta(path))?.chunkCount || 0;
    for (let i = 0; i < total; i++) {
      const chunk = await this.readChunk(path, i);
      if (chunk) yield { index: i, data: new Uint8Array(chunk) };
    }
  }

  async readAll(path, chunkCount) {
    const parts = [];
    for await (const { data } of this.iterateChunks(path, chunkCount)) {
      parts.push(data);
    }
    return _concat(parts);
  }

  async readAsBlob(path, mimeType) {
    const meta = await this.readMeta(path);
    const parts = [];
    if (meta && meta.chunkCount) {
      for await (const { data } of this.iterateChunks(path, meta.chunkCount)) {
        parts.push(data);
      }
    }
    return new Blob(parts, { type: mimeType || 'application/octet-stream' });
  }

  async readAsStream(path, highWaterMark = 4) {
    const self = this;
    const meta = await this.readMeta(path);
    const total = meta?.chunkCount || 0;
    let index = 0;
    return new ReadableStream({
      async pull(controller) {
        if (index >= total) {
          controller.close();
          return;
        }
        const startIdx = index;
        const batch = Math.min(highWaterMark, total - index);
        for (let i = 0; i < batch; i++) {
          const chunk = await self.readChunk(path, index);
          index++;
          if (chunk) controller.enqueue(new Uint8Array(chunk));
        }
        if (index >= total) controller.close();
      },
      cancel() { index = total; },
    }, { highWaterMark: 1 });
  }

  async writeMeta(path, meta) {
    await this._ensureOpen();
    const record = { path, ...meta, updated: Date.now() };
    return this._idbPut(this.metaStoreName, record);
  }

  async readMeta(path) {
    await this._ensureOpen();
    return this._idbGet(this.metaStoreName, path);
  }

  async updateMeta(path, patch) {
    const existing = (await this.readMeta(path)) || { path };
    const merged = { ...existing, ...patch, path, updated: Date.now() };
    await this.writeMeta(path, merged);
    return merged;
  }

  async deleteMeta(path) {
    await this._ensureOpen();
    await this._idbDelete(this.metaStoreName, path);
  }

  async listMeta() {
    await this._ensureOpen();
    return this._idbGetAll(this.metaStoreName);
  }

  async deleteAllChunks(path) {
    await this._ensureOpen();
    const tx = this.db.transaction(this.chunkStoreName, 'readwrite');
    const store = tx.objectStore(this.chunkStoreName);
    const index = store.index('path');
    const range = IDBKeyRange.only(path);
    let removed = 0;
    await new Promise((resolve, reject) => {
      const cursor = index.openCursor(range);
      cursor.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          this._cacheDelete(cur.value.id);
          cur.delete();
          this._stats.deletes++;
          removed++;
          cur.continue();
        } else resolve();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    await this._txDone(tx);
    this._notify('delete', { path, removed });
    return removed;
  }

  async deleteFile(path) {
    const removed = await this.deleteAllChunks(path);
    await this.deleteMeta(path);
    return removed;
  }

  async deleteRange(path, startIndex, endIndex) {
    await this._ensureOpen();
    const tx = this.db.transaction(this.chunkStoreName, 'readwrite');
    const store = tx.objectStore(this.chunkStoreName);
    const index = store.index('path');
    const range = IDBKeyRange.only(path);
    let removed = 0;
    await new Promise((resolve, reject) => {
      const cursor = index.openCursor(range);
      cursor.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          if (cur.value.index >= startIndex && cur.value.index <= endIndex) {
            this._cacheDelete(cur.value.id);
            cur.delete();
            this._stats.deletes++;
            removed++;
          }
          cur.continue();
        } else resolve();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    await this._txDone(tx);
    return removed;
  }

  async verifyChunk(path, index) {
    const record = await this._idbGet(this.chunkStoreName, this._chunkId(path, index));
    if (!record) return { ok: false, reason: 'missing', index };
    if (!record.checksum) return { ok: true, reason: 'unverified', index };
    let payload = record.data;
    if (record.compressed) {
      try { payload = await this._decompress(payload); }
      catch { return { ok: false, reason: 'decompress-failed', index }; }
    }
    const hash = await _sha256(payload);
    return { ok: hash === record.checksum, actual: hash, expected: record.checksum, index };
  }

  async verifyFile(path, chunkCount) {
    const meta = await this.readMeta(path);
    const total = typeof chunkCount === 'number' ? chunkCount : meta?.chunkCount || 0;
    const failures = [];
    for (let i = 0; i < total; i++) {
      const r = await this.verifyChunk(path, i);
      if (!r.ok) failures.push(r);
    }
    return { ok: failures.length === 0, chunkCount: total, failures };
  }

  async getQuota() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const usage = est.usage || 0;
        const quota = est.quota || 0;
        return {
          usage,
          quota,
          percent: quota ? (usage / quota) * 100 : 0,
          available: Math.max(0, quota - usage),
        };
      } catch {
        return { usage: 0, quota: 0, percent: 0, available: 0 };
      }
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

  async evictOldest(candidates, targetBytes) {
    const sorted = [...candidates].sort((a, b) => (a.created || 0) - (b.created || 0));
    let removed = 0;
    let count = 0;
    for (const c of sorted) {
      await this.deleteFile(c.path);
      removed += c.size || 0;
      count++;
      if (removed >= targetBytes) break;
    }
    return { removed, count, target: targetBytes };
  }

  async evictUntilBelow(percentThreshold, candidateLister) {
    const quota = await this.getQuota();
    if (!quota.quota) return { evicted: 0 };
    if (quota.percent <= percentThreshold) return { evicted: 0 };
    const targetBytes = Math.floor(quota.quota * (percentThreshold / 100));
    const need = quota.usage - targetBytes;
    const candidates = candidateLister ? await candidateLister() : [];
    return this.evictOldest(candidates, need);
  }

  async clearAll() {
    await this._ensureOpen();
    await this._idbClear(this.chunkStoreName);
    await this._idbClear(this.metaStoreName);
    this._cache.clear();
    this._cacheBytes = 0;
    this._notify('clear', {});
  }

  async countChunks() {
    await this._ensureOpen();
    return this._idbCount(this.chunkStoreName);
  }

  async countFiles() {
    await this._ensureOpen();
    return this._idbCount(this.metaStoreName);
  }

  async listPaths() {
    const metas = await this.listMeta();
    return metas.map(m => m.path);
  }

  async listPathStats() {
    const metas = await this.listMeta();
    return metas.map(m => ({
      path: m.path,
      chunkCount: m.chunkCount || 0,
      totalSize: m.totalSize || 0,
      created: m.created || 0,
      updated: m.updated || 0,
    }));
  }

  async exportPath(path, chunkCount) {
    const meta = await this.readMeta(path);
    const total = typeof chunkCount === 'number' ? chunkCount : meta?.chunkCount || 0;
    const chunks = [];
    for await (const { index, data } of this.iterateChunks(path, total)) {
      chunks.push({ index, data: Array.from(data) });
    }
    return { path, meta, chunks, exported: Date.now() };
  }

  async importPath(bundle) {
    if (!bundle || !bundle.path) throw new Error('Invalid bundle');
    if (bundle.meta) await this.writeMeta(bundle.path, bundle.meta);
    for (const c of bundle.chunks || []) {
      await this.writeChunk(bundle.path, c.index, new Uint8Array(c.data).buffer);
    }
    return { path: bundle.path, imported: bundle.chunks?.length || 0 };
  }

  async exportAll() {
    const paths = await this.listMeta();
    const bundles = [];
    for (const m of paths) bundles.push(await this.exportPath(m.path));
    return { bundles, exported: Date.now() };
  }

  _cachePut(key, data) {
    if (!data) return;
    if (this._cache.has(key)) {
      const existing = this._cache.get(key);
      this._cacheBytes -= existing.size;
      this._cache.delete(key);
    }
    const size = data.byteLength || data.length || 0;
    if (size > this.maxCacheBytes) return;
    this._cache.set(key, { data, size });
    this._cacheBytes += size;
    this._enforceCache();
  }

  _cacheDelete(key) {
    const entry = this._cache.get(key);
    if (entry) {
      this._cacheBytes -= entry.size;
      this._cache.delete(key);
    }
  }

  _enforceCache() {
    while (this._cache.size > this.maxCacheEntries || this._cacheBytes > this.maxCacheBytes) {
      const firstKey = this._cache.keys().next().value;
      if (firstKey === undefined) break;
      this._cacheDelete(firstKey);
      this._stats.evictions++;
    }
  }

  clearCache() {
    this._cache.clear();
    this._cacheBytes = 0;
  }

  getCacheStats() {
    return {
      entries: this._cache.size,
      bytes: this._cacheBytes,
      maxEntries: this.maxCacheEntries,
      maxBytes: this.maxCacheBytes,
      evictions: this._stats.evictions,
    };
  }

  getStats() {
    return { ...this._stats, cache: this.getCacheStats() };
  }

  resetStats() {
    this._stats = {
      reads: 0, writes: 0, hits: 0, misses: 0, evictions: 0,
      bytesWritten: 0, bytesRead: 0, deletes: 0,
      compressions: 0, decompressions: 0, errors: 0,
    };
  }

  observe(fn) {
    this._observers.add(fn);
    return () => this._observers.delete(fn);
  }

  _notify(type, payload) {
    for (const fn of this._observers) {
      try { fn({ type, ...payload, ts: Date.now() }); } catch {}
    }
  }

  async writeStream(path, readableStream, options = {}) {
    await this._ensureOpen();
    const chunkSize = options.chunkSize || this.chunkSize;
    const onProgress = options.onProgress;
    const hash = options.hash !== false;
    const reader = readableStream.getReader();
    let buffer = new Uint8Array(0);
    let index = 0;
    let total = 0;
    const hasher = hash ? new StreamingHasher('SHA-256') : null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.byteLength) continue;
      if (hasher) hasher.update(value);
      total += value.byteLength;
      const combined = new Uint8Array(buffer.byteLength + value.byteLength);
      combined.set(buffer);
      combined.set(value, buffer.byteLength);
      buffer = combined;
      while (buffer.byteLength >= chunkSize) {
        const slice = buffer.slice(0, chunkSize);
        await this.writeChunk(path, index, slice, { compress: true });
        index++;
        buffer = buffer.slice(chunkSize);
        if (onProgress) onProgress({ loaded: total, chunkIndex: index });
      }
    }
    if (buffer.byteLength > 0) {
      await this.writeChunk(path, index, buffer, { compress: true });
      index++;
    }
    const checksum = hasher ? await hasher.digest() : null;
    const meta = {
      path,
      chunkCount: index,
      totalSize: total,
      checksum,
      created: Date.now(),
    };
    await this.writeMeta(path, meta);
    return meta;
  }
}
