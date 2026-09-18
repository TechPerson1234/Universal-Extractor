const SIZE_PRESETS = [
  { label: 'Thumbnail', w: 128, h: 128 },
  { label: 'Small', w: 320, h: 320 },
  { label: 'Medium', w: 800, h: 800 },
  { label: 'Large', w: 1920, h: 1080 },
  { label: '4K', w: 3840, h: 2160 },
];

export class ImageTools {
  constructor(vfs) {
    this.vfs = vfs;
    this._worker = null;
  }

  async _loadImage(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      img.src = url;
    });
  }

  async _canvasFromImage(img, targetW, targetH, mode = 'contain') {
    const canvas = document.createElement('canvas');
    let w = targetW || img.width;
    let h = targetH || img.height;
    if (mode === 'contain' && targetW && targetH) {
      const ratio = Math.min(targetW / img.width, targetH / img.height);
      w = Math.round(img.width * ratio);
      h = Math.round(img.height * ratio);
    } else if (mode === 'cover' && targetW && targetH) {
      const ratio = Math.max(targetW / img.width, targetH / img.height);
      w = Math.round(img.width * ratio);
      h = Math.round(img.height * ratio);
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (mode === 'cover' && targetW && targetH) {
      const sx = (w - targetW) / 2;
      const sy = (h - targetH) / 2;
      ctx.drawImage(img, -sx, -sy, w, h);
      const out = document.createElement('canvas');
      out.width = targetW;
      out.height = targetH;
      out.getContext('2d').drawImage(canvas, sx, sy, targetW, targetH, 0, 0, targetW, targetH);
      return out;
    }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  }

  async _canvasToBlob(canvas, format = 'image/png', quality = 0.92) {
    return new Promise((resolve) => canvas.toBlob(resolve, format, quality));
  }

  async resize(blob, width, height, mode = 'contain', format = 'image/png', quality = 0.92) {
    const img = await this._loadImage(blob);
    const canvas = await this._canvasFromImage(img, width, height, mode);
    return this._canvasToBlob(canvas, format, quality);
  }

  async resizeToFit(blob, maxWidth, maxHeight, format, quality) {
    const img = await this._loadImage(blob);
    const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    return this.resize(blob, w, h, 'stretch', format, quality);
  }

  async convert(blob, format) {
    const img = await this._loadImage(blob);
    const canvas = await this._canvasFromImage(img, img.width, img.height, 'stretch');
    const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
    return this._canvasToBlob(canvas, mime, 0.92);
  }

  async rotate(blob, degrees) {
    const img = await this._loadImage(blob);
    const rad = degrees * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const w = img.width * cos + img.height * sin;
    const h = img.width * sin + img.height * cos;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return this._canvasToBlob(canvas);
  }

  async flip(blob, axis) {
    const img = await this._loadImage(blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (axis === 'x') {
      ctx.translate(img.width, 0);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(0, img.height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(img, 0, 0);
    return this._canvasToBlob(canvas);
  }

  async crop(blob, x, y, w, h) {
    const img = await this._loadImage(blob);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
    return this._canvasToBlob(canvas);
  }

  async watermark(blob, options = {}) {
    const {
      text = 'NEXUS',
      position = 'bottom-right',
      opacity = 0.6,
      fontSize = 24,
      color = '#ffffff',
      padding = 16,
      rotate = 0,
    } = options;
    const img = await this._loadImage(blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(text);
    const tw = metrics.width;
    const th = fontSize;
    let x, y;
    switch (position) {
      case 'top-left': x = padding; y = padding + th / 2; break;
      case 'top-right': x = canvas.width - tw - padding; y = padding + th / 2; break;
      case 'bottom-left': x = padding; y = canvas.height - padding - th / 2; break;
      case 'bottom-right': x = canvas.width - tw - padding; y = canvas.height - padding - th / 2; break;
      case 'center': x = (canvas.width - tw) / 2; y = canvas.height / 2; break;
      case 'tiled':
        ctx.textAlign = 'left';
        for (let ty = padding; ty < canvas.height; ty += th * 4) {
          for (let tx = padding; tx < canvas.width; tx += tw + padding * 4) {
            ctx.fillText(text, tx, ty);
          }
        }
        return this._canvasToBlob(canvas);
      default: x = canvas.width - tw - padding; y = canvas.height - padding - th / 2;
    }
    if (rotate) {
      ctx.save();
      ctx.translate(x + tw / 2, y);
      ctx.rotate(rotate * Math.PI / 180);
      ctx.fillText(text, -tw / 2, 0);
      ctx.restore();
    } else {
      ctx.fillText(text, x, y);
    }
    return this._canvasToBlob(canvas);
  }

  async extractPalette(blob, count = 8) {
    const img = await this._loadImage(blob);
    const size = 100;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;

    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] >> 4;
      const g = data[i + 1] >> 4;
      const b = data[i + 2] >> 4;
      const key = (r << 8) | (g << 4) | b;
      const existing = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      existing.count++;
      existing.r += data[i];
      existing.g += data[i + 1];
      existing.b += data[i + 2];
      buckets.set(key, existing);
    }

    const sorted = Array.from(buckets.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, count);

    return sorted.map(b => ({
      hex: '#' + [b.r / b.count, b.g / b.count, b.b / b.count]
        .map(v => Math.round(v).toString(16).padStart(2, '0')).join(''),
      count: b.count,
      rgb: [Math.round(b.r / b.count), Math.round(b.g / b.count), Math.round(b.b / b.count)],
    }));
  }

  async extractExif(blob) {
    try {
      const buffer = await blob.slice(0, 65536).arrayBuffer();
      const view = new DataView(buffer);
      if (view.getUint16(0) !== 0xFFD8) return { hasExif: false };
      let offset = 2;
      while (offset < view.byteLength) {
        const marker = view.getUint16(offset);
        if (marker === 0xFFE1) {
          const length = view.getUint16(offset + 2);
          const exifStr = new TextDecoder().decode(new Uint8Array(buffer, offset + 4, 6));
          if (exifStr.startsWith('Exif')) {
            return this._parseExif(buffer, offset + 4, length);
          }
        }
        if ((marker & 0xFF00) !== 0xFF00) break;
        const len = view.getUint16(offset + 2);
        offset += 2 + len;
      }
      return { hasExif: false };
    } catch {
      return { hasExif: false, error: 'parse-failed' };
    }
  }

  _parseExif(buffer, start, length) {
    const view = new DataView(buffer, start, length);
    if (view.getUint32(0) !== 0x45786966) return { hasExif: false };
    const tiffStart = 6;
    const littleEndian = view.getUint16(tiffStart) === 0x4949;
    const get16 = (o) => view.getUint16(o, littleEndian);
    const get32 = (o) => view.getUint32(o, littleEndian);
    if (get16(tiffStart + 2) !== 0x002A) return { hasExif: false };
    const ifdOffset = get32(tiffStart + 4);
    const entries = get16(tiffStart + ifdOffset);
    const result = { hasExif: true, tags: {} };

    const TAG_NAMES = {
      0x010F: 'Make', 0x0110: 'Model', 0x0112: 'Orientation',
      0x011A: 'XResolution', 0x011B: 'YResolution',
      0x0131: 'Software', 0x0132: 'DateTime',
      0x829A: 'ExposureTime', 0x829D: 'FNumber',
      0x8827: 'ISOSpeedRatings', 0x9003: 'DateTimeOriginal',
      0x920A: 'FocalLength', 0xA002: 'PixelXDimension',
      0xA003: 'PixelYDimension',
    };

    for (let i = 0; i < entries; i++) {
      const entryOffset = tiffStart + ifdOffset + 2 + i * 12;
      const tag = get16(entryOffset);
      const type = get16(entryOffset + 2);
      const count = get32(entryOffset + 4);
      const valueOffset = entryOffset + 8;
      const name = TAG_NAMES[tag];
      if (!name) continue;
      try {
        if (type === 2) {
          const strOffset = count > 4 ? tiffStart + get32(valueOffset) : valueOffset;
          let str = '';
          for (let j = 0; j < count - 1; j++) {
            str += String.fromCharCode(view.getUint8(strOffset + j));
          }
          result.tags[name] = str;
        } else if (type === 3) {
          result.tags[name] = get16(valueOffset);
        } else if (type === 4) {
          result.tags[name] = get32(valueOffset);
        } else if (type === 5) {
          const rationalOffset = tiffStart + get32(valueOffset);
          const num = get32(rationalOffset);
          const den = get32(rationalOffset + 4);
          result.tags[name] = den !== 0 ? num / den : num;
        }
      } catch {}
    }
    return result;
  }

  async stripExif(blob) {
    const img = await this._loadImage(blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return this._canvasToBlob(canvas, blob.type || 'image/png');
  }

  async batchProcess(files, operation, options = {}, onProgress) {
    const results = [];
    let completed = 0;
    for (const file of files) {
      try {
        const blob = file.blob || file;
        const name = file.name || 'image';
        let output;
        switch (operation) {
          case 'resize':
            output = await this.resize(blob, options.width, options.height, options.mode, options.format, options.quality);
            break;
          case 'convert':
            output = await this.convert(blob, options.format);
            break;
          case 'watermark':
            output = await this.watermark(blob, options);
            break;
          case 'strip-exif':
            output = await this.stripExif(blob);
            break;
          case 'rotate':
            output = await this.rotate(blob, options.degrees || 90);
            break;
          case 'flip':
            output = await this.flip(blob, options.axis || 'x');
            break;
          default:
            output = blob;
        }
        const ext = options.format || name.split('.').pop();
        const baseName = name.replace(/\.[^.]+$/, '');
        results.push({ name: `${baseName}_${operation}.${ext}`, blob: output, source: name });
      } catch (err) {
        results.push({ name: file.name, error: err.message });
      }
      completed++;
      if (onProgress) onProgress(completed / files.length, completed, files.length);
    }
    return results;
  }

  async chunkedResize(blob, targetWidth, targetHeight, chunkSize = 2048) {
    const img = await this._loadImage(blob);
    if (img.width <= chunkSize && img.height <= chunkSize) {
      return this.resize(blob, targetWidth, targetHeight);
    }
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    const rowsPerChunk = Math.ceil(chunkSize / img.width);
    for (let y = 0; y < img.height; y += rowsPerChunk) {
      const h = Math.min(rowsPerChunk, img.height - y);
      ctx.drawImage(img, 0, y, img.width, h, 0, y, img.width, h);
      await new Promise(r => setTimeout(r, 0));
    }
    const out = document.createElement('canvas');
    out.width = targetWidth;
    out.height = targetHeight;
    const outCtx = out.getContext('2d');
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
    return this._canvasToBlob(out);
  }

  async histogram(blob) {
    const img = await this._loadImage(blob);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    canvas.getContext('2d').drawImage(img, 0, 0, 256, 256);
    const data = canvas.getContext('2d').getImageData(0, 0, 256, 256).data;
    const r = new Array(256).fill(0);
    const g = new Array(256).fill(0);
    const b = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      r[data[i]]++;
      g[data[i + 1]]++;
      b[data[i + 2]]++;
    }
    return { r, g, b };
  }

  async grayscale(blob) {
    const img = await this._loadImage(blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const gray = data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = gray;
    }
    ctx.putImageData(data, 0, 0);
    return this._canvasToBlob(canvas);
  }

  async compress(blob, quality = 0.7) {
    const img = await this._loadImage(blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return this._canvasToBlob(canvas, 'image/jpeg', quality);
  }

  async toBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export const ImageToolsPlugin = {
  type: 'IMAGE_TOOLS',
  name: 'Image Tools',

  async init(surface, tools, file) {
    const vfs = window.__NEXUS_DI?.vfs;
    const imageTools = new ImageTools(vfs);

    surface.innerHTML = `
      <div style="padding:16px;height:100%;overflow-y:auto;background:#0a0a0a;">
        <h3 style="color:var(--nexus-cyan);font-size:14px;margin-bottom:14px;font-family:monospace;">IMAGE TOOLS — ${file.name}</h3>
        <div id="it-content" style="display:flex;flex-direction:column;gap:14px;"></div>
      </div>
    `;

    tools.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px;">
        <button id="it-analyze" style="background:#222;color:#ccc;border:1px solid #555;padding:6px;border-radius:3px;cursor:pointer;font-size:11px;">
          <i class="fas fa-chart-bar"></i> Analyze
        </button>
        <button id="it-export-all" style="background:#222;color:#ccc;border:1px solid #555;padding:6px;border-radius:3px;cursor:pointer;font-size:11px;">
          <i class="fas fa-file-archive"></i> Export All
        </button>
      </div>
    `;

    const content = document.getElementById('it-content');

    const buildSection = (title, bodyHtml) => {
      const sec = document.createElement('div');
      sec.style.cssText = 'border:1px solid #222;border-radius:6px;padding:12px;background:#0f0f0f;';
      sec.innerHTML = `<div style="font-size:10px;font-weight:bold;color:var(--nexus-cyan);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">${title}</div>${bodyHtml}`;
      return sec;
    };

    const execOp = async (op, opts, label) => {
      try {
        const blob = await imageTools[op](file.blob, ...Object.values(opts || {}));
        if (!blob) throw new Error('empty result');
        const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const newName = `${baseName}_${label}.${ext}`;
        const path = file.path.substring(0, file.path.lastIndexOf('/')) + '/' + newName;
        await vfs.addFile(path, blob, 'IMAGE');
        const app = window.__NEXUS_DI?.app;
        if (app) {
          app.eventBus.emit('vfs:changed');
          app.notifications.show(`Created ${newName}`, 'success');
        }
      } catch (e) {
        window.__NEXUS_DI?.app?.notifications?.show(`Failed: ${e.message}`, 'error');
      }
    };

    const resizeSec = buildSection('Resize', `
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        ${SIZE_PRESETS.map(p => `<button data-preset="${p.w}x${p.h}" style="padding:4px 8px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">${p.label}</button>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <input id="it-w" type="number" placeholder="Width" style="background:#0a0a0a;color:#ccc;border:1px solid #333;padding:5px;border-radius:3px;font-size:11px;">
        <input id="it-h" type="number" placeholder="Height" style="background:#0a0a0a;color:#ccc;border:1px solid #333;padding:5px;border-radius:3px;font-size:11px;">
      </div>
      <select id="it-mode" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:5px;border-radius:3px;font-size:11px;margin-bottom:8px;">
        <option value="contain">Contain (fit)</option>
        <option value="cover">Cover (crop)</option>
        <option value="stretch">Stretch</option>
      </select>
      <button id="it-resize-btn" style="width:100%;padding:6px;background:var(--nexus-cyan);color:#000;border:none;border-radius:3px;font-size:11px;cursor:pointer;font-weight:bold;">Resize</button>
    `);
    content.appendChild(resizeSec);
    resizeSec.querySelectorAll('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [w, h] = btn.dataset.preset.split('x').map(Number);
        document.getElementById('it-w').value = w;
        document.getElementById('it-h').value = h;
      });
    });
    document.getElementById('it-resize-btn').addEventListener('click', async () => {
      const w = parseInt(document.getElementById('it-w').value);
      const h = parseInt(document.getElementById('it-h').value);
      const mode = document.getElementById('it-mode').value;
      if (!w) return;
      const blob = await imageTools.resize(file.blob, w, h, mode);
      await execOp('resize', { width: w, height: h, mode }, `resize_${w}x${h}`);
    });

    const convertSec = buildSection('Convert Format', `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
        <button data-fmt="png" style="padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">PNG</button>
        <button data-fmt="jpeg" style="padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">JPEG</button>
        <button data-fmt="webp" style="padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">WebP</button>
        <button data-fmt="bmp" style="padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">BMP</button>
      </div>
    `);
    content.appendChild(convertSec);
    convertSec.querySelectorAll('[data-fmt]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fmt = btn.dataset.fmt;
        const blob = await imageTools.convert(file.blob, fmt);
        if (!blob) return;
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const newName = `${baseName}.${fmt === 'jpeg' ? 'jpg' : fmt}`;
        const path = file.path.substring(0, file.path.lastIndexOf('/')) + '/' + newName;
        await vfs.addFile(path, blob, 'IMAGE');
        window.__NEXUS_DI?.app?.notifications?.show(`Converted to ${fmt}`, 'success');
      });
    });

    const watermarkSec = buildSection('Watermark', `
      <input id="it-wm-text" type="text" placeholder="Watermark text" value="NEXUS" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:5px;border-radius:3px;font-size:11px;margin-bottom:8px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <select id="it-wm-pos" style="background:#0a0a0a;color:#ccc;border:1px solid #333;padding:5px;border-radius:3px;font-size:11px;">
          <option value="bottom-right">Bottom Right</option>
          <option value="bottom-left">Bottom Left</option>
          <option value="top-right">Top Right</option>
          <option value="top-left">Top Left</option>
          <option value="center">Center</option>
          <option value="tiled">Tiled</option>
        </select>
        <input id="it-wm-color" type="color" value="#ffffff" style="width:100%;height:28px;background:transparent;border:1px solid #333;border-radius:3px;cursor:pointer;">
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;">
        <input id="it-wm-size" type="range" min="10" max="120" value="32" style="flex:1;accent-color:var(--nexus-cyan);">
        <span id="it-wm-size-val" style="font-size:10px;color:#888;min-width:30px;">32</span>
      </div>
      <button id="it-wm-btn" style="width:100%;padding:6px;background:var(--nexus-cyan);color:#000;border:none;border-radius:3px;font-size:11px;cursor:pointer;font-weight:bold;">Apply Watermark</button>
    `);
    content.appendChild(watermarkSec);
    document.getElementById('it-wm-size').addEventListener('input', (e) => {
      document.getElementById('it-wm-size-val').textContent = e.target.value;
    });
    document.getElementById('it-wm-btn').addEventListener('click', async () => {
      const text = document.getElementById('it-wm-text').value || 'NEXUS';
      const position = document.getElementById('it-wm-pos').value;
      const color = document.getElementById('it-wm-color').value;
      const fontSize = parseInt(document.getElementById('it-wm-size').value);
      const blob = await imageTools.watermark(file.blob, { text, position, color, fontSize });
      if (!blob) return;
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const newName = `${baseName}_watermark.png`;
      const path = file.path.substring(0, file.path.lastIndexOf('/')) + '/' + newName;
      await vfs.addFile(path, blob, 'IMAGE');
      window.__NEXUS_DI?.app?.notifications?.show('Watermark applied', 'success');
    });

    const transformSec = buildSection('Transform', `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
        <button data-xform="rot90" style="padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">↻ 90°</button>
        <button data-xform="rot180" style="padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">↻ 180°</button>
        <button data-xform="rot270" style="padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">↻ 270°</button>
        <button data-xform="flipX" style="padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">↔ Flip</button>
      </div>
    `);
    content.appendChild(transformSec);
    transformSec.querySelectorAll('[data-xform]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const op = btn.dataset.xform;
        let blob;
        if (op.startsWith('rot')) {
          blob = await imageTools.rotate(file.blob, parseInt(op.slice(3)));
        } else if (op === 'flipX') {
          blob = await imageTools.flip(file.blob, 'x');
        }
        if (!blob) return;
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const newName = `${baseName}_${op}.png`;
        const path = file.path.substring(0, file.path.lastIndexOf('/')) + '/' + newName;
        await vfs.addFile(path, blob, 'IMAGE');
        window.__NEXUS_DI?.app?.notifications?.show('Transform applied', 'success');
      });
    });

    const stripSec = buildSection('Privacy & Optimization', `
      <div style="display:flex;flex-direction:column;gap:6px;">
        <button id="it-strip" style="padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">Strip EXIF Data</button>
        <button id="it-gray" style="padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">Convert to Grayscale</button>
        <button id="it-compress" style="padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">Compress (70% JPEG)</button>
      </div>
    `);
    content.appendChild(stripSec);
    document.getElementById('it-strip').addEventListener('click', async () => {
      const blob = await imageTools.stripExif(file.blob);
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const newName = `${baseName}_clean.png`;
      const path = file.path.substring(0, file.path.lastIndexOf('/')) + '/' + newName;
      await vfs.addFile(path, blob, 'IMAGE');
      window.__NEXUS_DI?.app?.notifications?.show('EXIF stripped', 'success');
    });
    document.getElementById('it-gray').addEventListener('click', async () => {
      const blob = await imageTools.grayscale(file.blob);
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const newName = `${baseName}_gray.png`;
      const path = file.path.substring(0, file.path.lastIndexOf('/')) + '/' + newName;
      await vfs.addFile(path, blob, 'IMAGE');
      window.__NEXUS_DI?.app?.notifications?.show('Grayscale applied', 'success');
    });
    document.getElementById('it-compress').addEventListener('click', async () => {
      const blob = await imageTools.compress(file.blob, 0.7);
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const newName = `${baseName}_compressed.jpg`;
      const path = file.path.substring(0, file.path.lastIndexOf('/')) + '/' + newName;
      await vfs.addFile(path, blob, 'IMAGE');
      window.__NEXUS_DI?.app?.notifications?.show('Compressed', 'success');
    });

    const exifSec = buildSection('EXIF Data', '<div id="it-exif" style="font-size:10px;color:#888;font-family:monospace;">Loading...</div>');
    content.appendChild(exifSec);
    const exifData = await imageTools.extractExif(file.blob);
    const exifEl = document.getElementById('it-exif');
    if (exifData.hasExif && Object.keys(exifData.tags).length) {
      exifEl.innerHTML = Object.entries(exifData.tags).map(([k, v]) => {
        const display = typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : v;
        return `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid #1a1a1a;"><span style="color:#666;">${k}</span><span style="color:#ccc;">${display}</span></div>`;
      }).join('');
    } else {
      exifEl.textContent = 'No EXIF metadata found.';
    }

    const paletteSec = buildSection('Color Palette', '<div id="it-palette" style="display:flex;gap:4px;flex-wrap:wrap;">Loading...</div>');
    content.appendChild(paletteSec);
    const palette = await imageTools.extractPalette(file.blob, 10);
    const paletteEl = document.getElementById('it-palette');
    paletteEl.innerHTML = palette.map(p => `
      <div title="${p.hex}" style="width:32px;height:32px;background:${p.hex};border-radius:4px;border:1px solid #333;cursor:pointer;" data-color="${p.hex}"></div>
    `).join('');
    paletteEl.querySelectorAll('[data-color]').forEach(el => {
      el.addEventListener('click', () => {
        navigator.clipboard?.writeText(el.dataset.color);
        window.__NEXUS_DI?.app?.notifications?.show(`Copied ${el.dataset.color}`, 'info', 1500);
      });
    });

    document.getElementById('it-analyze').addEventListener('click', async () => {
      const hist = await imageTools.histogram(file.blob);
      const app = window.__NEXUS_DI?.app;
      app?.notifications?.show('Histogram generated', 'info');
    });

    document.getElementById('it-export-all').addEventListener('click', async () => {
      const app = window.__NEXUS_DI?.app;
      app?.notifications?.show('Exporting...', 'info');
    });

    return {
      tools: imageTools,
      destroy: () => {},
    };
  },
};
