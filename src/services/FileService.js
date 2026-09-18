const MIME_MAP = {
  txt: 'text/plain', json: 'application/json', md: 'text/markdown',
  js: 'text/javascript', mjs: 'text/javascript', ts: 'text/typescript',
  jsx: 'text/javascript', tsx: 'text/typescript',
  html: 'text/html', htm: 'text/html', css: 'text/css', scss: 'text/x-scss',
  xml: 'application/xml', svg: 'image/svg+xml', yaml: 'text/yaml', yml: 'text/yaml',
  csv: 'text/csv', tsv: 'text/tab-separated-values', log: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', ico: 'image/x-icon',
  avif: 'image/avif', tiff: 'image/tiff', tif: 'image/tiff',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', opus: 'audio/opus',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska', m4v: 'video/x-m4v',
  mpg: 'video/mpeg', mpeg: 'video/mpeg', '3gp': 'video/3gpp',
  pdf: 'application/pdf',
  zip: 'application/zip', apk: 'application/vnd.android.package-archive',
  jar: 'application/java-archive', rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed', tar: 'application/x-tar',
  gz: 'application/gzip', tgz: 'application/gzip', bz2: 'application/x-bzip2',
  xz: 'application/x-xz',
  obj: 'text/plain', stl: 'application/sla', gltf: 'model/gltf+json',
  glb: 'model/gltf-binary', fbx: 'application/octet-stream',
  dae: 'model/vnd.collada+xml', ply: 'application/octet-stream',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  exe: 'application/x-msdownload', dll: 'application/x-msdownload',
  wasm: 'application/wasm',
};

const TEXT_EXTENSIONS = new Set([
  'txt', 'json', 'md', 'markdown', 'js', 'mjs', 'ts', 'jsx', 'tsx',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'xml', 'svg', 'yaml', 'yml',
  'csv', 'tsv', 'log', 'ini', 'conf', 'cfg', 'toml', 'env',
  'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'java', 'kt', 'scala', 'go', 'rs',
  'py', 'rb', 'php', 'pl', 'lua', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'swift', 'dart', 'r', 'sql', 'vue', 'svelte', 'astro',
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico', 'avif', 'tiff', 'tif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'mpg', 'mpeg', '3gp', 'flv', 'wmv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'opus', 'wma']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'apk', 'jar', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'war']);
const MODEL_EXTENSIONS = new Set(['obj', 'stl', 'gltf', 'glb', 'fbx', 'dae', 'ply', '3ds']);

const SNIFF_BYTES = 512;
const DEFAULT_CHUNK_SIZE = 1024 * 1024;

export class FileService {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
    this.mimeMap = { ...MIME_MAP };
    this._encodingDetectors = [this._detectBOM.bind(this)];
  }

  getExtension(filename) {
    if (!filename) return '';
    const dot = filename.lastIndexOf('.');
    if (dot === -1 || dot === filename.length - 1) return '';
    return filename.slice(dot + 1).toLowerCase();
  }

  getBaseName(filename) {
    const dot = filename.lastIndexOf('.');
    return dot === -1 ? filename : filename.slice(0, dot);
  }

  getMimeType(filename) {
    const ext = this.getExtension(filename);
    return this.mimeMap[ext] || 'application/octet-stream';
  }

  getFileType(filename) {
    const ext = this.getExtension(filename);
    if (IMAGE_EXTENSIONS.has(ext)) return 'IMAGE';
    if (VIDEO_EXTENSIONS.has(ext)) return 'VIDEO';
    if (AUDIO_EXTENSIONS.has(ext)) return 'AUDIO';
    if (TEXT_EXTENSIONS.has(ext)) return 'TEXT';
    if (MODEL_EXTENSIONS.has(ext)) return 'MODEL';
    if (ext === 'pdf') return 'PDF';
    if (ARCHIVE_EXTENSIONS.has(ext)) return 'ARCHIVE';
    return 'BINARY';
  }

  isTextExtension(filename) {
    return TEXT_EXTENSIONS.has(this.getExtension(filename));
  }

  async readAsText(blob, encoding = 'utf-8') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob, encoding);
    });
  }

  async readAsDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async readAsArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  async readAsUint8Array(blob) {
    const buf = await this.readAsArrayBuffer(blob);
    return new Uint8Array(buf);
  }

  async readRange(blob, start, end) {
    const slice = blob.slice(start, end);
    return this.readAsUint8Array(slice);
  }

  async *streamChunks(blob, chunkSize = this.chunkSize) {
    const total = blob.size;
    let offset = 0;
    while (offset < total) {
      const end = Math.min(offset + chunkSize, total);
      const slice = blob.slice(offset, end);
      yield { offset, data: await this.readAsUint8Array(slice) };
      offset = end;
    }
  }

  async readWholeStream(blob, onProgress) {
    const parts = [];
    let loaded = 0;
    for await (const { data } of this.streamChunks(blob)) {
      parts.push(data);
      loaded += data.byteLength;
      if (onProgress) onProgress(loaded / blob.size);
    }
    const total = parts.reduce((s, p) => s + p.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.byteLength; }
    return out;
  }

  async sniffMime(blob) {
    const header = await this.readRange(blob, 0, Math.min(SNIFF_BYTES, blob.size));
    return this.detectContentType(header);
  }

  detectContentType(bytes) {
    if (!bytes || bytes.length < 4) return 'application/octet-stream';
    const b = bytes;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
    if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return 'application/zip';
    if (b[0] === 0x1F && b[1] === 0x8B && b[2] === 0x08) return 'application/gzip';
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return 'application/vnd.rar';
    if (b[0] === 0x37 && b[1] === 0x7A && b[2] === 0xBC && b[3] === 0xAF) return 'application/x-7z-compressed';
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'video/webm';
    if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (brand.startsWith('M4A')) return 'audio/mp4';
      if (brand.startsWith('M4V')) return 'video/x-m4v';
      return 'video/mp4';
    }
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';
    if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return 'audio/mpeg';
    if (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg';
    if (b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) return 'audio/flac';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b.length >= 12 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return 'audio/wav';
    if (b[0] === 0x7F && b[1] === 0x45 && b[2] === 0x4C && b[3] === 0x46) return 'application/x-executable';
    if (b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6D) return 'application/wasm';
    if (b[0] === 0x77 && b[1] === 0x4F && b[2] === 0x46 && b[3] === 0x46) return 'font/woff';
    if (b[0] === 0x77 && b[1] === 0x4F && b[2] === 0x46 && b[3] === 0x32) return 'font/woff2';
    if (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return 'font/ttf';
    return 'application/octet-stream';
  }

  async detectEncoding(blob) {
    const bytes = await this.readRange(blob, 0, 4096);
    for (const detect of this._encodingDetectors) {
      const result = detect(bytes);
      if (result) return result;
    }
    return this._statisticalDetect(bytes);
  }

  _detectBOM(bytes) {
    if (bytes.length >= 2) {
      if (bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
      if (bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
    }
    if (bytes.length >= 3) {
      if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';
    }
    if (bytes.length >= 4) {
      if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xFE && bytes[3] === 0xFF) return 'utf-32be';
      if (bytes[0] === 0xFF && bytes[1] === 0xFE && bytes[2] === 0x00 && bytes[3] === 0x00) return 'utf-32le';
    }
    return null;
  }

  _statisticalDetect(bytes) {
    if (!bytes.length) return 'utf-8';
    let nulls = 0;
    let highBytes = 0;
    let ascii = 0;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0) nulls++;
      else if (b < 128) ascii++;
      else highBytes++;
    }
    const total = bytes.length;
    if (nulls / total > 0.3) {
      let odd = 0, even = 0;
      for (let i = 0; i < Math.min(bytes.length, 512); i++) {
        if (i % 2 === 0 && bytes[i] === 0) even++;
        if (i % 2 === 1 && bytes[i] === 0) odd++;
      }
      return even > odd ? 'utf-16be' : 'utf-16le';
    }
    if (highBytes / total > 0.1) {
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        decoder.decode(bytes);
        return 'utf-8';
      } catch {
        return 'windows-1252';
      }
    }
    return 'utf-8';
  }

  async isTextFile(blob) {
    if (blob.type && blob.type.startsWith('text/')) return true;
    const bytes = await this.readRange(blob, 0, SNIFF_BYTES);
    if (!bytes.length) return false;
    let nulls = 0;
    let printable = 0;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0) nulls++;
      if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13 || (b >= 128)) printable++;
    }
    const nullRatio = nulls / bytes.length;
    const printableRatio = printable / bytes.length;
    return nullRatio < 0.05 && printableRatio > 0.85;
  }

  async isBinaryFile(blob) {
    return !(await this.isTextFile(blob));
  }

  async convertBlob(blob, targetMime, options = {}) {
    if (blob.type === targetMime) return blob;
    if (blob.type.startsWith('image/') && targetMime.startsWith('image/')) {
      return this._convertImage(blob, targetMime, options);
    }
    if (blob.type.startsWith('text/') && targetMime.startsWith('text/')) {
      const text = await this.readAsText(blob);
      return new Blob([text], { type: targetMime });
    }
    if (blob.type === 'application/json' && targetMime === 'text/csv') {
      return this._jsonToCsv(blob);
    }
    if (blob.type === 'text/csv' && targetMime === 'application/json') {
      return this._csvToJson(blob);
    }
    const buffer = await this.readAsArrayBuffer(blob);
    return new Blob([buffer], { type: targetMime });
  }

  async _convertImage(blob, targetMime, options = {}) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (options.maxWidth && width > options.maxWidth) {
          height = Math.round(height * options.maxWidth / width);
          width = options.maxWidth;
        }
        if (options.maxHeight && height > options.maxHeight) {
          width = Math.round(width * options.maxHeight / height);
          height = options.maxHeight;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (targetMime === 'image/jpeg') {
          ctx.fillStyle = options.backgroundColor || '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (result) => {
            URL.revokeObjectURL(url);
            if (result) resolve(result);
            else reject(new Error('Conversion failed'));
          },
          targetMime,
          options.quality ?? 0.92
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image load failed'));
      };
      img.src = url;
    });
  }

  async _jsonToCsv(blob) {
    const text = await this.readAsText(blob);
    const data = JSON.parse(text);
    if (!Array.isArray(data) || !data.length) return new Blob([''], { type: 'text/csv' });
    const keys = Object.keys(data[0]);
    const escape = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [keys.join(',')];
    for (const row of data) {
      lines.push(keys.map(k => escape(row[k])).join(','));
    }
    return new Blob([lines.join('\n')], { type: 'text/csv' });
  }

  async _csvToJson(blob) {
    const text = await this.readAsText(blob);
    const lines = text.split('\n').filter(l => l.trim());
    if (!lines.length) return new Blob(['[]'], { type: 'application/json' });
    const parseLine = (line) => {
      const out = [];
      let cur = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuote = !inQuote;
        else if (c === ',' && !inQuote) { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out;
    };
    const headers = parseLine(lines[0]);
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseLine(lines[i]);
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        const v = cells[j] ?? '';
        obj[headers[j]] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
      }
      data.push(obj);
    }
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  }

  sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 200);
  }

  getUniqueFilename(baseName, existingNames) {
    const ext = this.getExtension(baseName);
    const base = ext ? baseName.slice(0, -(ext.length + 1)) : baseName;
    let candidate = baseName;
    let counter = 1;
    const set = new Set(existingNames);
    while (set.has(candidate)) {
      candidate = ext ? `${base} (${counter}).${ext}` : `${base} (${counter})`;
      counter++;
    }
    return candidate;
  }

  async computeChecksum(blob, algorithm = 'SHA-256') {
    const buffer = await this.readAsArrayBuffer(blob);
    const hash = await crypto.subtle.digest(algorithm, buffer);
    const arr = new Uint8Array(hash);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
    return s;
  }

  async computeStreamingChecksum(blob, algorithm = 'SHA-256', onProgress) {
    const chunks = [];
    let loaded = 0;
    for await (const { data } of this.streamChunks(blob)) {
      chunks.push(data);
      loaded += data.byteLength;
      if (onProgress) onProgress(loaded / blob.size);
    }
    const total = chunks.reduce((s, c) => s + c.byteLength, 0);
    const combined = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { combined.set(c, off); off += c.byteLength; }
    const hash = await crypto.subtle.digest(algorithm, combined.buffer);
    const arr = new Uint8Array(hash);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
    return s;
  }

  formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
  }

  formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  async detectFileType(blob, filename = '') {
    const ext = this.getExtension(filename);
    if (ext) {
      const byExt = this.getFileType(filename);
      if (byExt !== 'BINARY') return byExt;
    }
    const mime = await this.sniffMime(blob);
    if (mime.startsWith('image/')) return 'IMAGE';
    if (mime.startsWith('video/')) return 'VIDEO';
    if (mime.startsWith('audio/')) return 'AUDIO';
    if (mime.startsWith('text/')) return 'TEXT';
    if (mime === 'application/pdf') return 'PDF';
    if (mime.includes('zip') || mime.includes('rar') || mime.includes('gzip') || mime.includes('7z')) return 'ARCHIVE';
    if (mime.includes('gltf') || mime.includes('sla')) return 'MODEL';
    if (await this.isTextFile(blob)) return 'TEXT';
    return 'BINARY';
  }

  async loadTextWithEncoding(blob) {
    const encoding = await this.detectEncoding(blob);
    try {
      const text = await this.readAsText(blob, encoding);
      return { text, encoding };
    } catch (e) {
      const text = await this.readAsText(blob, 'utf-8');
      return { text, encoding: 'utf-8', fallback: true };
    }
  }

  async extractPreview(blob, options = {}) {
    const { targetType = 'IMAGE', maxSize = 256 } = options;
    if (targetType === 'IMAGE') {
      try {
        const url = URL.createObjectURL(blob);
        const img = await this._loadImage(url);
        const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.7));
      } catch {
        return null;
      }
    }
    if (targetType === 'TEXT') {
      const { text } = await this.loadTextWithEncoding(blob);
      const preview = text.slice(0, 500);
      return new Blob([preview], { type: 'text/plain' });
    }
    if (targetType === 'VIDEO' || targetType === 'AUDIO') {
      try {
        const media = document.createElement(targetType === 'VIDEO' ? 'video' : 'audio');
        const url = URL.createObjectURL(blob);
        await new Promise((resolve, reject) => {
          media.onloadedmetadata = resolve;
          media.onerror = reject;
          media.src = url;
        });
        URL.revokeObjectURL(url);
        return { duration: media.duration, width: media.videoWidth, height: media.videoHeight };
      } catch {
        return null;
      }
    }
    return null;
  }

  _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }
}

export const fileService = new FileService();
