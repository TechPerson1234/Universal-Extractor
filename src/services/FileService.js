// =============================================================================
// src/services/FileService.js
// =============================================================================
// Handles file reading, writing, conversion, and format detection.
// Provides methods to read files as text, data URLs, ArrayBuffers,
// and convert between formats.
// =============================================================================

export class FileService {
  constructor() {
    // MIME type mapping for common extensions
    this.mimeMap = {
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.obj': 'text/plain',
      '.stl': 'application/sla',
      '.gltf': 'model/gltf+json',
      '.glb': 'model/gltf-binary',
    };
  }

  /**
   * Read a file as text
   * @param {Blob|File} blob - The file blob
   * @param {string} encoding - Optional encoding (default UTF-8)
   * @returns {Promise<string>}
   */
  async readAsText(blob, encoding = 'UTF-8') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob, encoding);
    });
  }

  /**
   * Read a file as data URL
   * @param {Blob|File} blob
   * @returns {Promise<string>}
   */
  async readAsDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Read a file as ArrayBuffer
   * @param {Blob|File} blob
   * @returns {Promise<ArrayBuffer>}
   */
  async readAsArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * Read a file as a typed array (Uint8Array)
   * @param {Blob|File} blob
   * @returns {Promise<Uint8Array>}
   */
  async readAsUint8Array(blob) {
    const buffer = await this.readAsArrayBuffer(blob);
    return new Uint8Array(buffer);
  }

  /**
   * Convert a blob to a different MIME type (if possible)
   * @param {Blob} blob - Source blob
   * @param {string} targetMime - Desired MIME type
   * @param {Object} options - Additional options (quality for images)
   * @returns {Promise<Blob>}
   */
  async convertBlob(blob, targetMime, options = {}) {
    // Handle image conversions using canvas
    if (blob.type.startsWith('image/') && targetMime.startsWith('image/')) {
      return this._convertImage(blob, targetMime, options);
    }

    // For text-based conversions (e.g., JSON to CSV) we could implement more,
    // but we'll keep it simple for now.
    // If source and target are same, return original
    if (blob.type === targetMime) return blob;

    // Fallback: try to read as text and create new blob
    try {
      const text = await this.readAsText(blob);
      return new Blob([text], { type: targetMime });
    } catch {
      // If reading as text fails, just return original
      return blob;
    }
  }

  /**
   * Internal: convert image using canvas
   */
  async _convertImage(blob, targetMime, options) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const quality = options.quality || 0.92;
        // Determine format
        let mime = targetMime;
        // If target is JPEG or WebP, use quality
        let outputType = mime;
        let outputQuality = quality;
        if (mime === 'image/jpeg' || mime === 'image/webp') {
          // Use quality
        } else {
          outputQuality = undefined;
        }
        canvas.toBlob((result) => {
          URL.revokeObjectURL(url);
          if (result) {
            resolve(result);
          } else {
            reject(new Error('Canvas toBlob failed'));
          }
        }, outputType, outputQuality);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      img.src = url;
    });
  }

  /**
   * Get MIME type from file name
   * @param {string} filename
   * @returns {string}
   */
  getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return this.mimeMap['.' + ext] || 'application/octet-stream';
  }

  /**
   * Check if a blob is a text file (by MIME type or sniffing)
   * @param {Blob} blob
   * @returns {Promise<boolean>}
   */
  async isTextFile(blob) {
    // Check MIME type
    if (blob.type && blob.type.startsWith('text/')) return true;
    // Check extension via name? Not available, but we can sniff first 512 bytes
    const buffer = await blob.slice(0, 512).arrayBuffer();
    const view = new Uint8Array(buffer);
    // If no null bytes and mostly ASCII, consider text
    let nullCount = 0;
    let printableCount = 0;
    for (let i = 0; i < view.length; i++) {
      if (view[i] === 0) nullCount++;
      if (view[i] >= 32 && view[i] <= 126) printableCount++;
    }
    // If less than 5% null and more than 80% printable, treat as text
    const ratio = view.length > 0 ? printableCount / view.length : 0;
    return nullCount < 5 && ratio > 0.8;
  }

  /**
   * Get file extension from filename
   */
  getExtension(filename) {
    return filename.split('.').pop().toLowerCase();
  }

  /**
   * Sanitize filename (remove invalid characters)
   */
  sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * Generate a unique filename by appending a number if exists
   * @param {string} baseName - desired name
   * @param {string[]} existingNames - list of existing names in the target folder
   * @returns {string}
   */
  getUniqueFilename(baseName, existingNames) {
    const ext = this.getExtension(baseName);
    const nameWithoutExt = baseName.slice(0, baseName.length - ext.length - (ext ? 1 : 0));
    let counter = 1;
    let newName = baseName;
    const set = new Set(existingNames);
    while (set.has(newName)) {
      newName = `${nameWithoutExt} (${counter})${ext ? '.' + ext : ''}`;
      counter++;
    }
    return newName;
  }
}