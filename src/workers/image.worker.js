"use strict";

const CONVOLUTION_KERNELS = {
  sharpen: [0, -1, 0, -1, 5, -1, 0, -1, 0],
  emboss: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
  edge: [0, 1, 0, 1, -4, 1, 0, 1, 0],
  edge2: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
  blur: [1/9, 1/9, 1/9, 1/9, 1/9, 1/9, 1/9, 1/9, 1/9],
  gaussian: [1/16, 2/16, 1/16, 2/16, 4/16, 2/16, 1/16, 2/16, 1/16],
  outline: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
};

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function applyConvolve(src, width, height, kernel) {
  const out = new Uint8ClampedArray(src.length);
  const kSize = 3;
  const half = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < kSize; ky++) {
        for (let kx = 0; kx < kSize; kx++) {
          const ny = y + ky - half;
          const nx = x + kx - half;
          if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
          const k = kernel[ky * kSize + kx];
          const idx = (ny * width + nx) * 4;
          r += src[idx] * k;
          g += src[idx + 1] * k;
          b += src[idx + 2] * k;
        }
      }
      const idx = (y * width + x) * 4;
      out[idx] = clamp255(r);
      out[idx + 1] = clamp255(g);
      out[idx + 2] = clamp255(b);
      out[idx + 3] = src[idx + 3];
    }
  }
  return out;
}

function applyBoxBlur(src, width, height, radius) {
  radius = Math.max(1, Math.min(32, radius | 0));
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      for (let ny = y0; ny <= y1; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          const idx = (ny * width + nx) * 4;
          r += src[idx];
          g += src[idx + 1];
          b += src[idx + 2];
          a += src[idx + 3];
          count++;
        }
      }
      const idx = (y * width + x) * 4;
      out[idx] = r / count;
      out[idx + 1] = g / count;
      out[idx + 2] = b / count;
      out[idx + 3] = a / count;
    }
  }
  return out;
}

function bilinearResize(src, srcW, srcH, dstW, dstH) {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = y * yRatio;
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const dy = sy - y0;
    for (let x = 0; x < dstW; x++) {
      const sx = x * xRatio;
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const dx = sx - x0;
      const i00 = (y0 * srcW + x0) * 4;
      const i01 = (y0 * srcW + x1) * 4;
      const i10 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;
      const w00 = (1 - dx) * (1 - dy);
      const w01 = dx * (1 - dy);
      const w10 = (1 - dx) * dy;
      const w11 = dx * dy;
      const dstIdx = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c++) {
        out[dstIdx + c] =
          src[i00 + c] * w00 +
          src[i01 + c] * w01 +
          src[i10 + c] * w10 +
          src[i11 + c] * w11;
      }
    }
  }
  return out;
}

function nearestResize(src, srcW, srcH, dstW, dstH) {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(y * yRatio));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x * xRatio));
      const sIdx = (sy * srcW + sx) * 4;
      const dIdx = (y * dstW + x) * 4;
      out[dIdx] = src[sIdx];
      out[dIdx + 1] = src[sIdx + 1];
      out[dIdx + 2] = src[sIdx + 2];
      out[dIdx + 3] = src[sIdx + 3];
    }
  }
  return out;
}

function resizeImage(src, srcW, srcH, dstW, dstH, quality) {
  if (quality === 'nearest') return nearestResize(src, srcW, srcH, dstW, dstH);
  return bilinearResize(src, srcW, srcH, dstW, dstH);
}

function cropImage(src, srcW, srcH, x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    const sy = Math.min(srcH - 1, y + j);
    for (let i = 0; i < w; i++) {
      const sx = Math.min(srcW - 1, x + i);
      const sIdx = (sy * srcW + sx) * 4;
      const dIdx = (j * w + i) * 4;
      out[dIdx] = src[sIdx];
      out[dIdx + 1] = src[sIdx + 1];
      out[dIdx + 2] = src[sIdx + 2];
      out[dIdx + 3] = src[sIdx + 3];
    }
  }
  return out;
}

function rotateImage(src, w, h, degrees) {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const newW = Math.round(Math.abs(w * cos) + Math.abs(h * sin));
  const newH = Math.round(Math.abs(w * sin) + Math.abs(h * cos));
  const out = new Uint8ClampedArray(newW * newH * 4);
  const cx = w / 2;
  const cy = h / 2;
  const ncx = newW / 2;
  const ncy = newH / 2;
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const dx = x - ncx;
      const dy = y - ncy;
      const sx = Math.round(cx + dx * cos + dy * sin);
      const sy = Math.round(cy - dx * sin + dy * cos);
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
      const sIdx = (sy * w + sx) * 4;
      const dIdx = (y * newW + x) * 4;
      out[dIdx] = src[sIdx];
      out[dIdx + 1] = src[sIdx + 1];
      out[dIdx + 2] = src[sIdx + 2];
      out[dIdx + 3] = src[sIdx + 3];
    }
  }
  return { data: out, width: newW, height: newH };
}

function flipImage(src, w, h, axis) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = axis === 'x' ? w - 1 - x : x;
      const sy = axis === 'y' ? h - 1 - y : y;
      const sIdx = (sy * w + sx) * 4;
      const dIdx = (y * w + x) * 4;
      out[dIdx] = src[sIdx];
      out[dIdx + 1] = src[sIdx + 1];
      out[dIdx + 2] = src[sIdx + 2];
      out[dIdx + 3] = src[sIdx + 3];
    }
  }
  return out;
}

function applyFilter(src, width, height, filter, params = {}) {
  const out = new Uint8ClampedArray(src.length);
  const amount = params.amount ?? 0;

  switch (filter) {
    case 'invert':
      for (let i = 0; i < src.length; i += 4) {
        out[i] = 255 - src[i];
        out[i + 1] = 255 - src[i + 1];
        out[i + 2] = 255 - src[i + 2];
        out[i + 3] = src[i + 3];
      }
      break;

    case 'grayscale':
      for (let i = 0; i < src.length; i += 4) {
        const g = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
        out[i] = out[i + 1] = out[i + 2] = g;
        out[i + 3] = src[i + 3];
      }
      break;

    case 'sepia':
      for (let i = 0; i < src.length; i += 4) {
        const r = src[i], g = src[i + 1], b = src[i + 2];
        out[i] = clamp255(r * 0.393 + g * 0.769 + b * 0.189);
        out[i + 1] = clamp255(r * 0.349 + g * 0.686 + b * 0.168);
        out[i + 2] = clamp255(r * 0.272 + g * 0.534 + b * 0.131);
        out[i + 3] = src[i + 3];
      }
      break;

    case 'brightness':
      for (let i = 0; i < src.length; i += 4) {
        out[i] = clamp255(src[i] + amount);
        out[i + 1] = clamp255(src[i + 1] + amount);
        out[i + 2] = clamp255(src[i + 2] + amount);
        out[i + 3] = src[i + 3];
      }
      break;

    case 'contrast': {
      const f = (259 * (amount + 255)) / (255 * (259 - amount));
      for (let i = 0; i < src.length; i += 4) {
        out[i] = clamp255(f * (src[i] - 128) + 128);
        out[i + 1] = clamp255(f * (src[i + 1] - 128) + 128);
        out[i + 2] = clamp255(f * (src[i + 2] - 128) + 128);
        out[i + 3] = src[i + 3];
      }
      break;
    }

    case 'saturation': {
      const s = 1 + amount / 100;
      for (let i = 0; i < src.length; i += 4) {
        const gray = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
        out[i] = clamp255(gray + (src[i] - gray) * s);
        out[i + 1] = clamp255(gray + (src[i + 1] - gray) * s);
        out[i + 2] = clamp255(gray + (src[i + 2] - gray) * s);
        out[i + 3] = src[i + 3];
      }
      break;
    }

    case 'hue': {
      const shift = amount / 360;
      for (let i = 0; i < src.length; i += 4) {
        const [h, s, l] = rgbToHsl(src[i], src[i + 1], src[i + 2]);
        const [r, g, b] = hslToRgb((h + shift + 1) % 1, s, l);
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = src[i + 3];
      }
      break;
    }

    case 'gamma': {
      const g = amount || 1;
      const lut = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) {
        lut[i] = 255 * Math.pow(i / 255, 1 / g);
      }
      for (let i = 0; i < src.length; i += 4) {
        out[i] = lut[src[i]];
        out[i + 1] = lut[src[i + 1]];
        out[i + 2] = lut[src[i + 2]];
        out[i + 3] = src[i + 3];
      }
      break;
    }

    case 'blur':
      return applyBoxBlur(src, width, height, params.radius || amount || 2);

    case 'sharpen':
    case 'emboss':
    case 'edge':
    case 'edge2':
    case 'outline':
      return applyConvolve(src, width, height, CONVOLUTION_KERNELS[filter] || CONVOLUTION_KERNELS.sharpen);

    case 'gaussian':
      return applyConvolve(src, width, height, CONVOLUTION_KERNELS.gaussian);

    case 'noise': {
      const intensity = amount || 30;
      for (let i = 0; i < src.length; i += 4) {
        const n = (Math.random() - 0.5) * intensity * 2;
        out[i] = clamp255(src[i] + n);
        out[i + 1] = clamp255(src[i + 1] + n);
        out[i + 2] = clamp255(src[i + 2] + n);
        out[i + 3] = src[i + 3];
      }
      break;
    }

    case 'pixelate': {
      const blockSize = Math.max(2, amount || 8);
      for (let y = 0; y < height; y += blockSize) {
        for (let x = 0; x < width; x += blockSize) {
          let r = 0, g = 0, b = 0, a = 0, count = 0;
          for (let by = 0; by < blockSize && y + by < height; by++) {
            for (let bx = 0; bx < blockSize && x + bx < width; bx++) {
              const idx = ((y + by) * width + (x + bx)) * 4;
              r += src[idx];
              g += src[idx + 1];
              b += src[idx + 2];
              a += src[idx + 3];
              count++;
            }
          }
          const avgR = r / count, avgG = g / count, avgB = b / count, avgA = a / count;
          for (let by = 0; by < blockSize && y + by < height; by++) {
            for (let bx = 0; bx < blockSize && x + bx < width; bx++) {
              const idx = ((y + by) * width + (x + bx)) * 4;
              out[idx] = avgR;
              out[idx + 1] = avgG;
              out[idx + 2] = avgB;
              out[idx + 3] = avgA;
            }
          }
        }
      }
      break;
    }

    case 'tint': {
      const { r: tr = 0, g: tg = 0, b: tb = 0 } = params;
      const alpha = (params.intensity ?? 50) / 100;
      for (let i = 0; i < src.length; i += 4) {
        out[i] = src[i] + (tr - src[i]) * alpha;
        out[i + 1] = src[i + 1] + (tg - src[i + 1]) * alpha;
        out[i + 2] = src[i + 2] + (tb - src[i + 2]) * alpha;
        out[i + 3] = src[i + 3];
      }
      break;
    }

    case 'threshold': {
      const t = amount || 128;
      for (let i = 0; i < src.length; i += 4) {
        const g = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
        const v = g >= t ? 255 : 0;
        out[i] = out[i + 1] = out[i + 2] = v;
        out[i + 3] = src[i + 3];
      }
      break;
    }

    case 'posterize': {
      const levels = Math.max(2, amount || 6);
      const step = 255 / (levels - 1);
      for (let i = 0; i < src.length; i += 4) {
        out[i] = Math.round(src[i] / step) * step;
        out[i + 1] = Math.round(src[i + 1] / step) * step;
        out[i + 2] = Math.round(src[i + 2] / step) * step;
        out[i + 3] = src[i + 3];
      }
      break;
    }

    case 'vignette': {
      const strength = (amount || 50) / 100;
      const cx = width / 2;
      const cy = height / 2;
      const maxDist = Math.sqrt(cx * cx + cy * cy);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
          const factor = 1 - strength * Math.pow(dist, 2);
          const idx = (y * width + x) * 4;
          out[idx] = clamp255(src[idx] * factor);
          out[idx + 1] = clamp255(src[idx + 1] * factor);
          out[idx + 2] = clamp255(src[idx + 2] * factor);
          out[idx + 3] = src[idx + 3];
        }
      }
      break;
    }

    case 'temperature': {
      const shift = amount || 0;
      for (let i = 0; i < src.length; i += 4) {
        out[i] = clamp255(src[i] + shift);
        out[i + 1] = src[i + 1];
        out[i + 2] = clamp255(src[i + 2] - shift);
        out[i + 3] = src[i + 3];
      }
      break;
    }

    default:
      out.set(src);
  }
  return out;
}

function extractPalette(src, pixelCount, colorCount) {
  const buckets = new Map();
  const stride = Math.max(1, Math.floor(pixelCount / 10000));
  for (let i = 0; i < src.length; i += 4 * stride) {
    const r = src[i] >> 4;
    const g = src[i + 1] >> 4;
    const b = src[i + 2] >> 4;
    const key = (r << 8) | (g << 4) | b;
    const entry = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    entry.count++;
    entry.r += src[i];
    entry.g += src[i + 1];
    entry.b += src[i + 2];
    buckets.set(key, entry);
  }
  const sorted = Array.from(buckets.values()).sort((a, b) => b.count - a.count).slice(0, colorCount);
  return sorted.map((b) => ({
    r: Math.round(b.r / b.count),
    g: Math.round(b.g / b.count),
    b: Math.round(b.b / b.count),
    count: b.count,
    hex: '#' + [b.r / b.count, b.g / b.count, b.b / b.count]
      .map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''),
  }));
}

function computeHistogram(src) {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const lum = new Uint32Array(256);
  for (let i = 0; i < src.length; i += 4) {
    r[src[i]]++;
    g[src[i + 1]]++;
    b[src[i + 2]]++;
    const l = Math.round(src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114);
    lum[l]++;
  }
  return { r, g, b, lum };
}

function computeAverageColor(src) {
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < src.length; i += 4) {
    r += src[i];
    g += src[i + 1];
    b += src[i + 2];
    count++;
  }
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

function watermarkOverlay(src, w, h, opts) {
  const out = new Uint8ClampedArray(src);
  const {
    text = 'NEXUS',
    color = [255, 255, 255],
    opacity = 0.6,
    position = 'bottom-right',
    scale = 0.05,
  } = opts;
  const fontSize = Math.max(8, Math.floor(Math.min(w, h) * scale));
  const strokeW = Math.max(1, Math.floor(fontSize / 12));
  const textWidth = Math.floor(text.length * fontSize * 0.6);
  const textHeight = fontSize;
  const margin = Math.floor(Math.min(w, h) * 0.03);

  let startX, startY;
  switch (position) {
    case 'top-left': startX = margin; startY = margin; break;
    case 'top-right': startX = w - textWidth - margin; startY = margin; break;
    case 'bottom-left': startX = margin; startY = h - textHeight - margin; break;
    case 'bottom-right': startX = w - textWidth - margin; startY = h - textHeight - margin; break;
    case 'center': startX = (w - textWidth) / 2; startY = (h - textHeight) / 2; break;
    default: startX = margin; startY = margin;
  }

  const [cr, cg, cb] = color;
  for (let y = 0; y < textHeight; y++) {
    for (let x = 0; x < textWidth; x++) {
      const px = Math.floor(startX + x);
      const py = Math.floor(startY + y);
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const inChar = ((x / fontSize) | 0) % 2 === 0 && ((y / fontSize) | 0) % 2 === 0;
      if (inChar) {
        const idx = (py * w + px) * 4;
        out[idx] = out[idx] * (1 - opacity) + cr * opacity;
        out[idx + 1] = out[idx + 1] * (1 - opacity) + cg * opacity;
        out[idx + 2] = out[idx + 2] * (1 - opacity) + cb * opacity;
      }
    }
  }
  return out;
}

function autoLevel(src, w, h) {
  let minR = 255, minG = 255, minB = 255;
  let maxR = 0, maxG = 0, maxB = 0;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i] < minR) minR = src[i];
    if (src[i] > maxR) maxR = src[i];
    if (src[i + 1] < minG) minG = src[i + 1];
    if (src[i + 1] > maxG) maxG = src[i + 1];
    if (src[i + 2] < minB) minB = src[i + 2];
    if (src[i + 2] > maxB) maxB = src[i + 2];
  }
  const rangeR = maxR - minR || 1;
  const rangeG = maxG - minG || 1;
  const rangeB = maxB - minB || 1;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    out[i] = ((src[i] - minR) / rangeR) * 255;
    out[i + 1] = ((src[i + 1] - minG) / rangeG) * 255;
    out[i + 2] = ((src[i + 2] - minB) / rangeB) * 255;
    out[i + 3] = src[i + 3];
  }
  return out;
}

const handlers = {
  async filter(data) {
    const { pixels, width, height, filter, params } = data;
    const src = new Uint8ClampedArray(pixels);
    const out = applyFilter(src, width, height, filter, params);
    return { data: out.buffer, width, height };
  },

  async filterChain(data) {
    const { pixels, width, height, chain } = data;
    let src = new Uint8ClampedArray(pixels);
    for (const step of chain) {
      src = applyFilter(src, width, height, step.filter, step.params || {});
    }
    return { data: src.buffer, width, height };
  },

  async resize(data) {
    const { pixels, srcWidth, srcHeight, dstWidth, dstHeight, quality } = data;
    const src = new Uint8ClampedArray(pixels);
    const out = resizeImage(src, srcWidth, srcHeight, dstWidth, dstHeight, quality);
    return { data: out.buffer, width: dstWidth, height: dstHeight };
  },

  async crop(data) {
    const { pixels, srcWidth, srcHeight, x, y, width, height } = data;
    const src = new Uint8ClampedArray(pixels);
    const out = cropImage(src, srcWidth, srcHeight, x, y, width, height);
    return { data: out.buffer, width, height };
  },

  async rotate(data) {
    const { pixels, width, height, degrees } = data;
    const src = new Uint8ClampedArray(pixels);
    const result = rotateImage(src, width, height, degrees);
    return { data: result.data.buffer, width: result.width, height: result.height };
  },

  async flip(data) {
    const { pixels, width, height, axis } = data;
    const src = new Uint8ClampedArray(pixels);
    const out = flipImage(src, width, height, axis);
    return { data: out.buffer, width, height };
  },

  async palette(data) {
    const { pixels, colorCount } = data;
    const src = new Uint8ClampedArray(pixels);
    const palette = extractPalette(src, pixels.byteLength / 4, colorCount || 8);
    return { palette };
  },

  async histogram(data) {
    const { pixels } = data;
    const src = new Uint8ClampedArray(pixels);
    const hist = computeHistogram(src);
    return {
      r: Array.from(hist.r),
      g: Array.from(hist.g),
      b: Array.from(hist.b),
      lum: Array.from(hist.lum),
    };
  },

  async averageColor(data) {
    const { pixels } = data;
    const src = new Uint8ClampedArray(pixels);
    return computeAverageColor(src);
  },

  async watermark(data) {
    const { pixels, width, height, options } = data;
    const src = new Uint8ClampedArray(pixels);
    const out = watermarkOverlay(src, width, height, options || {});
    return { data: out.buffer, width, height };
  },

  async autoLevel(data) {
    const { pixels, width, height } = data;
    const src = new Uint8ClampedArray(pixels);
    const out = autoLevel(src, width, height);
    return { data: out.buffer, width, height };
  },

  async rotate90(data) {
    const { pixels, width, height } = data;
    const src = new Uint8ClampedArray(pixels);
    const newW = height;
    const newH = width;
    const out = new Uint8ClampedArray(newW * newH * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sIdx = (y * width + x) * 4;
        const nx = height - 1 - y;
        const ny = x;
        const dIdx = (ny * newW + nx) * 4;
        out[dIdx] = src[sIdx];
        out[dIdx + 1] = src[sIdx + 1];
        out[dIdx + 2] = src[sIdx + 2];
        out[dIdx + 3] = src[sIdx + 3];
      }
    }
    return { data: out.buffer, width: newW, height: newH };
  },

  async batchFilter(data) {
    const { tiles, filter, params } = data;
    const results = [];
    for (const tile of tiles) {
      const src = new Uint8ClampedArray(tile.pixels);
      const out = applyFilter(src, tile.width, tile.height, filter, params);
      results.push({ data: out.buffer, width: tile.width, height: tile.height, offsetY: tile.offsetY });
    }
    return { tiles: results };
  },

  async createThumbnail(data) {
    const { pixels, width, height, maxSize } = data;
    const src = new Uint8ClampedArray(pixels);
    const ratio = Math.min(maxSize / width, maxSize / height, 1);
    const tw = Math.max(1, Math.round(width * ratio));
    const th = Math.max(1, Math.round(height * ratio));
    const out = bilinearResize(src, width, height, tw, th);
    return { data: out.buffer, width: tw, height: th };
  },

  async pixelPerfectCompare(data) {
    const { pixelsA, pixelsB } = data;
    const a = new Uint8ClampedArray(pixelsA);
    const b = new Uint8ClampedArray(pixelsB);
    if (a.length !== b.length) return { identical: false, diffCount: -1 };
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diff++;
    }
    return { identical: diff === 0, diffCount: diff };
  },

  async dominantColor(data) {
    const { pixels, count } = data;
    const src = new Uint8ClampedArray(pixels);
    return { colors: extractPalette(src, src.length / 4, count || 5) };
  },

  async colorAdjust(data) {
    const { pixels, width, height, adjustments } = data;
    const src = new Uint8ClampedArray(pixels);
    const out = new Uint8ClampedArray(src.length);
    const {
      brightness = 0, contrast = 0, saturation = 0,
      red = 0, green = 0, blue = 0,
    } = adjustments || {};
    const cF = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const sFactor = 1 + saturation / 100;
    for (let i = 0; i < src.length; i += 4) {
      let r = src[i] + red;
      let g = src[i + 1] + green;
      let b = src[i + 2] + blue;
      r = cF * (r - 128) + 128 + brightness;
      g = cF * (g - 128) + 128 + brightness;
      b = cF * (b - 128) + 128 + brightness;
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      r = gray + (r - gray) * sFactor;
      g = gray + (g - gray) * sFactor;
      b = gray + (b - gray) * sFactor;
      out[i] = clamp255(r);
      out[i + 1] = clamp255(g);
      out[i + 2] = clamp255(b);
      out[i + 3] = src[i + 3];
    }
    return { data: out.buffer, width, height };
  },

  async sharpenMask(data) {
    const { pixels, width, height, amount } = data;
    const src = new Uint8ClampedArray(pixels);
    const blurred = applyBoxBlur(src, width, height, 2);
    const out = new Uint8ClampedArray(src.length);
    const a = Math.max(0, Math.min(2, amount || 1));
    for (let i = 0; i < src.length; i += 4) {
      out[i] = clamp255(src[i] + (src[i] - blurred[i]) * a);
      out[i + 1] = clamp255(src[i + 1] + (src[i + 1] - blurred[i + 1]) * a);
      out[i + 2] = clamp255(src[i + 2] + (src[i + 2] - blurred[i + 2]) * a);
      out[i + 3] = src[i + 3];
    }
    return { data: out.buffer, width, height };
  },
};

self.onmessage = async function (e) {
  const { taskId, operation, data } = e.data;
  try {
    const handler = handlers[operation];
    if (!handler) throw new Error('Unknown operation: ' + operation);
    const result = await handler(data || {});
    const transfers = [];
    if (result && typeof result === 'object') {
      for (const key of Object.keys(result)) {
        const v = result[key];
        if (v instanceof ArrayBuffer) transfers.push(v);
        else if (Array.isArray(v)) {
          for (const item of v) {
            if (item && item.data instanceof ArrayBuffer) transfers.push(item.data);
          }
        }
      }
    }
    self.postMessage({ taskId, result }, transfers);
  } catch (err) {
    self.postMessage({ taskId, error: err.message || String(err) });
  }
};

self.postMessage({ type: 'ready', worker: 'image' });
