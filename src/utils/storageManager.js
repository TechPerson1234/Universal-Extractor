export class StorageManager {
  constructor(options = {}) {
    this.vfs = options.vfs || null;
    this.chunkStore = options.chunkStore || null;
    this.indexedDBService = options.indexedDBService || null;
    this.eventBus = options.eventBus || null;
    this.settingsStore = options.settingsStore || null;
    this._listeners = new Set();
  }

  setVFS(vfs) {
    this.vfs = vfs;
    if (vfs && vfs.chunkStore) this.chunkStore = vfs.chunkStore;
  }

  setChunkStore(cs) {
    this.chunkStore = cs;
  }

  setIndexedDBService(idb) {
    this.indexedDBService = idb;
  }

  setEventBus(bus) {
    this.eventBus = bus;
  }

  setSettingsStore(ss) {
    this.settingsStore = ss;
  }

  async getUsage() {
    const out = {
      estimate: { usage: 0, quota: 0, percent: 0, available: 0 },
      stores: {},
      totalFiles: 0,
      totalBytes: 0,
      chunkCache: { entries: 0, bytes: 0, maxBytes: 0 },
      blobCache: { entries: 0, bytes: 0, maxBytes: 0 },
      persisted: false,
    };

    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        out.estimate = {
          usage: est.usage || 0,
          quota: est.quota || 0,
          percent: est.quota ? (est.usage / est.quota) * 100 : 0,
          available: Math.max(0, (est.quota || 0) - (est.usage || 0)),
        };
      }
      if (navigator.storage && navigator.storage.persisted) {
        out.persisted = await navigator.storage.persisted();
      }
    } catch (e) {
      console.warn('[StorageManager] estimate failed', e);
    }

    if (this.vfs) {
      try {
        const stats = this.vfs.getStats();
        out.totalFiles = stats.fileCount || 0;
        out.totalBytes = stats.totalSize || 0;
        if (stats.blobCache) out.blobCache = stats.blobCache;
        if (stats.chunkStore && stats.chunkStore.cache) {
          out.chunkCache = stats.chunkStore.cache;
        }
      } catch (e) {
        console.warn('[StorageManager] vfs stats failed', e);
      }
    }

    if (this.indexedDBService) {
      try {
        const storeStats = await this.indexedDBService.getStoreStats();
        for (const [name, info] of Object.entries(storeStats)) {
          out.stores[name] = info;
        }
      } catch (e) {
        console.warn('[StorageManager] idb stats failed', e);
      }
    }

    return out;
  }

  async clearFiles(options = {}) {
    const {
      includeFolders = true,
      includeChunks = true,
      includeBlobCache = true,
    } = options;

    const result = { files: 0, folders: 0, chunks: 0, bytes: 0 };

    if (!this.vfs) return result;

    try {
      const stats = this.vfs.getStats();
      result.files = stats.fileCount || 0;
      result.folders = stats.folderCount || 0;
      result.bytes = stats.totalSize || 0;
    } catch (e) {
      console.warn('[StorageManager] pre-clear stats failed', e);
    }

    const totalChunks = this.chunkStore
      ? await this.chunkStore.countChunks().catch(() => 0)
      : 0;
    result.chunks = totalChunks;

    this._emit('clear-start', { scope: 'files', total: result.files });

    try {
      if (includeFolders) {
        await this.vfs.clear();
      } else {
        const files = this.vfs.listAllFiles();
        for (const f of files) {
          await this.vfs.deleteFile(f.path);
        }
      }

      if (includeChunks && this.chunkStore) {
        await this.chunkStore.clearAll();
      }

      if (includeBlobCache && this.vfs && typeof this.vfs.clearBlobCache === 'function') {
        this.vfs.clearBlobCache();
      }
    } catch (err) {
      this._emit('clear-error', { error: err });
      throw err;
    }

    this._emit('clear-complete', result);
    return result;
  }

  async clearEverything() {
    const result = {
      files: 0,
      folders: 0,
      chunks: 0,
      settings: false,
      caches: 0,
      idb: false,
    };

    try {
      const cleared = await this.clearFiles();
      result.files = cleared.files;
      result.folders = cleared.folders;
      result.chunks = cleared.chunks;
    } catch (err) {
      console.warn('[StorageManager] clearFiles failed', err);
    }

    if (this.settingsStore && typeof this.settingsStore.clearStorage === 'function') {
      try {
        this.settingsStore.clearStorage();
        result.settings = true;
      } catch (err) {
        console.warn('[StorageManager] settings clear failed', err);
      }
    }

    try {
      localStorage.removeItem('nexus-settings-v5');
      localStorage.removeItem('nexus-settings');
      localStorage.removeItem('nexus-shortcuts-v5');
      localStorage.removeItem('nexus-shortcuts');
      localStorage.removeItem('nexus-tabs-v5');
      localStorage.removeItem('nexus-tabs');
      localStorage.removeItem('nexus-session-v5');
      localStorage.removeItem('nexus-session');
      localStorage.removeItem('nexus-history');
      localStorage.removeItem('nexus-theme');
      localStorage.removeItem('nexus-search-history');
      localStorage.removeItem('nexus-install-state');
    } catch (e) {
      console.warn('[StorageManager] localStorage clear failed', e);
    }

    if ('caches' in window) {
      try {
        const names = await caches.keys();
        for (const name of names) {
          const deleted = await caches.delete(name);
          if (deleted) result.caches++;
        }
      } catch (e) {
        console.warn('[StorageManager] cache clear failed', e);
      }
    }

    if (this.indexedDBService) {
      try {
        await this.indexedDBService.clearAll();
        result.idb = true;
      } catch (err) {
        console.warn('[StorageManager] IDB clear failed', err);
      }
    }

    this._emit('clear-complete', result);
    return result;
  }

  async rebuildIndexes() {
    if (!this.vfs) return { rebuilt: false, count: 0 };
    this._emit('rebuild-start', {});
    try {
      this.vfs.folders = new Set(['/']);
      this.vfs._searchIndex = new Map();
      for (const [path] of this.vfs.files) {
        this.vfs._indexPath(path);
        this.vfs._searchIndex.set(path, this.vfs._tokenize(path));
      }
      if (typeof this.vfs.saveToDB === 'function') {
        await this.vfs.saveToDB();
      }
      const count = this.vfs.files.size;
      this._emit('rebuild-complete', { count });
      return { rebuilt: true, count };
    } catch (err) {
      this._emit('rebuild-error', { error: err });
      throw err;
    }
  }

  async requestPersistent() {
    if (navigator.storage && navigator.storage.persist) {
      try {
        const granted = await navigator.storage.persist();
        this._emit('persist-request', { granted });
        return granted;
      } catch {
        return false;
      }
    }
    return false;
  }

  async estimatePerType() {
    if (!this.vfs) return {};
    const out = {};
    try {
      for (const file of this.vfs.files.values()) {
        const t = file.type || 'BINARY';
        if (!out[t]) out[t] = { count: 0, bytes: 0 };
        out[t].count++;
        out[t].bytes += file.size || 0;
      }
    } catch (e) {
      console.warn('[StorageManager] per-type estimate failed', e);
    }
    return out;
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(type, data) {
    for (const fn of this._listeners) {
      try {
        fn({ type, data, ts: Date.now() });
      } catch (e) {
        console.warn('[StorageManager] listener error', e);
      }
    }
  }
}

export const storageManager = new StorageManager();
