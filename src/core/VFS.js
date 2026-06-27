// =============================================================================
// src/core/VFS.js
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
        // Blob stored as ArrayBuffer? We'll store as blob directly using IndexedDB's blob support
        // but we need to convert back to Blob if stored as ArrayBuffer.
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
      // Clear existing
      store.clear();
      // Add all files
      for (const [path, file] of this.files) {
        // Store blob as blob (IndexedDB supports Blob directly)
        // But to be safe, we can store as ArrayBuffer if blob is not supported? Blob works.
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
    // Ensure parent folders exist
    const parts = path.split('/');
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current += (current ? '/' : '') + parts[i];
      this.folders.add(current || '/');
    }
    // Trigger event (if event bus available)
    this._emitChange();
    return file;
  }

  removeFile(path) {
    if (!this.files.has(path)) return false;
    this.files.delete(path);
    // Optionally clean up empty folders? Leave as is for now.
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
    // Ensure folderPath ends with / for consistency, except root
    const base = folderPath === '/' ? '/' : folderPath + '/';
    for (const [path, file] of this.files) {
      if (path.startsWith(base) && path !== base) {
        const relative = path.substring(base.length);
        if (!relative.includes('/')) {
          // Direct child file
          contents.push({ type: 'file', ...file, path });
        } else {
          // Child folder
          const folderName = relative.split('/')[0];
          const folderPath = base + folderName;
          if (!contents.some(c => c.type === 'folder' && c.path === folderPath)) {
            contents.push({ type: 'folder', name: folderName, path: folderPath });
          }
        }
      }
    }
    // Also include folders that exist but have no files yet (if in folders set)
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
    // Convert files to plain objects (without blob data) because blobs can't be JSON serialized.
    // We'll store only metadata and reference to blob? Better: store as array of file descriptors with blob as base64? Too heavy.
    // For undo/redo, we'll handle differently: we'll store the whole file objects? Not possible.
    // So for state snapshots, we'll store file paths and metadata, and assume blobs are in IndexedDB.
    // We'll just store the list of paths and metadata, and the actual blob data is fetched from DB on restore.
    // This is a design choice: we only store lightweight state.
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
        // We do not store blob here; we'll fetch from DB on restore.
      });
    }
    return {
      files: filesData,
      folders: Array.from(this.folders),
    };
  }

  deserialize(state) {
    // Restore files from metadata; actual blobs are in IndexedDB.
    // We need to reload from DB fully.
    // For undo/redo, we will reload from IndexedDB.
    // So this method will be used to restore the file list and folders, but blobs must be reloaded from DB.
    // Actually, for simplicity, we'll just re-initialize from DB entirely.
    // But to support undo/redo of file additions/deletions, we can use the serialized state to update VFS.
    // We'll implement a lighter version: we'll clear and then add files from state, but we need blobs.
    // Since blobs are stored in IndexedDB, we can fetch them by path.
    // So we'll iterate over state.files, and for each path, try to fetch blob from DB.
    // If not found, we'll create an empty blob (but that's not ideal).
    // Alternative: during undo/redo, we save the whole VFS state to IndexedDB as a snapshot? Too heavy.
    // For now, we'll implement a hybrid: during undo/redo, we will reload the entire VFS from IndexedDB.
    // That's simpler and works because IndexedDB is persistent.
    // So this deserialize will just update the in-memory map and folders, and then we'll need to ensure blobs are loaded.
    // We'll call a method to reload blobs from DB.
    // For simplicity, we'll just clear and reload from DB.
    // But we also want to handle non-persisted mode (in-memory only). In that case, blobs are in memory.
    // So we need two modes.
    // Given the complexity, we'll implement deserialize to assume blobs are in memory (for in-memory mode) and for persisted mode, we'll reload from DB.
    // We'll add a flag.
    // For now, we'll implement a simple version: if persistence is on, we ignore deserialize and just reload from DB.
    // If off, we expect blobs to be present in the state (we'll store them as base64? That's not feasible).
    // So we'll only support persistence on for undo/redo.
    // Thus we'll implement:
    // - serialize: returns metadata only
    // - deserialize: uses metadata to update file list, and will lazy-load blobs from DB when accessed.
    // So we'll store the file list as metadata, and when a file is requested, we fetch blob from DB.
    // This works because DB is persistent.
    // So we'll have a cache: files map stores file objects with blob only if loaded; otherwise null and we fetch on demand.
    // But for simplicity, we'll just reload everything from DB on deserialize.
    // Let's do: clear current files and folders, then reload from DB.
    // This is simple and works.
    // So deserialize will just trigger a reload from DB.
    // We'll call this method after undo/redo to refresh VFS.
    // Actually, we don't even need deserialize if we reload from DB.
    // But we need to update currentFolder, openTabs, etc., which are not in VFS.
    // We'll just keep VFS as a separate module, and the App will manage workspace state.
    // So for undo/redo, we'll store the entire workspace state (including VFS metadata) and restore by reloading from DB.
    // That means after undo/redo, we call VFS.reloadFromDB().
    // So we'll add a reloadFromDB method.
    // We'll keep deserialize for in-memory mode only (not implemented).
    // Let's implement reloadFromDB().
    // So we'll add:
    async reloadFromDB() {
      if (this.persistence) {
        this.files.clear();
        this.folders = new Set(['/']);
        await this.loadFromDB();
      } else {
        // In-memory, we can't reload; we'll need to store blobs in serialized state.
        // For now, we'll not support undo/redo in non-persistent mode.
        console.warn('Undo/redo not fully supported without persistence.');
      }
    }

    // We'll use the reloadFromDB method in App after undo/redo.
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
  // Internal
  // ---------------------------------------------------------------------------
  _emitChange() {
    // We can use a global event bus if injected, but we'll just use a custom event.
    // App will listen to this via event bus? We'll implement a simple observer pattern.
    if (this._changeListeners) {
      this._changeListeners.forEach(fn => fn());
    }
  }

  onChange(callback) {
    if (!this._changeListeners) this._changeListeners = [];
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