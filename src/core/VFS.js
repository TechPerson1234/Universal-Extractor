import { ChunkStore } from './ChunkStore.js';

const SMALL_FILE_THRESHOLD = 8 * 1024 * 1024;
const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const SEARCH_TOKEN_LIMIT = 64;
const DEFAULT_BLOB_CACHE_BYTES = 512 * 1024 * 1024;

const IMAGE_EXTS = ['png','jpg','jpeg','webp','gif','bmp','svg','ico','avif','tiff'];
const VIDEO_EXTS = ['mp4','webm','mov','avi','mkv','flv','wmv','m4v','mpg','mpeg'];
const AUDIO_EXTS = ['mp3','wav','ogg','flac','aac','m4a','opus','oga'];
const TEXT_EXTS = ['txt','json','md','js','mjs','ts','html','htm','css','xml','yaml','yml','csv','log','c','cpp','h','hpp','java','py','rb','go','rs','swift','kt','php','sh','bat','ps1','ini','cfg','toml'];
const MODEL_EXTS = ['obj','stl','gltf','glb','fbx','3ds','dae','ply'];
const PDF_EXTS = ['pdf'];
const ARCHIVE_EXTS = ['zip','apk','jar','rar','7z','tar','gz','bz2','xz','tgz','war'];

export function getFileType(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return 'BINARY';
  const ext = filename.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return 'IMAGE';
  if (VIDEO_EXTS.includes(ext)) return 'VIDEO';
  if (AUDIO_EXTS.includes(ext)) return 'AUDIO';
  if (TEXT_EXTS.includes(ext)) return 'TEXT';
  if (MODEL_EXTS.includes(ext)) return 'MODEL';
  if (PDF_EXTS.includes(ext)) return 'PDF';
  if (ARCHIVE_EXTS.includes(ext)) return 'ARCHIVE';
  return 'BINARY';
}

export function getMimeType(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = filename.slice(dot + 1).toLowerCase();
  const map = {
    png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp',
    gif:'image/gif', bmp:'image/bmp', svg:'image/svg+xml', ico:'image/x-icon',
    avif:'image/avif', tiff:'image/tiff',
    mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', avi:'video/x-msvideo',
    mkv:'video/x-matroska', m4v:'video/x-m4v',
    mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac',
    aac:'audio/aac', m4a:'audio/mp4', opus:'audio/opus',
    txt:'text/plain', json:'application/json', md:'text/markdown',
    js:'text/javascript', mjs:'text/javascript', ts:'text/typescript',
    html:'text/html', htm:'text/html', css:'text/css', xml:'application/xml',
    yaml:'text/yaml', yml:'text/yaml', csv:'text/csv', log:'text/plain',
    pdf:'application/pdf',
    zip:'application/zip', apk:'application/vnd.android.package-archive',
    jar:'application/java-archive', rar:'application/vnd.rar',
    '7z':'application/x-7z-compressed', tar:'application/x-tar',
    gz:'application/gzip', tgz:'application/gzip',
    obj:'text/plain', stl:'application/sla', gltf:'model/gltf+json',
    glb:'model/gltf-binary', fbx:'application/octet-stream',
  };
  return map[ext] || 'application/octet-stream';
}

export class VFS {
  constructor(options = {}) {
    this.chunkStore = options.chunkStore || new ChunkStore({
      chunkSize: options.chunkSize || DEFAULT_CHUNK_SIZE,
      dbName: options.chunkDbName || 'NexusChunks',
      compress: options.compress !== false,
    });
    this.smallFileThreshold = options.smallFileThreshold || SMALL_FILE_THRESHOLD;
    this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
    this.persistence = options.persistence !== false;
    this.dbName = options.dbName || 'NexusVFS';
    this.dbVersion = options.dbVersion || 1;
    this.metaStore = 'metadata';
    this.db = null;
    this.ready = false;
    this.files = new Map();
    this.folders = new Set(['/']);
    this.tags = new Map();
    this._changeListeners = new Set();
    this._progressListeners = new Set();
    this._searchIndex = new Map();
    this._searchCache = null;
    this._searchCacheDirty = true;
    this._opQueue = Promise.resolve();
    this._blobCache = new Map();
    this._blobCacheBytes = 0;
    this._maxBlobCacheBytes = options.maxBlobCacheBytes || DEFAULT_BLOB_CACHE_BYTES;
    this._stats = {
      ingested: 0, bytesIngested: 0, reads: 0, bytesRead: 0,
      writes: 0, deletes: 0, moves: 0, copies: 0,
      blobCacheHits: 0, blobCacheMisses: 0, blobCacheEvictions: 0,
    };
  }

  async init() {
    if (this.ready) return;
    await this.chunkStore.open();
    if (this.persistence) await this._openMetaDB();
    if (this.persistence) await this.loadFromDB();
    this.ready = true;
    this._emitChange('ready', {});
  }

  async _openMetaDB() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.metaStore)) {
          const store = db.createObjectStore(this.metaStore, { keyPath: 'path' });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('modified', 'modified', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  async loadFromDB() {
    if (!this.persistence) return;
    await this._openMetaDB();
    const all = await this._idbGetAll(this.metaStore);
    for (const entry of all) {
      this.files.set(entry.path, { ...entry });
      this._indexPath(entry.path);
      this._searchIndex.set(entry.path, this._tokenize(entry.path));
      const parts = entry.path.split('/');
      let cur = '';
      for (let i = 0; i < parts.length - 1; i++) {
        cur += (cur ? '/' : '') + parts[i];
        this.folders.add(cur || '/');
      }
    }
    for (const path of this.files.keys()) {
      const meta = await this.chunkStore.readMeta(path);
      if (meta && meta.chunkCount) {
        const f = this.files.get(path);
        if (f) f.chunkCount = meta.chunkCount;
      }
    }
    this._emitChange('loaded', { count: this.files.size });
  }

  async saveToDB() {
    if (!this.persistence) return;
    await this._openMetaDB();
    const tx = this.db.transaction(this.metaStore, 'readwrite');
    const store = tx.objectStore(this.metaStore);
    store.clear();
    for (const [path, file] of this.files) {
      const { blob, ...meta } = file;
      store.put({ ...meta, path });
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  _idbGetAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async ingest(file, path) {
    return this._enqueue(async () => {
      if (!path) path = '/' + (file.name || `file_${Date.now()}`);
      path = this._normalizePath(path);
      const name = path.split('/').pop();
      const type = getFileType(name);
      const mimeType = file.type || getMimeType(name);
      const size = file.size;

      const meta = {
        path,
        name,
        type,
        mimeType,
        size,
        created: Date.now(),
        modified: Date.now(),
        chunkCount: 0,
        checksum: null,
        tags: [],
        metadata: {},
      };

      if (size === 0) {
        meta.chunkCount = 0;
        this.files.set(path, meta);
        this._indexPath(path);
        await this._persistMeta(meta);
        this._stats.ingested++;
        this._emitChange('ingest', { path, size: 0 });
        return meta;
      }

      const stream = file.stream();
      const result = await this._writeStream(path, stream, {
        totalSize: size,
        chunkSize: this.chunkSize,
        onProgress: (p) => this._emitProgress({ path, ...p }),
      });

      meta.chunkCount = result.chunkCount;
      meta.checksum = result.checksum;
      meta.size = result.totalSize;
      this.files.set(path, meta);
      this._indexPath(path);
      this._searchIndex.set(path, this._tokenize(path));
      await this._persistMeta(meta);

      try {
        this._setBlobCache(path, file);
      } catch (e) {}

      this._stats.ingested++;
      this._stats.bytesIngested += size;
      this._emitChange('ingest', { path, size });
      return meta;
    });
  }

  async ingestStream(stream, path, options = {}) {
    return this._enqueue(async () => {
      path = this._normalizePath(path);
      const name = path.split('/').pop();
      const result = await this._writeStream(path, stream, {
        totalSize: options.totalSize || 0,
        chunkSize: options.chunkSize || this.chunkSize,
        onProgress: options.onProgress || ((p) => this._emitProgress({ path, ...p })),
      });
      const meta = {
        path,
        name,
        type: getFileType(name),
        mimeType: options.mimeType || getMimeType(name),
        size: result.totalSize,
        created: Date.now(),
        modified: Date.now(),
        chunkCount: result.chunkCount,
        checksum: result.checksum,
        tags: [],
        metadata: options.metadata || {},
      };
      this.files.set(path, meta);
      this._indexPath(path);
      this._searchIndex.set(path, this._tokenize(path));
      await this._persistMeta(meta);
      this._stats.ingested++;
      this._stats.bytesIngested += result.totalSize;
      this._emitChange('ingest', { path, size: result.totalSize });
      return meta;
    });
  }

  async _writeStream(path, readable, options) {
    const { chunkSize, totalSize, onProgress } = options;
    const reader = readable.getReader();
    let buffer = new Uint8Array(0);
    let index = 0;
    let total = 0;
    const hashChunks = [];
    const useHash = options.hash !== false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.byteLength) continue;
      if (useHash) hashChunks.push(value);
      total += value.byteLength;
      const combined = new Uint8Array(buffer.byteLength + value.byteLength);
      combined.set(buffer);
      combined.set(value, buffer.byteLength);
      buffer = combined;
      while (buffer.byteLength >= chunkSize) {
        const slice = buffer.slice(0, chunkSize);
        await this.chunkStore.writeChunk(path, index, slice, { compress: true });
        index++;
        buffer = buffer.slice(chunkSize);
        if (onProgress) {
          onProgress({
            loaded: total,
            chunkIndex: index,
            progress: totalSize ? total / totalSize : 0,
          });
        }
      }
    }
    if (buffer.byteLength > 0) {
      await this.chunkStore.writeChunk(path, index, buffer, { compress: true });
      index++;
      if (onProgress && totalSize) onProgress({ loaded: total, chunkIndex: index, progress: 1 });
    }

    let checksum = null;
    if (useHash) {
      checksum = await this._hashChunks(hashChunks);
    }

    await this.chunkStore.writeMeta(path, {
      path,
      chunkCount: index,
      totalSize: total,
      checksum,
      created: Date.now(),
    });

    return { chunkCount: index, totalSize: total, checksum };
  }

  async _hashChunks(chunks) {
    let total = 0;
    for (const c of chunks) total += c.byteLength;
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c, offset);
      offset += c.byteLength;
    }
    const hash = await crypto.subtle.digest('SHA-256', combined.buffer);
    const arr = new Uint8Array(hash);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
    return s;
  }

  async addFile(path, blob, type) {
    return this._enqueue(async () => {
      path = this._normalizePath(path);
      const name = path.split('/').pop();
      const meta = {
        path,
        name,
        type: type || getFileType(name),
        mimeType: blob.type || getMimeType(name),
        size: blob.size,
        created: Date.now(),
        modified: Date.now(),
        chunkCount: 0,
        checksum: null,
        tags: [],
        metadata: {},
      };
      if (blob.size === 0) {
        this.files.set(path, meta);
        this._indexPath(path);
        await this._persistMeta(meta);
        this._emitChange('add', { path });
        return meta;
      }
      const result = await this._writeStream(path, blob.stream(), {
        totalSize: blob.size,
        chunkSize: this.chunkSize,
      });
      meta.chunkCount = result.chunkCount;
      meta.checksum = result.checksum;
      this.files.set(path, meta);
      this._indexPath(path);
      this._searchIndex.set(path, this._tokenize(path));
      await this._persistMeta(meta);

      try {
        this._setBlobCache(path, blob);
      } catch (e) {}

      this._emitChange('add', { path });
      return meta;
    });
  }

  async getFile(path, options = {}) {
    const normalized = this._normalizePath(path);
    const meta = this.files.get(normalized);
    if (!meta) return null;
    if (options.metaOnly) return { ...meta };

    if (this._blobCache.has(normalized)) {
      this._stats.blobCacheHits++;
      const cached = this._blobCache.get(normalized);
      this._blobCache.delete(normalized);
      this._blobCache.set(normalized, cached);
      return { ...meta, blob: cached };
    }

    this._stats.blobCacheMisses++;

    let blob;
    try {
      if (!meta.chunkCount) {
        blob = new Blob([], { type: meta.mimeType || 'application/octet-stream' });
      } else {
        const parts = [];
        for await (const { data } of this.chunkStore.iterateChunks(normalized, meta.chunkCount)) {
          parts.push(data);
        }
        blob = new Blob(parts, { type: meta.mimeType || 'application/octet-stream' });
      }
    } catch (err) {
      console.error('[VFS] getFile materialization failed for', normalized, err);
      return { ...meta, blob: new Blob([], { type: meta.mimeType || 'application/octet-stream' }) };
    }

    this._setBlobCache(normalized, blob);
    return { ...meta, blob };
  }

  getFileMeta(path) {
    const normalized = this._normalizePath(path);
    const meta = this.files.get(normalized);
    return meta ? { ...meta } : null;
  }

  _setBlobCache(path, blob) {
    if (!blob || typeof blob.size !== 'number') return;
    if (blob.size > this._maxBlobCacheBytes) return;
    const existing = this._blobCache.get(path);
    if (existing) {
      this._blobCacheBytes -= existing.size;
      this._blobCache.delete(path);
    }
    this._blobCache.set(path, blob);
    this._blobCacheBytes += blob.size;
    while (this._blobCacheBytes > this._maxBlobCacheBytes && this._blobCache.size > 1) {
      const firstKey = this._blobCache.keys().next().value;
      if (firstKey === path) break;
      const first = this._blobCache.get(firstKey);
      this._blobCache.delete(firstKey);
      this._blobCacheBytes -= first.size;
      this._stats.blobCacheEvictions++;
    }
  }

  _invalidateBlobCache(path) {
    const existing = this._blobCache.get(path);
    if (existing) {
      this._blobCacheBytes -= existing.size;
      this._blobCache.delete(path);
    }
  }

  clearBlobCache() {
    this._blobCache.clear();
    this._blobCacheBytes = 0;
  }

  getBlobCacheStats() {
    return {
      entries: this._blobCache.size,
      bytes: this._blobCacheBytes,
      maxBytes: this._maxBlobCacheBytes,
    };
  }

  async exists(path) {
    path = this._normalizePath(path);
    return this.files.has(path) || this.folders.has(path);
  }

  isFile(path) {
    return this.files.has(this._normalizePath(path));
  }

  isFolder(path) {
    return this.folders.has(this._normalizePath(path));
  }

  async readFile(path) {
    return this.readAsBlob(path);
  }

  async readAsBlob(path) {
    path = this._normalizePath(path);
    const file = this.files.get(path);
    if (!file) return null;

    if (this._blobCache.has(path)) {
      this._stats.blobCacheHits++;
      const cached = this._blobCache.get(path);
      this._blobCache.delete(path);
      this._blobCache.set(path, cached);
      return cached;
    }

    this._stats.blobCacheMisses++;
    this._stats.reads++;
    const parts = [];
    if (file.chunkCount) {
      for await (const { data } of this.chunkStore.iterateChunks(path, file.chunkCount)) {
        parts.push(data);
      }
    }
    this._stats.bytesRead += file.size;
    const blob = new Blob(parts, { type: file.mimeType || 'application/octet-stream' });
    this._setBlobCache(path, blob);
    return blob;
  }

  async readRange(path, start, end) {
    path = this._normalizePath(path);
    const file = this.files.get(path);
    if (!file) return null;
    this._stats.reads++;
    const data = await this.chunkStore.readRange(path, start, end);
    this._stats.bytesRead += data.byteLength;
    return new Blob([data], { type: file.mimeType });
  }

  async readAsArrayBuffer(path) {
    const blob = await this.readAsBlob(path);
    return blob ? blob.arrayBuffer() : null;
  }

  async readAsText(path, encoding = 'utf-8') {
    const blob = await this.readAsBlob(path);
    return blob ? blob.text() : null;
  }

  async readAsDataURL(path) {
    const blob = await this.readAsBlob(path);
    if (!blob) return null;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async readAsStream(path) {
    path = this._normalizePath(path);
    const file = this.files.get(path);
    if (!file) return null;
    if (file.chunkCount) return this.chunkStore.readAsStream(path);
    return new Blob([], { type: file.mimeType }).stream();
  }

  async *readChunkIterator(path) {
    const file = this.files.get(this._normalizePath(path));
    if (!file || !file.chunkCount) return;
    for await (const { index, data } of this.chunkStore.iterateChunks(path, file.chunkCount)) {
      yield { index, data };
    }
  }

  async updateFile(path, blob) {
    path = this._normalizePath(path);
    const existing = this.files.get(path);
    if (!existing) return null;
    this._invalidateBlobCache(path);
    await this.chunkStore.deleteAllChunks(path);
    const result = await this._writeStream(path, blob.stream(), {
      totalSize: blob.size,
      chunkSize: this.chunkSize,
    });
    existing.chunkCount = result.chunkCount;
    existing.checksum = result.checksum;
    existing.size = result.totalSize;
    existing.modified = Date.now();
    existing.mimeType = blob.type || existing.mimeType;
    await this._persistMeta(existing);
    this._setBlobCache(path, blob);
    this._emitChange('update', { path });
    return existing;
  }

  async deleteFile(path) {
    path = this._normalizePath(path);
    if (!this.files.has(path)) return false;
    this.files.delete(path);
    this._searchIndex.delete(path);
    this._searchCacheDirty = true;
    this._invalidateBlobCache(path);
    await this.chunkStore.deleteFile(path);
    await this._deleteMeta(path);
    this._stats.deletes++;
    this._emitChange('delete', { path });
    return true;
  }

  async moveFile(oldPath, newPath) {
    oldPath = this._normalizePath(oldPath);
    newPath = this._normalizePath(newPath);
    if (oldPath === newPath) return false;
    const file = this.files.get(oldPath);
    if (!file) return false;
    if (this.files.has(newPath)) return false;

    const cachedBlob = this._blobCache.get(oldPath);
    if (cachedBlob) {
      this._blobCache.delete(oldPath);
      this._setBlobCache(newPath, cachedBlob);
    }

    const meta = await this.chunkStore.readMeta(oldPath);
    if (meta) {
      await this.chunkStore.writeMeta(newPath, { ...meta, path: newPath });
      await this.chunkStore.deleteMeta(oldPath);
    }
    const tx = this.db && this.db.transaction(this.metaStore, 'readwrite');
    if (tx) {
      const store = tx.objectStore(this.metaStore);
      store.delete(oldPath);
    }
    this.files.delete(oldPath);
    this._searchIndex.delete(oldPath);
    file.path = newPath;
    file.name = newPath.split('/').pop();
    file.modified = Date.now();
    this.files.set(newPath, file);
    this._indexPath(newPath);
    this._searchIndex.set(newPath, this._tokenize(newPath));
    await this._persistMeta(file);
    this._searchCacheDirty = true;
    this._stats.moves++;
    this._emitChange('move', { from: oldPath, to: newPath });
    return true;
  }

  async copyFile(sourcePath, destPath) {
    sourcePath = this._normalizePath(sourcePath);
    destPath = this._normalizePath(destPath);
    const src = this.files.get(sourcePath);
    if (!src) return null;
    const blob = await this.readAsBlob(sourcePath);
    return this.addFile(destPath, blob, src.type);
  }

  async createFolder(path) {
    path = this._normalizePath(path);
    if (this.folders.has(path)) return false;
    this.folders.add(path);
    await this._persistFolder(path);
    this._emitChange('folder-create', { path });
    return true;
  }

  async deleteFolder(path) {
    path = this._normalizePath(path);
    if (path === '/') return false;
    if (!this.folders.has(path)) return false;
    const prefix = path + '/';
    const toDelete = [];
    for (const p of this.files.keys()) {
      if (p.startsWith(prefix)) toDelete.push(p);
    }
    for (const p of toDelete) await this.deleteFile(p);
    this.folders.delete(path);
    await this._deleteMeta(path);
    this._emitChange('folder-delete', { path });
    return true;
  }

  async _persistFolder(path) {
    if (!this.persistence) return;
    await this._openMetaDB();
    const tx = this.db.transaction(this.metaStore, 'readwrite');
    tx.objectStore(this.metaStore).put({ path, isFolder: true, created: Date.now() });
  }

  async _persistMeta(meta) {
    if (!this.persistence) return;
    await this._openMetaDB();
    const { blob, ...clean } = meta;
    const tx = this.db.transaction(this.metaStore, 'readwrite');
    tx.objectStore(this.metaStore).put({ ...clean });
  }

  async _deleteMeta(path) {
    if (!this.persistence) return;
    await this._openMetaDB();
    const tx = this.db.transaction(this.metaStore, 'readwrite');
    tx.objectStore(this.metaStore).delete(path);
  }

  listFolder(folderPath = '/') {
    folderPath = this._normalizePath(folderPath);
    const base = folderPath === '/' ? '/' : folderPath + '/';
    const items = [];
    const seen = new Set();
    for (const [path, file] of this.files) {
      if (!path.startsWith(base) || path === base) continue;
      const rel = path.slice(base.length);
      if (!rel.includes('/')) {
        const { blob, ...meta } = file;
        items.push({ kind: 'file', ...meta });
        seen.add(path);
      } else {
        const folderName = rel.split('/')[0];
        const folderPath2 = base + folderName;
        if (!seen.has(folderPath2)) {
          items.push({ kind: 'folder', name: folderName, path: folderPath2 });
          seen.add(folderPath2);
        }
      }
    }
    for (const f of this.folders) {
      if (!f.startsWith(base) || f === base) continue;
      const rel = f.slice(base.length);
      if (!rel.includes('/') && !seen.has(f)) {
        items.push({ kind: 'folder', name: rel, path: f });
        seen.add(f);
      }
    }
    items.sort((a, b) => {
      if (a.kind === 'folder' && b.kind !== 'folder') return -1;
      if (a.kind !== 'folder' && b.kind === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });
    return items;
  }

  listAllFiles() {
    return Array.from(this.files.values()).map(({ blob, ...meta }) => meta);
  }

  listAllFolders() {
    return Array.from(this.folders);
  }

  getAllFiles() {
    return this.listAllFiles();
  }

  getTotalSize() {
    let total = 0;
    for (const f of this.files.values()) total += f.size || 0;
    return total;
  }

  getStats() {
    const byType = {};
    for (const f of this.files.values()) {
      byType[f.type] = (byType[f.type] || 0) + 1;
    }
    return {
      fileCount: this.files.size,
      folderCount: this.folders.size,
      totalSize: this.getTotalSize(),
      byType,
      ...this._stats,
      chunkStore: this.chunkStore.getStats(),
      blobCache: this.getBlobCacheStats(),
    };
  }

  search(query, options = {}) {
    if (!query) return [];
    const lower = query.toLowerCase();
    const limit = options.limit || 500;
    const results = [];
    for (const [path, file] of this.files) {
      if (results.length >= limit) break;
      const name = file.name.toLowerCase();
      const p = path.toLowerCase();
      if (name.includes(lower) || p.includes(lower)) {
        const { blob, ...meta } = file;
        results.push(this._withScore(meta, name === lower ? 100 : p.includes(lower) ? 60 : 40));
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }

  searchRegex(pattern, flags = 'i') {
    try {
      const re = new RegExp(pattern, flags);
      const results = [];
      for (const [path, file] of this.files) {
        if (re.test(file.name) || re.test(path)) {
          const { blob, ...meta } = file;
          results.push(meta);
        }
      }
      return results;
    } catch { return []; }
  }

  searchByType(type) {
    const results = [];
    for (const file of this.files.values()) {
      if (file.type === type) {
        const { blob, ...meta } = file;
        results.push(meta);
      }
    }
    return results;
  }

  searchByTag(tag) {
    const paths = this.tags.get(tag);
    if (!paths) return [];
    return Array.from(paths).map(p => {
      const f = this.files.get(p);
      if (!f) return null;
      const { blob, ...meta } = f;
      return meta;
    }).filter(Boolean);
  }

  addTag(path, tag) {
    path = this._normalizePath(path);
    if (!this.files.has(path)) return false;
    if (!this.tags.has(tag)) this.tags.set(tag, new Set());
    this.tags.get(tag).add(path);
    const file = this.files.get(path);
    if (file && !file.tags.includes(tag)) file.tags.push(tag);
    this._emitChange('tag-add', { path, tag });
    return true;
  }

  removeTag(path, tag) {
    path = this._normalizePath(path);
    const set = this.tags.get(tag);
    if (set) set.delete(path);
    const file = this.files.get(path);
    if (file) file.tags = file.tags.filter(t => t !== tag);
    this._emitChange('tag-remove', { path, tag });
    return true;
  }

  listTags() {
    const out = {};
    for (const [tag, paths] of this.tags) out[tag] = paths.size;
    return out;
  }

  async calculateChecksum(path) {
    path = this._normalizePath(path);
    const file = this.files.get(path);
    if (!file) return null;
    if (file.checksum) return file.checksum;
    const blob = await this.readAsBlob(path);
    const buffer = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    const arr = new Uint8Array(hash);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
    file.checksum = s;
    await this._persistMeta(file);
    return s;
  }

  async verifyFile(path) {
    path = this._normalizePath(path);
    const file = this.files.get(path);
    if (!file) return { ok: false, reason: 'missing' };
    return this.chunkStore.verifyFile(path, file.chunkCount);
  }

  serialize() {
    const files = [];
    for (const f of this.files.values()) {
      files.push({
        path: f.path, name: f.name, type: f.type, mimeType: f.mimeType,
        size: f.size, created: f.created, modified: f.modified,
        chunkCount: f.chunkCount, checksum: f.checksum, tags: [...(f.tags || [])],
      });
    }
    return { files, folders: Array.from(this.folders), tags: this.listTags() };
  }

  async exportWorkspace() {
    const bundles = [];
    for (const path of this.files.keys()) {
      const file = this.files.get(path);
      const bundle = await this.chunkStore.exportPath(path, file.chunkCount);
      bundles.push(bundle);
    }
    return { version: 1, bundles, meta: this.serialize() };
  }

  async importWorkspace(data) {
    if (!data || !data.bundles) return false;
    for (const bundle of data.bundles) {
      await this.chunkStore.importPath(bundle);
      const meta = await this.chunkStore.readMeta(bundle.path);
      if (meta) {
        const name = bundle.path.split('/').pop();
        const file = {
          path: bundle.path, name, type: getFileType(name),
          mimeType: getMimeType(name), size: meta.totalSize,
          created: meta.created || Date.now(), modified: Date.now(),
          chunkCount: meta.chunkCount, checksum: meta.checksum, tags: [],
        };
        this.files.set(bundle.path, file);
        this._indexPath(bundle.path);
      }
    }
    await this.saveToDB();
    this._emitChange('import-workspace', { count: data.bundles.length });
    return true;
  }

  async clear() {
    this.files.clear();
    this.folders = new Set(['/']);
    this.tags.clear();
    this._searchIndex.clear();
    this._searchCacheDirty = true;
    this.clearBlobCache();
    await this.chunkStore.clearAll();
    if (this.persistence) {
      await this._openMetaDB();
      const tx = this.db.transaction(this.metaStore, 'readwrite');
      tx.objectStore(this.metaStore).clear();
    }
    this._emitChange('clear', {});
  }

  async destroy() {
    await this.saveToDB();
    await this.chunkStore.close();
    if (this.db) { this.db.close(); this.db = null; }
    this.clearBlobCache();
    this.ready = false;
  }

  _normalizePath(path) {
    if (!path) return '/';
    let p = path.replace(/\\/g, '/').trim();
    if (!p.startsWith('/')) p = '/' + p;
    p = p.replace(/\/+/g, '/');
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
  }

  _indexPath(path) {
    const parts = path.split('/');
    let cur = '';
    for (let i = 0; i < parts.length - 1; i++) {
      cur += (cur ? '/' : '') + parts[i];
      if (cur) this.folders.add(cur);
    }
    this.folders.add('/');
  }

  _tokenize(str) {
    const tokens = new Set();
    const lower = str.toLowerCase();
    const parts = lower.split(/[\/\.\-_\s]+/);
    for (const p of parts) {
      if (!p) continue;
      if (tokens.size >= SEARCH_TOKEN_LIMIT) break;
      tokens.add(p);
      for (let i = 3; i <= Math.min(p.length, 8); i++) {
        tokens.add(p.slice(0, i));
      }
    }
    return tokens;
  }

  _withScore(file, score) {
    return { ...file, score };
  }

  _enqueue(fn) {
    const next = this._opQueue.then(fn, fn);
    this._opQueue = next.catch(() => {});
    return next;
  }

  onChange(fn) {
    this._changeListeners.add(fn);
    return () => this._changeListeners.delete(fn);
  }

  onProgress(fn) {
    this._progressListeners.add(fn);
    return () => this._progressListeners.delete(fn);
  }

  _emitChange(type, payload) {
    for (const fn of this._changeListeners) {
      try { fn({ type, ...payload, ts: Date.now() }); } catch (e) {}
    }
  }

  _emitProgress(payload) {
    for (const fn of this._progressListeners) {
      try { fn(payload); } catch (e) {}
    }
  }
}

export const FileTypes = {
  IMAGE: 'IMAGE', VIDEO: 'VIDEO', AUDIO: 'AUDIO', TEXT: 'TEXT',
  MODEL: 'MODEL', PDF: 'PDF', ARCHIVE: 'ARCHIVE', BINARY: 'BINARY',
};
