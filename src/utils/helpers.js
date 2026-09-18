const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
const TIME_UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, y: 31536000000 };

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico', 'avif', 'tiff', 'tif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', '3gp']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'opus', 'wma']);
const TEXT_EXTS = new Set(['txt', 'json', 'md', 'markdown', 'js', 'mjs', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg', 'yaml', 'yml', 'csv', 'tsv', 'log', 'ini', 'conf', 'toml', 'env', 'c', 'cpp', 'cc', 'h', 'hpp', 'java', 'py', 'rb', 'go', 'rs', 'swift', 'php', 'sh', 'bat', 'ps1', 'sql', 'vue', 'svelte']);
const MODEL_EXTS = new Set(['obj', 'stl', 'gltf', 'glb', 'fbx', '3ds', 'dae', 'ply']);
const ARCHIVE_EXTS = new Set(['zip', 'apk', 'jar', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'war']);

const MIME_MAP = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
  avif: 'image/avif', tiff: 'image/tiff', tif: 'image/tiff',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', opus: 'audio/opus',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska', m4v: 'video/x-m4v',
  pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed', tar: 'application/x-tar', gz: 'application/gzip',
  txt: 'text/plain', json: 'application/json', md: 'text/markdown',
  js: 'text/javascript', mjs: 'text/javascript', ts: 'text/typescript',
  html: 'text/html', htm: 'text/html', css: 'text/css', xml: 'application/xml',
  yaml: 'text/yaml', yml: 'text/yaml', csv: 'text/csv', tsv: 'text/tab-separated-values',
  gltf: 'model/gltf+json', glb: 'model/gltf-binary', obj: 'text/plain', stl: 'application/sla',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  wasm: 'application/wasm',
};

export function formatBytes(bytes, decimals = 2) {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  if (bytes < 0) return '-' + formatBytes(-bytes, decimals);
  const k = 1024;
  const i = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(decimals)} ${BYTE_UNITS[i]}`;
}

export function parseBytes(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const match = String(str).trim().match(/^(-?\d+(?:\.\d+)?)\s*([A-Z]+)?$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  const idx = BYTE_UNITS.indexOf(unit);
  if (idx === -1) return value;
  return value * Math.pow(1024, idx);
}

export function formatDuration(seconds, options = {}) {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const { showMs = false, showHours = 'auto', pad = true } = options;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  const p = (n) => (pad ? String(n).padStart(2, '0') : String(n));
  const base = showHours === true || (showHours === 'auto' && h > 0)
    ? `${p(h)}:${p(m)}:${p(s)}`
    : `${p(m)}:${p(s)}`;
  return showMs ? `${base}.${String(ms).padStart(3, '0')}` : base;
}

export function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const abs = Math.abs(diff);
  if (abs < 5000) return 'just now';
  if (abs < 60000) return `${Math.floor(abs / 1000)}s ago`;
  if (abs < 3600000) return `${Math.floor(abs / 60000)}m ago`;
  if (abs < 86400000) return `${Math.floor(abs / 3600000)}h ago`;
  if (abs < 604800000) return `${Math.floor(abs / 86400000)}d ago`;
  if (abs < 2592000000) return `${Math.floor(abs / 604800000)}w ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatNumber(n, locale = 'en-US') {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat(locale).format(n);
}

export function formatCompact(n, locale = 'en-US') {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatPercent(value, decimals = 1) {
  if (value == null || isNaN(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatCurrency(cents, currency = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

export function getExtension(filename) {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export function getBaseName(filename) {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  return dot <= 0 ? filename : filename.slice(0, dot);
}

export function getFileName(path) {
  if (!path) return '';
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx === -1 ? path : path.slice(idx + 1);
}

export function getDirName(path) {
  if (!path) return '';
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx === -1 ? '' : path.slice(0, idx);
}

export function getFileType(filename) {
  const ext = getExtension(filename);
  if (!ext) return 'BINARY';
  if (IMAGE_EXTS.has(ext)) return 'IMAGE';
  if (VIDEO_EXTS.has(ext)) return 'VIDEO';
  if (AUDIO_EXTS.has(ext)) return 'AUDIO';
  if (TEXT_EXTS.has(ext)) return 'TEXT';
  if (MODEL_EXTS.has(ext)) return 'MODEL';
  if (ext === 'pdf') return 'PDF';
  if (ARCHIVE_EXTS.has(ext)) return 'ARCHIVE';
  return 'BINARY';
}

export function getMimeType(filename) {
  const ext = getExtension(filename);
  return MIME_MAP[ext] || 'application/octet-stream';
}

export function isImageFile(filename) { return getFileType(filename) === 'IMAGE'; }
export function isVideoFile(filename) { return getFileType(filename) === 'VIDEO'; }
export function isAudioFile(filename) { return getFileType(filename) === 'AUDIO'; }
export function isTextFile(filename) { return getFileType(filename) === 'TEXT'; }

export function generateUUID() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function generateShortId(length = 8) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = new Uint8Array(length);
  if (crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
}

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}

export function debounce(fn, delay = 250, options = {}) {
  const { leading = false, trailing = true, maxWait = 0 } = options;
  let timer = null;
  let maxTimer = null;
  let lastArgs = null;
  let lastCallTime = 0;
  let invokedLeading = false;

  const invoke = (args) => {
    lastArgs = null;
    fn.apply(null, args);
  };

  const clearTimers = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
  };

  return function debounced(...args) {
    const now = Date.now();
    const isFirst = !timer;
    lastArgs = args;

    if (leading && isFirst && !invokedLeading) {
      invokedLeading = true;
      invoke(args);
    }

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      invokedLeading = false;
      if (trailing && lastArgs) invoke(lastArgs);
      clearTimers();
    }, delay);

    if (maxWait > 0 && !maxTimer) {
      maxTimer = setTimeout(() => {
        maxTimer = null;
        if (lastArgs) invoke(lastArgs);
        clearTimers();
      }, maxWait);
    }
    lastCallTime = now;
  };
}

export function throttle(fn, limit = 250, options = {}) {
  const { leading = true, trailing = true } = options;
  let lastCall = 0;
  let timer = null;
  let lastArgs = null;
  let lastThis = null;

  return function throttled(...args) {
    const now = Date.now();
    lastArgs = args;
    lastThis = this;

    if (leading && now - lastCall >= limit) {
      lastCall = now;
      fn.apply(lastThis, lastArgs);
      return;
    }

    if (trailing && !timer) {
      const remaining = limit - (now - lastCall);
      timer = setTimeout(() => {
        timer = null;
        lastCall = Date.now();
        if (lastArgs) fn.apply(lastThis, lastArgs);
      }, Math.max(0, remaining));
    }
  };
}

export function rafThrottle(fn) {
  let rafId = null;
  let lastArgs = null;
  return function (...args) {
    lastArgs = args;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      fn.apply(null, lastArgs);
    });
  };
}

export function once(fn) {
  let called = false;
  let result;
  return function (...args) {
    if (called) return result;
    called = true;
    result = fn.apply(this, args);
    return result;
  };
}

export function memoize(fn, resolver) {
  const cache = new Map();
  return function (...args) {
    const key = resolver ? resolver(...args) : JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    const result = fn.apply(this, args);
    cache.set(key, result);
    return result;
  };
}

export function deepClone(obj, seen = new WeakMap()) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return seen.get(obj);
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof RegExp) return new RegExp(obj.source, obj.flags);
  if (obj instanceof ArrayBuffer) return obj.slice(0);
  if (obj instanceof Blob) return obj.slice(0, obj.size, obj.type);
  if (ArrayBuffer.isView(obj)) return new obj.constructor(obj);
  if (Array.isArray(obj)) {
    const out = [];
    seen.set(obj, out);
    for (let i = 0; i < obj.length; i++) out[i] = deepClone(obj[i], seen);
    return out;
  }
  if (obj instanceof Map) {
    const out = new Map();
    seen.set(obj, out);
    for (const [k, v] of obj) out.set(deepClone(k, seen), deepClone(v, seen));
    return out;
  }
  if (obj instanceof Set) {
    const out = new Set();
    seen.set(obj, out);
    for (const v of obj) out.add(deepClone(v, seen));
    return out;
  }
  const proto = Object.getPrototypeOf(obj);
  const out = Object.create(proto);
  seen.set(obj, out);
  for (const key of Object.keys(obj)) {
    out[key] = deepClone(obj[key], seen);
  }
  return out;
}

export function deepMerge(target, ...sources) {
  if (!sources.length) return target;
  const source = sources.shift();
  if (isPlainObject(target) && isPlainObject(source)) {
    for (const key of Object.keys(source)) {
      if (isPlainObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        deepMerge(target[key], source[key]);
      } else if (Array.isArray(source[key])) {
        target[key] = source[key].slice();
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  return deepMerge(target, ...sources);
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) deepFreeze(obj[key]);
  return obj;
}

export function getPath(obj, path, defaultValue) {
  if (!path) return obj;
  const parts = Array.isArray(path) ? path : path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return defaultValue;
    current = current[part];
  }
  return current !== undefined ? current : defaultValue;
}

export function setPath(obj, path, value) {
  const parts = Array.isArray(path) ? path : path.split('.');
  const last = parts.pop();
  let current = obj;
  for (const part of parts) {
    if (current[part] == null || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[last] = value;
  return obj;
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && value.constructor === Object;
}

export function isBlob(value) {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

export function isFile(value) {
  return typeof File !== 'undefined' && value instanceof File;
}

export function isArrayBuffer(value) {
  return value instanceof ArrayBuffer;
}

export function isTypedArray(value) {
  return ArrayBuffer.isView(value);
}

export function isEmpty(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  if (value instanceof Map || value instanceof Set) return value.size === 0;
  return false;
}

export function base64Encode(input) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : input;
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64Decode(input) {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64DecodeToString(input) {
  return new TextDecoder().decode(base64Decode(input));
}

export function base64UrlEncode(input) {
  return base64Encode(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(input) {
  let padded = input.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return base64Decode(padded);
}

export function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function textEncode(str, encoding = 'utf-8') {
  return new TextEncoder(encoding).encode(str);
}

export function textDecode(bytes, encoding = 'utf-8') {
  return new TextDecoder(encoding).decode(bytes);
}

export function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export function blobToText(blob, encoding = 'utf-8') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob, encoding);
  });
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function arrayBufferToBlob(buffer, mimeType = 'application/octet-stream') {
  return new Blob([buffer], { type: mimeType });
}

export function dataURLToBlob(dataURL) {
  const [header, data] = dataURL.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = base64Decode(data);
  return new Blob([bytes], { type: mime });
}

export function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

export function safeJsonStringify(value, options = {}) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (key, val) => {
      if (val && typeof val === 'object') {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      if (val instanceof Blob) return `[Blob ${val.size}B ${val.type}]`;
      if (val instanceof ArrayBuffer) return `[ArrayBuffer ${val.byteLength}B]`;
      if (ArrayBuffer.isView(val)) return `[${val.constructor.name} ${val.byteLength}B]`;
      return val;
    }, options.indent || 0);
  } catch {
    return options.fallback || '{}';
  }
}

export function truncate(str, maxLength = 40, suffix = '…') {
  if (str == null) return '';
  if (str.length <= maxLength) return str;
  if (maxLength <= suffix.length) return suffix.slice(0, maxLength);
  return str.slice(0, maxLength - suffix.length) + suffix;
}

export function truncateMiddle(str, maxLength = 40, ellipsis = '…') {
  if (str == null) return '';
  if (str.length <= maxLength) return str;
  const keep = Math.floor((maxLength - ellipsis.length) / 2);
  return str.slice(0, keep) + ellipsis + str.slice(str.length - keep);
}

export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function toTitleCase(str) {
  return String(str).replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

export function slugify(str, separator = '-') {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, separator)
    .replace(/-+/g, separator)
    .toLowerCase();
}

export function camelCase(str) {
  return str.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''));
}

export function kebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

export function snakeCase(str) {
  return kebabCase(str).replace(/-/g, '_');
}

export function padStart(str, length, char = '0') {
  return String(str).padStart(length, char);
}

export function padEnd(str, length, char = '0') {
  return String(str).padEnd(length, char);
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function unescapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x2F;/g, '/');
}

export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripHtml(str) {
  const div = document.createElement('div');
  div.innerHTML = str;
  return div.textContent || '';
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export function timeout(promise, ms, message = 'Operation timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export async function retry(fn, options = {}) {
  const { attempts = 3, delay = 500, backoff = 2, shouldRetry = () => true } = options;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      if (i === attempts - 1 || !shouldRetry(err, i)) break;
      await sleep(delay * Math.pow(backoff, i));
    }
  }
  throw lastError;
}

export function withTimeout(fn, ms, message) {
  return function (...args) {
    return timeout(Promise.resolve(fn.apply(this, args)), ms, message);
  };
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

export function randomString(length = 16, alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function randomColor() {
  const hue = Math.floor(Math.random() * 360);
  const sat = 60 + Math.floor(Math.random() * 30);
  const light = 40 + Math.floor(Math.random() * 20);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function sample(arr, count) {
  return shuffle(arr).slice(0, count);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function mapRange(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  return outMin + ((value - inMin) * (outMax - outMin)) / (inMax - inMin);
}

export function roundTo(value, decimals = 0) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function groupBy(arr, keyFn) {
  const out = new Map();
  for (const item of arr) {
    const key = typeof keyFn === 'function' ? keyFn(item) : item[keyFn];
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

export function uniqueBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = typeof keyFn === 'function' ? keyFn(item) : item[keyFn];
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function flatten(arr, depth = 1) {
  return arr.flat(depth);
}

export function zip(...arrays) {
  const min = Math.min(...arrays.map((a) => a.length));
  const out = [];
  for (let i = 0; i < min; i++) out.push(arrays.map((a) => a[i]));
  return out;
}

export function zipLongest(...arrays) {
  const max = Math.max(...arrays.map((a) => a.length));
  const out = [];
  for (let i = 0; i < max; i++) out.push(arrays.map((a) => a[i]));
  return out;
}

export function range(start, end, step = 1) {
  if (end === undefined) { end = start; start = 0; }
  const out = [];
  if (step > 0) for (let i = start; i < end; i += step) out.push(i);
  else for (let i = start; i > end; i += step) out.push(i);
  return out;
}

export function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
export function average(arr) { return arr.length ? sum(arr) / arr.length : 0; }
export function median(arr) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function min(arr) { return arr.length ? Math.min(...arr) : 0; }
export function max(arr) { return arr.length ? Math.max(...arr) : 0; }

export function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

export function normalizePath(path) {
  if (!path) return '/';
  let p = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export function resolvePath(base, relative) {
  if (relative.startsWith('/')) return normalizePath(relative);
  const parts = base.split('/').filter(Boolean);
  for (const seg of relative.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return '/' + parts.join('/');
}

export function getUrlParam(key, url = window.location.href) {
  try {
    return new URL(url).searchParams.get(key);
  } catch {
    return null;
  }
}

export function getAllUrlParams(url = window.location.href) {
  try {
    const out = {};
    new URL(url).searchParams.forEach((v, k) => { out[k] = v; });
    return out;
  } catch {
    return {};
  }
}

export function buildQueryString(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((item) => sp.append(k, String(item)));
    else sp.set(k, String(v));
  }
  return sp.toString();
}

export function downloadBlob(blob, filename) {
  if (typeof saveAs !== 'undefined') {
    saveAs(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function downloadDataURL(dataURL, filename) {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  return ok;
}

export async function readClipboard() {
  if (navigator.clipboard && navigator.clipboard.readText) {
    return navigator.clipboard.readText();
  }
  return null;
}

export function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function isTouchDevice() {
  if (!isBrowser()) return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
}

export function prefersReducedMotion() {
  if (!isBrowser() || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function prefersDarkMode() {
  if (!isBrowser() || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function isStandalone() {
  if (!isBrowser()) return false;
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
}

export function uid(prefix = '') {
  return prefix + generateShortId(10) + Date.now().toString(36).slice(-4);
}

export function timestamp() {
  return Date.now();
}

export function now() {
  return performance && performance.now ? performance.now() : Date.now();
}

export function uniqueTimestamp() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function byteLengthUTF8(str) {
  return new TextEncoder().encode(str).byteLength;
}

export function isASCII(str) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 127) return false;
  }
  return true;
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export function parseBool(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (['true', '1', 'yes', 'on', 'y'].includes(lower)) return true;
    if (['false', '0', 'no', 'off', 'n', ''].includes(lower)) return false;
  }
  return defaultValue;
}

export function getProp(obj, path, defaultValue) {
  return getPath(obj, path, defaultValue);
}
