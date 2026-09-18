const URL_TIMEOUT = 60000;
const MAX_URL_SIZE = 2 * 1024 * 1024 * 1024;

export class ImportService {
  constructor(options = {}) {
    this.vfs = options.vfs;
    this.eventBus = options.eventBus;
    this.fileService = options.fileService;
    this.maxUrlSize = options.maxUrlSize || MAX_URL_SIZE;
    this.urlTimeout = options.urlTimeout || URL_TIMEOUT;
  }

  setVFS(vfs) { this.vfs = vfs; }
  setEventBus(bus) { this.eventBus = bus; }

  async importFiles(fileList, basePath = '/') {
    if (!this.vfs) throw new Error('VFS not available');
    const files = Array.from(fileList);
    const results = [];
    for (const file of files) {
      try {
        if (file.__kind === 'directory' && file.children) {
          const folderPath = basePath === '/' ? '/' + file.name : basePath + '/' + file.name;
          await this.vfs.createFolder(folderPath);
          const subResults = await this.importDirectoryTree(file, folderPath);
          results.push(...subResults);
        } else {
          const path = basePath === '/' ? '/' + file.name : basePath + '/' + file.name;
          const meta = await this.vfs.ingest(file, path);
          results.push({ path, success: true, meta });
        }
      } catch (err) {
        results.push({ path: file.name, success: false, error: err.message });
      }
    }
    this._notifyChange('import-complete', { count: results.length });
    return results;
  }

  async importDirectoryTree(dir, basePath) {
    const results = [];
    for (const child of dir.children || []) {
      if (child.__kind === 'directory') {
        const folderPath = basePath + '/' + child.name;
        await this.vfs.createFolder(folderPath);
        const sub = await this.importDirectoryTree(child, folderPath);
        results.push(...sub);
      } else {
        try {
          const path = basePath + '/' + child.name;
          await this.vfs.ingest(child, path);
          results.push({ path, success: true });
        } catch (err) {
          results.push({ path: child.name, success: false, error: err.message });
        }
      }
    }
    return results;
  }

  async importFromURL(url, options = {}) {
    const { path, onProgress, filename } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.urlTimeout);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > this.maxUrlSize) {
        throw new Error(`File too large: ${this._formatBytes(contentLength)}`);
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const finalFilename = filename || this._filenameFromURL(url) || 'download';

      let blob;
      if (onProgress && response.body && contentLength > 0) {
        const reader = response.body.getReader();
        const chunks = [];
        let loaded = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          onProgress({ loaded, total: contentLength, progress: loaded / contentLength });
        }
        blob = new Blob(chunks, { type: contentType });
      } else {
        blob = await response.blob();
      }

      const targetPath = path || '/' + finalFilename;
      await this.vfs.addFile(targetPath, blob);
      this._notifyChange('url-import', { url, path: targetPath });
      return { success: true, path: targetPath, size: blob.size, blob };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error('Import timed out');
      throw err;
    }
  }

  async importFromURLs(urls, options = {}) {
    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const result = await this.importFromURL(url, {
          onProgress: options.onProgress
            ? (p) => options.onProgress({ url, index: i, total: urls.length, ...p })
            : undefined,
        });
        results.push(result);
      } catch (err) {
        results.push({ success: false, url, error: err.message });
      }
    }
    return results;
  }

  async importFromClipboard() {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    const items = await navigator.clipboard.read();
    const results = [];
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/') || type.startsWith('text/') || type === 'application/pdf') {
          const blob = await item.getType(type);
          const ext = type.split('/')[1].split(';')[0];
          const filename = `clipboard_${Date.now()}.${ext}`;
          const path = '/' + filename;
          await this.vfs.addFile(path, blob);
          results.push({ path, blob, type });
        }
      }
    }
    if (results.length) this._notifyChange('clipboard-import', { count: results.length });
    return results;
  }

  importFromDataTransfer(dataTransfer) {
    const files = [];
    if (dataTransfer.items) {
      for (const item of dataTransfer.items) {
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry?.();
          if (entry) {
            files.push(entry);
          } else {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
      }
    } else if (dataTransfer.files) {
      for (const file of dataTransfer.files) files.push(file);
    }
    return files;
  }

  async readEntriesRecursive(entry, path = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => {
        entry.file(resolve, reject);
      });
      return [{ ...file, __relativePath: path + '/' + file.name, __kind: 'file' }];
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const allEntries = await this._readAllEntries(reader);
      const results = [];
      for (const child of allEntries) {
        const sub = await this.readEntriesRecursive(child, path + '/' + entry.name);
        results.push(...sub);
      }
      return [{
        __kind: 'directory',
        name: entry.name,
        children: results.map(r => r.__kind === 'file' ? r : r),
        path: path + '/' + entry.name,
      }, ...results];
    }
    return [];
  }

  async readDirectoryTree(entry, basePath = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      return file;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await this._readAllEntries(reader);
      const children = [];
      for (const child of entries) {
        const result = await this.readDirectoryTree(child, basePath + '/' + entry.name);
        if (result) children.push(result);
      }
      return {
        __kind: 'directory',
        name: entry.name,
        path: basePath + '/' + entry.name,
        children,
      };
    }
    return null;
  }

  _readAllEntries(reader) {
    return new Promise((resolve) => {
      const all = [];
      const readBatch = () => {
        reader.readEntries((batch) => {
          if (!batch.length) {
            resolve(all);
          } else {
            all.push(...batch);
            readBatch();
          }
        }, () => resolve(all));
      };
      readBatch();
    });
  }

  async captureFromCamera(options = {}) {
    const { video = true, audio = false, filename } = options;
    const constraints = {
      video: video ? { facingMode: options.facingMode || 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } : false,
      audio,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const chunks = [];
    const mimeType = this._pickMimeType(video, audio);
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    return new Promise((resolve, reject) => {
      const stop = () => {
        for (const track of stream.getTracks()) track.stop();
        recorder.stop();
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const name = filename || `capture_${Date.now()}.${ext}`;
        const path = '/' + name;
        try {
          await this.vfs.addFile(path, blob);
          this._notifyChange('camera-capture', { path });
          resolve({ path, blob, name });
        } catch (e) { reject(e); }
      };
      recorder.onerror = reject;
      options.onReady?.({ stream, stop, recorder });
      recorder.start();
    });
  }

  capturePhoto() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';
      input.onchange = (e) => {
        const file = e.target.files?.[0];
        if (file) resolve(file);
        else reject(new Error('No photo captured'));
      };
      input.click();
    });
  }

  _pickMimeType(video, audio) {
    const candidates = video
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return video ? 'video/webm' : 'audio/webm';
  }

  async importFromFetch(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return { blob, filename: this._filenameFromURL(url) };
  }

  async importTorrentPlaceholder(magnetURI) {
    throw new Error('Torrent import not implemented');
  }

  async importPaste() {
    const clipboardItems = await navigator.clipboard.read();
    const results = [];
    for (const item of clipboardItems) {
      if (item.types.includes('image/png')) {
        const blob = await item.getType('image/png');
        const path = `/pasted_${Date.now()}.png`;
        await this.vfs.addFile(path, blob, 'IMAGE');
        results.push({ path, blob });
      } else if (item.types.includes('text/plain')) {
        const blob = await item.getType('text/plain');
        const text = await blob.text();
        const path = `/pasted_${Date.now()}.txt`;
        await this.vfs.addFile(path, new Blob([text], { type: 'text/plain' }), 'TEXT');
        results.push({ path, blob: new Blob([text]) });
      }
    }
    return results;
  }

  _filenameFromURL(url) {
    try {
      const u = new URL(url);
      const path = u.pathname;
      const last = path.split('/').filter(Boolean).pop();
      return last ? decodeURIComponent(last) : 'download';
    } catch {
      return 'download';
    }
  }

  _notifyChange(type, payload) {
    if (this.eventBus) {
      this.eventBus.emit('import:' + type, payload);
    }
  }

  _formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

export const importService = new ImportService();
