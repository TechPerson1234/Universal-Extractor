// =============================================================================
// src/services/ExportService.js
// =============================================================================
// Handles exporting files and workspaces in various formats:
// single file export, ZIP archive, JSON, CSV, and streaming large exports.
// =============================================================================

export class ExportService {
  constructor() {
    this.exportFormats = {
      'zip': 'application/zip',
      'json': 'application/json',
      'csv': 'text/csv',
      'txt': 'text/plain',
      'html': 'text/html',
    };
  }

  /**
   * Export a single file
   * @param {Blob} blob - File blob
   * @param {string} filename - Desired filename
   * @param {string} format - Optional format conversion (e.g., 'png', 'jpeg')
   * @returns {Promise<{blob: Blob, filename: string}>}
   */
  async exportFile(blob, filename, format = null) {
    let outBlob = blob;
    let outName = filename;

    // If format is specified and differs from current, try to convert
    if (format) {
      const ext = format.startsWith('.') ? format : '.' + format;
      const mime = this.getMimeTypeFromExtension(ext);
      if (mime && mime !== blob.type) {
        // Attempt conversion
        try {
          const converted = await this._convertBlob(blob, mime);
          if (converted) {
            outBlob = converted;
            // Update filename extension
            const base = filename.replace(/\.[^.]+$/, '');
            outName = base + ext;
          }
        } catch (e) {
          console.warn('Export conversion failed:', e);
          // Keep original
        }
      }
    }

    return { blob: outBlob, filename: outName };
  }

  /**
   * Export multiple files as a ZIP archive
   * @param {Array<{path: string, blob: Blob}>} files - Array of file entries
   * @param {string} zipName - Name of the ZIP file
   * @param {Function} onProgress - Callback with progress (0-1)
   * @returns {Promise<Blob>}
   */
  async exportAsZip(files, zipName = 'export.zip', onProgress = null) {
    // Use JSZip (global)
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library not loaded');
    }
    const zip = new JSZip();
    let processed = 0;
    const total = files.length;

    for (const entry of files) {
      const path = entry.path.replace(/^\/+/, ''); // remove leading slash
      zip.file(path, entry.blob);
      processed++;
      if (onProgress) {
        onProgress(processed / total);
      }
    }

    // Generate blob
    const blob = await zip.generateAsync({ type: 'blob' });
    return blob;
  }

  /**
   * Export file list as JSON
   * @param {Array<{path: string, name: string, type: string, size: number, modified: number}>} files
   * @param {string} jsonName
   * @returns {Blob}
   */
  exportAsJSON(files, jsonName = 'files.json') {
    const data = JSON.stringify(files, null, 2);
    return new Blob([data], { type: 'application/json' });
  }

  /**
   * Export as CSV (simple list of files)
   * @param {Array} files - Array of file metadata
   * @returns {Blob}
   */
  exportAsCSV(files) {
    const header = 'Path,Name,Type,Size (bytes),Modified\n';
    const rows = files.map(f =>
      `${f.path},${f.name},${f.type},${f.size},${f.modified}`
    );
    const content = header + rows.join('\n');
    return new Blob([content], { type: 'text/csv' });
  }

  /**
   * Export a workspace (all files) as a ZIP with metadata
   * @param {VFS} vfs - Virtual File System instance
   * @param {string} zipName
   * @param {Function} onProgress
   * @returns {Promise<Blob>}
   */
  async exportWorkspace(vfs, zipName = 'workspace.zip', onProgress = null) {
    const allFiles = vfs.getAllFiles();
    const entries = allFiles.map(file => ({
      path: file.path,
      blob: file.blob,
      metadata: {
        name: file.name,
        type: file.type,
        size: file.size,
        created: file.created,
        modified: file.modified,
      }
    }));

    // Add metadata.json
    const metadata = entries.map(e => e.metadata);
    const metaBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
    entries.push({ path: '/.metadata.json', blob: metaBlob });

    return this.exportAsZip(entries, zipName, onProgress);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  getMimeTypeFromExtension(ext) {
    const map = {
      '.zip': 'application/zip',
      '.json': 'application/json',
      '.csv': 'text/csv',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
    };
    return map[ext] || 'application/octet-stream';
  }

  async _convertBlob(blob, targetMime) {
    // Only image conversion for now
    if (blob.type.startsWith('image/') && targetMime.startsWith('image/')) {
      return this._convertImage(blob, targetMime);
    }
    return null;
  }

  async _convertImage(blob, targetMime) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((result) => {
          URL.revokeObjectURL(url);
          resolve(result);
        }, targetMime);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      img.src = url;
    });
  }
}