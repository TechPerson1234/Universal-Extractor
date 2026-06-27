// =============================================================================
// src/core/VFS.js (CORRECTED)
// =============================================================================
// Virtual File System with IndexedDB persistence, file/folder operations,
// search, and metadata management.
// =============================================================================

// Helper to get file type from name
function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return 'BINARY';
  if (['png','jpg','jpeg','webp','gif','bmp','svg'].includes(ext)) return 'IMAGE';
  if (['mp4','webm','mov','avi','mkv'].includes(ext)) return 'VIDEO';
  if (['mp3','wav','ogg','flac','aac'].includes(ext)) return 'AUDIO';
  if (['txt','json','md','js','html','css','xml','yaml','yml','c','cpp','java','py','rb','go','rs','swift'].includes(ext)) return 'TEXT';
  if (['obj','stl','gltf','glb'].includes(ext)) return 'MODEL';
  if (['pdf'].includes(ext)) return 'PDF';
  if (['zip','apk','jar','rar','7z','tar','gz'].includes(ext)) return 'ARCHIVE';
  return 'BINARY';
}

export class VFS {
  constructor(options = {}) {
    this.persistence = options.persistence !== false;
    this.dbName = options.dbName || 'NexusVFS';
    this.storeName = 'files';
    this.db = null;
    this.files = new Map(); // path -> file object { name, blob, type, size, created, modified, path, metadata }
    this.folders = new Set(['/']);
    this.initialized = false;
    this._changeListeners = [];
  }

  // ---------------------------------------------------------------------------
  // IndexedDB setup
  // ---------------------------------------------------------------------------
  async _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'path' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async loadFromDB() {
    if (!this.persistence) return;
    try {
      this.db = await this._openDB();
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const all = await new Promise((resolve, reject) => {
        const result = [];
        const cursor = store.openCursor();
        cursor.onsuccess = (e) => {
          const cur = e.target.result;
          if (cur) {
            result.push(cur.value);
            cur.continue();
          } else {
            resolve(result);
          }
        };
        cursor.onerror = () => reject(cursor.error);
      });
      // Reconstruct files
      for (const entry of all) {
        let blob = entry.blob;
        if (entry.blob && entry.blob instanceof ArrayBuffer) {
          blob = new Blob([entry.blob], { type: entry.mimeType || 'application/octet-stream' });
        }
        const file = {
          name: entry.name,
          blob: blob,
          type: entry.type || getFileType(entry.name),
          size: entry.size || blob.size,
          created: entry.created || Date.now(),
          modified: entry.modified || Date.now(),
          path: entry.path,
          metadata: entry.metadata || {},
        };
        this.files.set(entry.path, file);
        // Add folders
        const parts = entry.path.split('/');
        let current = '';
        for (let i = 0; i < parts.length - 1; i++) {
          current += (current ? '/' : '') + parts[i];
          this.folders.add(current || '/');
        }
      }
      this.initialized = true;
    } catch (e) {
      console.warn('Failed to load VFS from IndexedDB:', e);
      this.files.clear();
      this.folders = new Set(['/']);
    }
  }

  async saveToDB() {
    if (!this.persistence || !this.db) return;
    try {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.clear();
      for (const [path, file] of this.files) {
        const entry = {
          path: path,
          name: file.name,
          blob: file.blob,
          type: file.type,
          size: file.size,
          created: file.created,
          modified: file.modified,
          mimeType: file.blob.type || 'application/octet-stream',
          metadata: file.metadata || {},
        };
        store.put(entry);
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
    } catch (e) {
      console.warn('Failed to save VFS to IndexedDB:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------
  addFile(path, blob, type) {
    const name = path.split('/').pop();
    const file = {
      name,
      blob,
      type: type || getFileType(name),
      size: blob.size,
      created: Date.now(),
      modified: Date.now(),
      path: path,
      metadata: {},
    };
    this.files.set(path, file);
    const parts = path.split('/');
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current += (current ? '/' : '') + parts[i];
      this.folders.add(current || '/');
    }
    this._emitChange();
    return file;
  }

  removeFile(path) {
    if (!this.files.has(path)) return false;
    this.files.delete(path);
    this._emitChange();
    return true;
  }

  moveFile(oldPath, newPath) {
    const file = this.files.get(oldPath);
    if (!file) return false;
    this.files.delete(oldPath);
    file.path = newPath;
    file.name = newPath.split('/').pop();
    this.files.set(newPath, file);
    this._emitChange();
    return true;
  }

  getFile(path) {
    return this.files.get(path) || null;
  }

  listFolder(folderPath = '/') {
    const contents = [];
    const base = folderPath === '/' ? '/' : folderPath + '/';
    for (const [path, file] of this.files) {
      if (path.startsWith(base) && path !== base) {
        const relative = path.substring(base.length);
        if (!relative.includes('/')) {
          contents.push({ type: 'file', ...file, path });
        } else {
          const folderName = relative.split('/')[0];
          const folderPath = base + folderName;
          if (!contents.some(c => c.type === 'folder' && c.path === folderPath)) {
            contents.push({ type: 'folder', name: folderName, path: folderPath });
          }
        }
      }
    }
    for (const folder of this.folders) {
      if (folder.startsWith(base) && folder !== base && !folder.includes('/', base.length + 1)) {
        const name = folder.substring(base.length);
        if (!contents.some(c => c.type === 'folder' && c.path === folder)) {
          contents.push({ type: 'folder', name, path: folder });
        }
      }
    }
    return contents;
  }

  createFolder(path) {
    if (!this.folders.has(path)) {
      this.folders.add(path);
      this._emitChange();
      return true;
    }
    return false;
  }

  search(query) {
    const lower = query.toLowerCase();
    const results = [];
    for (const [path, file] of this.files) {
      if (path.toLowerCase().includes(lower) || file.name.toLowerCase().includes(lower)) {
        results.push(file);
      }
    }
    return results;
  }

  getAllFiles() {
    return Array.from(this.files.values());
  }

  // ---------------------------------------------------------------------------
  // Serialization for state management
  // ---------------------------------------------------------------------------
  serialize() {
    const filesData = [];
    for (const [path, file] of this.files) {
      filesData.push({
        path,
        name: file.name,
        type: file.type,
        size: file.size,
        created: file.created,
        modified: file.modified,
        metadata: file.metadata || {},
      });
    }
    return {
      files: filesData,
      folders: Array.from(this.folders),
    };
  }

  /**
   * Deserialize (restore) from a state object.
   * For persistent mode, we reload from IndexedDB instead of trusting the in-memory blobs.
   * So this method will trigger a reload from DB.
   */
  deserialize(state) {
    // In persistent mode, we simply reload from IndexedDB.
    // In non-persistent mode, we would need to restore blobs from state, which is not supported.
    // For simplicity, we just call reloadFromDB().
    if (this.persistence) {
      this.reloadFromDB();
    } else {
      console.warn('Deserialize without persistence not fully implemented.');
    }
  }

  /**
   * Reload all file data from IndexedDB, discarding current in-memory state.
   * Used after undo/redo to restore a consistent state.
   */
  async reloadFromDB() {
    if (this.persistence) {
      this.files.clear();
      this.folders = new Set(['/']);
      await this.loadFromDB();
    } else {
      console.warn('Undo/redo not fully supported without persistence.');
    }
  }

  // ---------------------------------------------------------------------------
  // Ingestion (from File objects or ArrayBuffer)
  // ---------------------------------------------------------------------------
  async ingest(file, path) {
    if (!path) path = '/' + file.name;
    let blob = file;
    if (file instanceof File) {
      blob = file;
    } else if (file instanceof ArrayBuffer || file instanceof Uint8Array) {
      blob = new Blob([file]);
    } else if (file instanceof Blob) {
      // already blob
    } else {
      throw new Error('Unsupported file type for ingestion');
    }
    const type = getFileType(path.split('/').pop());
    this.addFile(path, blob, type);
    return this.getFile(path);
  }

  // ---------------------------------------------------------------------------
  // Internal change notification
  // ---------------------------------------------------------------------------
  _emitChange() {
    for (const fn of this._changeListeners) {
      try { fn(); } catch (e) {}
    }
  }

  onChange(callback) {
    this._changeListeners.push(callback);
    return () => {
      const idx = this._changeListeners.indexOf(callback);
      if (idx !== -1) this._changeListeners.splice(idx, 1);
    };
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  async destroy() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}