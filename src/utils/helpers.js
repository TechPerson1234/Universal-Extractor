// =============================================================================
// src/utils/helpers.js
// =============================================================================
// Utility functions: formatting, type detection, UUID generation,
// debounce, throttle, deep clone, checksum calculation, etc.
// =============================================================================

/**
 * Format bytes to human-readable string
 * @param {number} bytes
 * @param {number} decimals
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Get file type from filename based on extension
 * @param {string} filename
 * @returns {string} 'IMAGE', 'VIDEO', 'AUDIO', 'TEXT', 'MODEL', 'PDF', 'ARCHIVE', 'BINARY'
 */
export function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return 'BINARY';
  const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico'];
  const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'];
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
  const textExts = ['txt', 'json', 'md', 'js', 'html', 'css', 'xml', 'yaml', 'yml', 'c', 'cpp', 'java', 'py', 'rb', 'go', 'rs', 'swift', 'php', 'sh', 'bat', 'ps1'];
  const modelExts = ['obj', 'stl', 'gltf', 'glb', 'fbx', '3ds'];
  const pdfExts = ['pdf'];
  const archiveExts = ['zip', 'apk', 'jar', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'];

  if (imageExts.includes(ext)) return 'IMAGE';
  if (videoExts.includes(ext)) return 'VIDEO';
  if (audioExts.includes(ext)) return 'AUDIO';
  if (textExts.includes(ext)) return 'TEXT';
  if (modelExts.includes(ext)) return 'MODEL';
  if (pdfExts.includes(ext)) return 'PDF';
  if (archiveExts.includes(ext)) return 'ARCHIVE';
  return 'BINARY';
}

/**
 * Generate a UUID v4
 * @returns {string}
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Debounce a function
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
export function debounce(fn, delay = 250) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle a function
 * @param {Function} fn
 * @param {number} limit
 * @returns {Function}
 */
export function throttle(fn, limit = 250) {
  let inThrottle = false;
  return function(...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => { inThrottle = false; }, limit);
    }
  };
}

/**
 * Deep clone an object
 * @param {*} obj
 * @returns {*}
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj);
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  if (obj instanceof Blob) return obj.slice(0, obj.size, obj.type);
  const cloned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

/**
 * Calculate SHA-256 checksum of a Blob
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function calculateChecksum(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Escape HTML entities
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return str.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Get file extension from path
 * @param {string} path
 * @returns {string}
 */
export function getExtension(path) {
  const parts = path.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

/**
 * Get base name (filename without extension)
 * @param {string} path
 * @returns {string}
 */
export function getBaseName(path) {
  const name = path.split('/').pop();
  const ext = getExtension(name);
  return ext ? name.slice(0, name.length - ext.length - 1) : name;
}

/**
 * Check if a string is a valid URL
 * @param {string} str
 * @returns {boolean}
 */
export function isValidUrl(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sleep for a given milliseconds
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Convert a string to title case
 * @param {string} str
 * @returns {string}
 */
export function toTitleCase(str) {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Truncate a string to a maximum length
 * @param {string} str
 * @param {number} maxLength
 * @param {string} suffix
 * @returns {string}
 */
export function truncate(str, maxLength = 50, suffix = '...') {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Check if a value is a plain object (not array, date, etc.)
 * @param {*} value
 * @returns {boolean}
 */
export function isPlainObject(value) {
  return value && typeof value === 'object' && value.constructor === Object;
}

/**
 * Merge two objects deeply (similar to lodash merge)
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
export function deepMerge(target, source) {
  const output = { ...target };
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (isPlainObject(source[key]) && isPlainObject(target[key])) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
  }
  return output;
}

/**
 * Safe JSON parse with default on error
 * @param {string} str
 * @param {*} defaultVal
 * @returns {*}
 */
export function safeJsonParse(str, defaultVal = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultVal;
  }
}

/**
 * Generate a random integer between min and max (inclusive)
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Get a timestamp as ISO string
 * @param {Date} date
 * @returns {string}
 */
export function getTimestamp(date = new Date()) {
  return date.toISOString();
}

/**
 * Check if running in a browser environment
 * @returns {boolean}
 */
export function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Get a parameter from URL
 * @param {string} key
 * @param {string} url
 * @returns {string|null}
 */
export function getUrlParam(key, url = window.location.href) {
  const params = new URLSearchParams(new URL(url).search);
  return params.get(key);
}

/**
 * Download a blob as a file
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  if (typeof saveAs !== 'undefined') {
    saveAs(blob, filename);
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

// Export all as a single object for convenience?
// Or we can export individually.