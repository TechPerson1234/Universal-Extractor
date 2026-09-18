const CSV_ESCAPE = /[",\n\r]/;
const ZIP_TIMEOUT = 120000;

export class ExportService {
  constructor(options = {}) {
    this.zipName = options.zipName || 'nexus-export';
    this.chunkSize = options.chunkSize || 1024 * 1024;
    this._jszipAvailable = typeof JSZip !== 'undefined';
    this._zipjsAvailable = typeof window !== 'undefined' && typeof window.zip !== 'undefined';
  }

  async exportFile(blob, filename, options = {}) {
    const { format, quality } = options;
    let output = blob;
    let outName = filename;
    if (format && !filename.toLowerCase().endsWith('.' + format)) {
      const targetMime = this._mimeFor(format);
      if (targetMime && targetMime !== blob.type) {
        try {
          const fs = window.__NEXUS_DI?.fileService;
          if (fs) output = await fs.convertBlob(blob, targetMime, { quality });
          const base = filename.replace(/\.[^.]+$/, '');
          outName = `${base}.${format}`;
        } catch (e) {
          console.warn('Conversion failed, exporting original', e);
        }
      }
    }
    this._triggerDownload(output, outName);
    return { blob: output, filename: outName };
  }

  async exportMultiple(files, options = {}) {
    const { asZip = true, zipName } = options;
    if (!asZip) {
      for (const f of files) this._triggerDownload(f.blob, f.name);
      return;
    }
    const blob = await this.exportAsZip(files, zipName, options.onProgress);
    this._triggerDownload(blob, (zipName || this.zipName) + '.zip');
  }

  async exportAsZip(files, zipName, onProgress) {
    const zip = new JSZip();
    const total = files.length;
    let processed = 0;
    for (const entry of files) {
      const path = (entry.path || entry.name || 'unnamed').replace(/^\/+/, '');
      const blob = entry.blob || entry;
      zip.file(path, blob);
      processed++;
      if (onProgress) onProgress(processed / total, processed, total);
    }
    return zip.generateAsync(
      {
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      },
      (meta) => {
        if (onProgress) onProgress(meta.percent / 100, processed, total, meta);
      }
    );
  }

  async exportAsStreamedZip(files, zipName, onProgress) {
    if (!this._zipjsAvailable) return this.exportAsZip(files, zipName, onProgress);
    const zipWriter = new window.zip.ZipWriter(new window.zip.BlobWriter('application/zip'), {
      level: 6,
      bufferedWrite: true,
    });
    let processed = 0;
    const total = files.length;
    for (const entry of files) {
      const path = (entry.path || entry.name || 'unnamed').replace(/^\/+/, '');
      const blob = entry.blob || entry;
      await zipWriter.add(path, new window.zip.BlobReader(blob), {
        onprogress: (progress) => {
          if (onProgress) onProgress((processed + progress.percent / 100) / total, processed, total);
        },
      });
      processed++;
      if (onProgress) onProgress(processed / total, processed, total);
    }
    return zipWriter.close();
  }

  async exportWorkspace(vfs, options = {}) {
    if (!vfs) throw new Error('VFS required');
    const allFiles = vfs.listAllFiles();
    const entries = [];
    for (const file of allFiles) {
      const blob = await vfs.readAsBlob(file.path);
      entries.push({
        path: file.path.replace(/^\/+/, ''),
        blob,
        metadata: {
          name: file.name,
          type: file.type,
          mimeType: file.mimeType,
          size: file.size,
          created: file.created,
          modified: file.modified,
          checksum: file.checksum,
        },
      });
    }
    const manifest = {
      version: '5.0',
      exported: Date.now(),
      files: entries.map(e => e.metadata),
      folderCount: vfs.folders.size,
      totalBytes: vfs.getTotalSize(),
    };
    entries.push({
      path: '.nexus-manifest.json',
      blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
    });
    const useStreamed = options.streamed && this._zipjsAvailable;
    const blob = useStreamed
      ? await this.exportAsStreamedZip(entries, options.zipName, options.onProgress)
      : await this.exportAsZip(entries, options.zipName, options.onProgress);
    if (options.download !== false) {
      this._triggerDownload(blob, (options.zipName || this.zipName) + '.zip');
    }
    return blob;
  }

  async exportFolderAsZip(vfs, folderPath, options = {}) {
    const prefix = folderPath === '/' ? '/' : folderPath + '/';
    const all = vfs.listAllFiles().filter(f => f.path.startsWith(prefix));
    const entries = [];
    for (const file of all) {
      const blob = await vfs.readAsBlob(file.path);
      const relativePath = file.path.substring(prefix.length);
      entries.push({ path: relativePath, blob });
    }
    const blob = await this.exportAsZip(entries, options.zipName, options.onProgress);
    if (options.download !== false) {
      const folderName = folderPath === '/' ? 'root' : folderPath.split('/').pop();
      this._triggerDownload(blob, (options.zipName || folderName) + '.zip');
    }
    return blob;
  }

  exportAsJSON(files, options = {}) {
    const data = options.metadataOnly
      ? files.map(f => ({
          path: f.path || f.name,
          name: f.name,
          type: f.type,
          mimeType: f.mimeType,
          size: f.size,
          created: f.created,
          modified: f.modified,
          checksum: f.checksum,
          tags: f.tags,
        }))
      : files;
    const json = JSON.stringify(data, null, 2);
    return new Blob([json], { type: 'application/json' });
  }

  exportAsCSV(files) {
    const header = 'Path,Name,Type,MIME,Size (bytes),Created,Modified,Checksum\n';
    const escape = (v) => {
      const s = v == null ? '' : String(v);
      return CSV_ESCAPE.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = files.map(f => [
      escape(f.path || ''),
      escape(f.name || ''),
      escape(f.type || ''),
      escape(f.mimeType || ''),
      f.size ?? 0,
      f.created ? new Date(f.created).toISOString() : '',
      f.modified ? new Date(f.modified).toISOString() : '',
      escape(f.checksum || ''),
    ].join(','));
    return new Blob([header + rows.join('\n')], { type: 'text/csv' });
  }

  exportAsMarkdown(files) {
    const lines = ['# NEXUS Export', '', `Generated: ${new Date().toISOString()}`, '', '| Path | Type | Size |', '|------|------|------|'];
    for (const f of files) {
      const size = this._formatBytes(f.size);
      lines.push(`| ${f.path || f.name} | ${f.type || '—'} | ${size} |`);
    }
    return new Blob([lines.join('\n')], { type: 'text/markdown' });
  }

  exportAsHTML(files) {
    const rows = files.map(f => `
      <tr>
        <td>${this._escapeHtml(f.path || f.name)}</td>
        <td>${this._escapeHtml(f.type || '—')}</td>
        <td>${this._formatBytes(f.size)}</td>
        <td>${f.modified ? new Date(f.modified).toLocaleString() : '—'}</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>NEXUS Export</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #ddd; padding: 24px; }
  h1 { color: #00f0ff; border-bottom: 1px solid #333; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #222; }
  th { color: #00f0ff; font-weight: bold; }
</style></head>
<body>
  <h1>NEXUS Extract</h1>
  <p>Generated ${new Date().toISOString()}</p>
  <table>
    <thead><tr><th>Path</th><th>Type</th><th>Size</th><th>Modified</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;
    return new Blob([html], { type: 'text/html' });
  }

  async shareFile(blob, filename, text = '') {
    if (!navigator.share) throw new Error('Share API unavailable');
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    const canShareFiles = navigator.canShare && navigator.canShare({ files: [file] });
    if (canShareFiles) {
      await navigator.share({ files: [file], title: filename, text });
    } else {
      await navigator.share({ title: filename, text, url: URL.createObjectURL(blob) });
    }
  }

  async shareMultiple(files, title = 'NEXUS Export') {
    if (!navigator.share || !navigator.canShare) throw new Error('Multi-file share unavailable');
    const fileObjs = files.map(f => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' }));
    if (!navigator.canShare({ files: fileObjs })) throw new Error('Cannot share these files');
    await navigator.share({ files: fileObjs, title });
  }

  async copyToClipboard(blob, type = null) {
    const mime = type || blob.type || 'text/plain';
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Clipboard API unavailable');
    const item = new ClipboardItem({ [mime]: blob });
    await navigator.clipboard.write([item]);
  }

  async saveToDisk(blob, suggestedName) {
    if (!('showSaveFilePicker' in window)) {
      this._triggerDownload(blob, suggestedName);
      return { saved: false, method: 'download' };
    }
    try {
      const handle = await window.showSaveFilePicker({ suggestedName });
      const writable = await handle.createWritable();
      await blob.stream().pipeTo(writable);
      return { saved: true, method: 'filesystem' };
    } catch (err) {
      if (err.name === 'AbortError') return { saved: false, method: 'cancelled' };
      this._triggerDownload(blob, suggestedName);
      return { saved: false, method: 'download-fallback' };
    }
  }

  async streamToDisk(readableStream, suggestedName) {
    if (!('showSaveFilePicker' in window)) throw new Error('File System Access API unavailable');
    const handle = await window.showSaveFilePicker({ suggestedName });
    const writable = await handle.createWritable();
    await readableStream.pipeTo(writable);
    return handle;
  }

  async buildZipManifest(files) {
    let totalSize = 0;
    let compressedEstimate = 0;
    const entries = [];
    for (const f of files) {
      const size = f.blob?.size ?? f.size ?? 0;
      totalSize += size;
      const ext = (f.name || '').split('.').pop().toLowerCase();
      const alreadyCompressed = ['zip', 'rar', '7z', 'gz', 'mp3', 'mp4', 'jpg', 'jpeg', 'png', 'webp'].includes(ext);
      const ratio = alreadyCompressed ? 1 : 0.6;
      compressedEstimate += size * ratio;
      entries.push({
        name: f.name,
        path: f.path,
        size,
        compressedEstimate: Math.round(size * ratio),
        type: f.type,
      });
    }
    return {
      entries,
      totalFiles: files.length,
      totalSize,
      compressedEstimate: Math.round(compressedEstimate),
      savingsPercent: totalSize > 0 ? Math.round((1 - compressedEstimate / totalSize) * 100) : 0,
    };
  }

  async streamZipToDisk(vfs, files, suggestedName, onProgress) {
    if (!this._zipjsAvailable) throw new Error('zip.js required for streaming');
    const zipWriter = new window.zip.ZipWriter(
      new window.zip.BlobWriter('application/zip'),
      { bufferedWrite: true }
    );
    let processed = 0;
    for (const file of files) {
      const blob = await vfs.readAsBlob(file.path);
      await zipWriter.add(
        file.path.replace(/^\/+/, ''),
        new window.zip.BlobReader(blob),
        {
          onprogress: (p) => {
            if (onProgress) onProgress((processed + p.percent / 100) / files.length);
          },
        }
      );
      processed++;
    }
    const blob = await zipWriter.close();
    this._triggerDownload(blob, suggestedName);
    return blob;
  }

  getSupportedFormats() {
    return {
      images: ['png', 'jpeg', 'webp', 'bmp'],
      text: ['txt', 'json', 'csv', 'md', 'html'],
      archives: this._zipjsAvailable ? ['zip'] : ['zip'],
    };
  }

  _triggerDownload(blob, filename) {
    if (typeof saveAs !== 'undefined') {
      saveAs(blob, filename);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  _mimeFor(format) {
    const map = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
      txt: 'text/plain', json: 'application/json', csv: 'text/csv',
      html: 'text/html', md: 'text/markdown', xml: 'application/xml',
      pdf: 'application/pdf', zip: 'application/zip',
      mp4: 'video/mp4', webm: 'video/webm',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    };
    return map[format.toLowerCase()] || null;
  }

  _formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

export const exportService = new ExportService();
