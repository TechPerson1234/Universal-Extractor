const DEFAULT_MAX_WORKERS = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
const TASK_TIMEOUT = 120000;

const WORKER_CODE = `
"use strict";

const handlers = {
  'hash': async function(data) {
    const { buffer, algorithm } = data;
    const hashBuf = await crypto.subtle.digest(algorithm || 'SHA-256', buffer);
    const arr = new Uint8Array(hashBuf);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
    return { hash: s, algorithm: algorithm || 'SHA-256' };
  },

  'hash-stream': async function(data) {
    const { chunks, algorithm } = data;
    let total = 0;
    for (const c of chunks) total += c.byteLength;
    const combined = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      combined.set(new Uint8Array(c), off);
      off += c.byteLength;
    }
    const hashBuf = await crypto.subtle.digest(algorithm || 'SHA-256', combined.buffer);
    const arr = new Uint8Array(hashBuf);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
    return { hash: s };
  },

  'image-filter': function(data) {
    const { imageData, filter, amount } = data;
    const { width, height, data: pixels } = imageData;
    const out = new Uint8ClampedArray(pixels.length);
    const src = new Uint8ClampedArray(pixels);
    switch (filter) {
      case 'invert':
        for (let i = 0; i < src.length; i += 4) {
          out[i] = 255 - src[i];
          out[i+1] = 255 - src[i+1];
          out[i+2] = 255 - src[i+2];
          out[i+3] = src[i+3];
        }
        break;
      case 'grayscale':
        for (let i = 0; i < src.length; i += 4) {
          const g = src[i] * 0.299 + src[i+1] * 0.587 + src[i+2] * 0.114;
          out[i] = out[i+1] = out[i+2] = g;
          out[i+3] = src[i+3];
        }
        break;
      case 'sepia':
        for (let i = 0; i < src.length; i += 4) {
          out[i] = Math.min(255, src[i] * 0.393 + src[i+1] * 0.769 + src[i+2] * 0.189);
          out[i+1] = Math.min(255, src[i] * 0.349 + src[i+1] * 0.686 + src[i+2] * 0.168);
          out[i+2] = Math.min(255, src[i] * 0.272 + src[i+1] * 0.534 + src[i+2] * 0.131);
          out[i+3] = src[i+3];
        }
        break;
      case 'brightness':
        for (let i = 0; i < src.length; i += 4) {
          out[i] = Math.max(0, Math.min(255, src[i] + amount));
          out[i+1] = Math.max(0, Math.min(255, src[i+1] + amount));
          out[i+2] = Math.max(0, Math.min(255, src[i+2] + amount));
          out[i+3] = src[i+3];
        }
        break;
      case 'contrast': {
        const f = (259 * (amount + 255)) / (255 * (259 - amount));
        for (let i = 0; i < src.length; i += 4) {
          out[i] = Math.max(0, Math.min(255, f * (src[i] - 128) + 128));
          out[i+1] = Math.max(0, Math.min(255, f * (src[i+1] - 128) + 128));
          out[i+2] = Math.max(0, Math.min(255, f * (src[i+2] - 128) + 128));
          out[i+3] = src[i+3];
        }
        break;
      }
      case 'blur': {
        const radius = Math.max(1, Math.floor(amount || 2));
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0, a = 0, count = 0;
            for (let dy = -radius; dy <= radius; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const ny = y + dy, nx = x + dx;
                if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
                const idx = (ny * width + nx) * 4;
                r += src[idx]; g += src[idx+1]; b += src[idx+2]; a += src[idx+3];
                count++;
              }
            }
            const idx = (y * width + x) * 4;
            out[idx] = r / count;
            out[idx+1] = g / count;
            out[idx+2] = b / count;
            out[idx+3] = a / count;
          }
        }
        break;
      }
      case 'sharpen': {
        const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0;
            for (let ky = 0; ky < 3; ky++) {
              for (let kx = 0; kx < 3; kx++) {
                const ny = y + ky - 1, nx = x + kx - 1;
                const k = kernel[ky * 3 + kx];
                if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
                const idx = (ny * width + nx) * 4;
                r += src[idx] * k;
                g += src[idx+1] * k;
                b += src[idx+2] * k;
              }
            }
            const idx = (y * width + x) * 4;
            out[idx] = Math.max(0, Math.min(255, r));
            out[idx+1] = Math.max(0, Math.min(255, g));
            out[idx+2] = Math.max(0, Math.min(255, b));
            out[idx+3] = src[idx+3];
          }
        }
        break;
      }
      default:
        out.set(src);
    }
    return { data: out.buffer, width, height };
  },

  'image-resize': function(data) {
    const { source, srcW, srcH, dstW, dstH } = data;
    const src = new Uint8ClampedArray(source);
    const out = new Uint8ClampedArray(dstW * dstH * 4);
    const xRatio = srcW / dstW;
    const yRatio = srcH / dstH;
    for (let y = 0; y < dstH; y++) {
      const sy = Math.min(srcH - 1, Math.floor(y * yRatio));
      for (let x = 0; x < dstW; x++) {
        const sx = Math.min(srcW - 1, Math.floor(x * xRatio));
        const srcIdx = (sy * srcW + sx) * 4;
        const dstIdx = (y * dstW + x) * 4;
        out[dstIdx] = src[srcIdx];
        out[dstIdx+1] = src[srcIdx+1];
        out[dstIdx+2] = src[srcIdx+2];
        out[dstIdx+3] = src[srcIdx+3];
      }
    }
    return { data: out.buffer, width: dstW, height: dstH };
  },

  'audio-fft': function(data) {
    const { samples, fftSize } = data;
    const N = fftSize || 1024;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const src = new Float32Array(samples);
    for (let i = 0; i < N && i < src.length; i++) re[i] = src[i];
    fft(re, im);
    const mag = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) mag[i] = Math.sqrt(re[i]*re[i] + im[i]*im[i]);
    return { magnitudes: mag.buffer };
  },

  'audio-peaks': function(data) {
    const { samples, buckets } = data;
    const src = new Float32Array(samples);
    const count = buckets || 512;
    const blockSize = Math.max(1, Math.floor(src.length / count));
    const peaks = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let max = 0;
      const start = i * blockSize;
      const end = Math.min(start + blockSize, src.length);
      for (let j = start; j < end; j++) {
        const v = Math.abs(src[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    return { peaks: peaks.buffer };
  },

  'archive-list': function(data) {
    return { message: 'archive-list not implemented' };
  },

  'text-lines': function(data) {
    const { text } = data;
    const lines = text.split('\\n');
    return { lineCount: lines.length, charCount: text.length };
  },

  'text-wordcount': function(data) {
    const { text } = data;
    const words = text.trim() ? text.trim().split(/\\s+/).length : 0;
    return { words };
  },
};

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const newRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newRe;
      }
    }
  }
}

self.onmessage = async function(e) {
  const { taskId, operation, data } = e.data;
  try {
    const handler = handlers[operation];
    if (!handler) throw new Error('Unknown operation: ' + operation);
    const result = await handler(data);
    const transfers = [];
    if (result) {
      for (const key of Object.keys(result)) {
        if (result[key] instanceof ArrayBuffer) transfers.push(result[key]);
      }
    }
    self.postMessage({ taskId, result }, transfers);
  } catch (err) {
    self.postMessage({ taskId, error: err.message || String(err) });
  }
};
`;

export class WorkerManager {
  constructor(options = {}) {
    this.maxWorkers = options.maxWorkers || DEFAULT_MAX_WORKERS;
    this.timeout = options.timeout || TASK_TIMEOUT;
    this.workerUrl = null;
    this.workers = [];
    this.taskCounter = 0;
    this.pending = new Map();
    this.queue = [];
    this.activeByOperation = new Map();
    this._stats = {
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksQueued: 0,
      totalRuntime: 0,
      peakQueue: 0,
    };
    this._listeners = new Set();
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    this.workerUrl = URL.createObjectURL(blob);
    this._initialized = true;
  }

  _createWorker() {
    const worker = new Worker(this.workerUrl);
    const entry = { worker, busy: false, currentTask: null, id: this.workers.length };
    worker.onmessage = (e) => this._handleMessage(entry, e);
    worker.onerror = (e) => this._handleError(entry, e);
    this.workers.push(entry);
    return entry;
  }

  _handleMessage(entry, event) {
    const { taskId, result, error } = event.data;
    const task = this.pending.get(taskId);
    if (!task) return;
    this.pending.delete(taskId);
    entry.busy = false;
    entry.currentTask = null;
    const runtime = performance.now() - task.startTime;
    this._stats.totalRuntime += runtime;
    if (error) {
      this._stats.tasksFailed++;
      task.reject(new Error(error));
    } else {
      this._stats.tasksCompleted++;
      task.resolve(result);
    }
    this._notify('taskComplete', { taskId, runtime, error: !!error });
    this._processQueue();
  }

  _handleError(entry, event) {
    console.error('[WorkerManager] worker error', event);
    const task = entry.currentTask;
    if (task) {
      const pending = this.pending.get(task);
      if (pending) {
        pending.reject(new Error('Worker crashed: ' + (event.message || 'unknown')));
        this.pending.delete(task);
      }
    }
    entry.busy = false;
    entry.currentTask = null;
    try { entry.worker.terminate(); } catch {}
    const idx = this.workers.indexOf(entry);
    if (idx !== -1) this.workers.splice(idx, 1);
    if (this.workers.length < this.maxWorkers) this._createWorker();
    this._processQueue();
  }

  async run(operation, data, transfer = []) {
    await this.init();
    return new Promise((resolve, reject) => {
      const taskId = ++this.taskCounter;
      const task = {
        id: taskId,
        operation,
        data,
        transfer,
        resolve,
        reject,
        startTime: performance.now(),
      };
      this.pending.set(taskId, task);
      this.queue.push(taskId);
      this._stats.tasksQueued++;
      if (this.queue.length > this._stats.peakQueue) {
        this._stats.peakQueue = this.queue.length;
      }
      this._notify('taskQueued', { taskId, operation, queueLength: this.queue.length });
      this._processQueue();
    });
  }

  _processQueue() {
    if (!this.queue.length) return;
    let idle = this.workers.find(w => !w.busy);
    if (!idle && this.workers.length < this.maxWorkers) {
      idle = this._createWorker();
    }
    if (!idle) return;
    const taskId = this.queue.shift();
    const task = this.pending.get(taskId);
    if (!task) return;
    idle.busy = true;
    idle.currentTask = taskId;
    task.startTime = performance.now();
    this._notify('taskStarted', { taskId, operation: task.operation, workerId: idle.id });
    try {
      idle.worker.postMessage(
        { taskId, operation: task.operation, data: task.data },
        task.transfer
      );
      setTimeout(() => {
        if (this.pending.has(taskId)) {
          this.pending.delete(taskId);
          idle.busy = false;
          idle.currentTask = null;
          this._stats.tasksFailed++;
          task.reject(new Error('Task timeout'));
          this._processQueue();
        }
      }, this.timeout);
    } catch (err) {
      idle.busy = false;
      idle.currentTask = null;
      this.pending.delete(taskId);
      this._stats.tasksFailed++;
      task.reject(err);
      this._processQueue();
    }
  }

  async computeHash(buffer, algorithm = 'SHA-256') {
    return this.run('hash', { buffer, algorithm }, [buffer]);
  }

  async computeStreamingHash(chunks, algorithm = 'SHA-256') {
    const transfer = chunks.filter(c => c instanceof ArrayBuffer);
    return this.run('hash-stream', { chunks, algorithm }, transfer);
  }

  async applyImageFilter(imageData, filter, amount = 0) {
    const buffer = imageData.data.buffer;
    const result = await this.run(
      'image-filter',
      {
        imageData: {
          width: imageData.width,
          height: imageData.height,
          data: buffer,
        },
        filter,
        amount,
      },
      [buffer]
    );
    return {
      width: result.width,
      height: result.height,
      data: new Uint8ClampedArray(result.data),
    };
  }

  async resizeImage(source, srcW, srcH, dstW, dstH) {
    const buffer = source.buffer || source;
    const result = await this.run(
      'image-resize',
      { source: buffer, srcW, srcH, dstW, dstH },
      [buffer]
    );
    return {
      width: result.width,
      height: result.height,
      data: new Uint8ClampedArray(result.data),
    };
  }

  async computeFFT(samples, fftSize = 1024) {
    const buffer = samples.buffer || samples;
    const result = await this.run('audio-fft', { samples: buffer, fftSize }, [buffer]);
    return new Float32Array(result.magnitudes);
  }

  async computeAudioPeaks(samples, buckets = 512) {
    const buffer = samples.buffer || samples;
    const result = await this.run('audio-peaks', { samples: buffer, buckets }, [buffer]);
    return new Float32Array(result.peaks);
  }

  async countLines(text) {
    return this.run('text-lines', { text });
  }

  async countWords(text) {
    return this.run('text-wordcount', { text });
  }

  getStats() {
    const busy = this.workers.filter(w => w.busy).length;
    return {
      ...this._stats,
      workers: this.workers.length,
      busyWorkers: busy,
      idleWorkers: this.workers.length - busy,
      queueLength: this.queue.length,
      pendingTasks: this.pending.size,
      avgRuntime: this._stats.tasksCompleted > 0
        ? this._stats.totalRuntime / this._stats.tasksCompleted
        : 0,
    };
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify(type, payload) {
    for (const fn of this._listeners) {
      try { fn({ type, ...payload, ts: Date.now() }); } catch {}
    }
  }

  async warmup() {
    await this.init();
    if (this.workers.length === 0) this._createWorker();
    return this.workers.length;
  }

  clearQueue() {
    const removed = this.queue.length;
    for (const taskId of this.queue) {
      const task = this.pending.get(taskId);
      if (task) {
        task.reject(new Error('Task cancelled'));
        this.pending.delete(taskId);
      }
    }
    this.queue = [];
    return removed;
  }

  terminateAll() {
    for (const entry of this.workers) {
      try { entry.worker.terminate(); } catch {}
    }
    this.workers = [];
    this.queue = [];
    for (const task of this.pending.values()) {
      task.reject(new Error('Worker terminated'));
    }
    this.pending.clear();
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = null;
    this._initialized = false;
  }
}

export const workerManager = new WorkerManager();
