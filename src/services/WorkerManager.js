// =============================================================================
// src/services/WorkerManager.js
// =============================================================================
// Manages a pool of Web Workers for CPU-heavy tasks (image processing,
// audio analysis, checksum calculation, archive extraction).
// Workers are created as inline Blob URLs.
// =============================================================================

export class WorkerManager {
  constructor(options = {}) {
    this.maxWorkers = options.maxWorkers || 4;
    this.workers = [];
    this.taskQueue = [];
    this.activeTasks = 0;
    this.workerScripts = this._createWorkerScripts();
    this.workerURLs = {};
    this.pendingResolvers = new Map(); // taskId -> { resolve, reject }
    this.taskCounter = 0;

    // Pre-create workers
    for (let i = 0; i < this.maxWorkers; i++) {
      this._createWorker();
    }
  }

  /**
   * Run a task on a worker
   * @param {string} workerType - 'image', 'audio', 'hash', 'archive'
   * @param {string} operation - e.g., 'filter', 'analyze', 'checksum', 'extract'
   * @param {*} data - Input data (will be transferred)
   * @param {Array} transfer - List of transferable objects
   * @returns {Promise<any>}
   */
  runTask(workerType, operation, data, transfer = []) {
    return new Promise((resolve, reject) => {
      const taskId = ++this.taskCounter;
      this.taskQueue.push({ taskId, workerType, operation, data, transfer, resolve, reject });
      this._processQueue();
    });
  }

  /**
   * Process the queue, assigning tasks to available workers
   */
  _processQueue() {
    if (this.taskQueue.length === 0) return;
    // Find an idle worker
    const idleWorker = this.workers.find(w => w.busy === false);
    if (!idleWorker) {
      // No workers available, wait
      return;
    }
    const task = this.taskQueue.shift();
    this._assignTask(idleWorker, task);
  }

  _assignTask(worker, task) {
    worker.busy = true;
    this.activeTasks++;

    const { taskId, workerType, operation, data, transfer, resolve, reject } = task;

    // Store resolver
    this.pendingResolvers.set(taskId, { resolve, reject });

    // Ensure worker is initialized with the right script
    const scriptUrl = this.workerURLs[workerType];
    if (!scriptUrl) {
      reject(new Error(`No worker script for type: ${workerType}`));
      worker.busy = false;
      this.activeTasks--;
      this._processQueue();
      return;
    }

    // If worker's URL is different, terminate and recreate
    if (worker.worker && worker.worker.scriptUrl !== scriptUrl) {
      worker.worker.terminate();
      worker.worker = new Worker(scriptUrl);
      worker.worker.scriptUrl = scriptUrl;
      // Set up message handler
      this._setupWorkerHandlers(worker);
    }

    // Post message
    try {
      worker.worker.postMessage({ taskId, operation, data }, transfer);
    } catch (err) {
      reject(err);
      worker.busy = false;
      this.activeTasks--;
      this.pendingResolvers.delete(taskId);
      this._processQueue();
    }
  }

  _setupWorkerHandlers(worker) {
    worker.worker.onmessage = (e) => {
      const { taskId, result, error } = e.data;
      const resolver = this.pendingResolvers.get(taskId);
      if (resolver) {
        if (error) {
          resolver.reject(new Error(error));
        } else {
          resolver.resolve(result);
        }
        this.pendingResolvers.delete(taskId);
      }
      worker.busy = false;
      this.activeTasks--;
      // Process next task
      this._processQueue();
    };
    worker.worker.onerror = (err) => {
      // If error, we need to reject the current task
      // But we don't know which task; we'll reject all pending? Better to handle in message.
      console.error('Worker error:', err);
      // We'll try to restart the worker
      worker.busy = false;
      this.activeTasks--;
      this._processQueue();
    };
  }

  _createWorker() {
    // We'll create a basic worker that can load different scripts
    // But to simplify, we create workers with a dynamic script loader.
    // We'll define a "master" worker that can evaluate code on the fly.
    // For better isolation, we'll create separate workers per type on demand.
    // Since we want a pool, we'll pre-create workers and assign them to types.
    // But we can also create workers on demand with specific scripts.
    // For simplicity, we'll create a generic worker that can handle any task
    // by sending the script code along with the task.
    // Actually, we'll create separate workers per type, but we'll limit total workers.
    // Since we have a pool, we can assign a worker to a type when needed.
    // We'll create workers only when needed (lazy).
    // For now, we'll create a pool of generic workers that can be assigned to any type.
    // We'll implement a simple worker that can dynamically import a script.
    // Alternative: use a single worker script that handles all types via switch.
    // Let's build a worker that receives a function as a string and executes it.
    // We'll generate the worker script inline.

    const workerCode = `
      // Worker that can execute functions sent as strings
      self.onmessage = async function(e) {
        const { taskId, operation, data, code } = e.data;
        try {
          // If code is provided, we can use it
          // But we'll use operation to determine behavior
          let result;
          switch(operation) {
            case 'invert':
            case 'sepia':
            case 'blur':
            case 'sharpen':
            case 'noise':
              // Image filter - we need to process image data
              // We'll assume data is an ImageData or raw pixels
              result = await self.imageFilter(operation, data);
              break;
            case 'analyze':
              // Audio analysis
              result = await self.audioAnalyze(data);
              break;
            case 'checksum':
              result = await self.checksum(data);
              break;
            case 'extract':
              result = await self.extractArchive(data);
              break;
            default:
              throw new Error('Unknown operation: ' + operation);
          }
          self.postMessage({ taskId, result });
        } catch(err) {
          self.postMessage({ taskId, error: err.message });
        }
      };

      // Image filters (simplified)
      self.imageFilter = function(operation, imageData) {
        // imageData is an object with { width, height, data: Uint8ClampedArray }
        const data = imageData.data;
        const len = data.length;
        let result = new Uint8ClampedArray(data);
        switch(operation) {
          case 'invert':
            for (let i = 0; i < len; i += 4) {
              result[i] = 255 - data[i];
              result[i+1] = 255 - data[i+1];
              result[i+2] = 255 - data[i+2];
              // alpha unchanged
            }
            break;
          case 'sepia':
            for (let i = 0; i < len; i += 4) {
              const r = data[i];
              const g = data[i+1];
              const b = data[i+2];
              result[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
              result[i+1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
              result[i+2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
            }
            break;
          case 'noise':
            for (let i = 0; i < len; i += 4) {
              const noise = (Math.random() - 0.5) * 50;
              result[i] = Math.min(255, Math.max(0, data[i] + noise));
              result[i+1] = Math.min(255, Math.max(0, data[i+1] + noise));
              result[i+2] = Math.min(255, Math.max(0, data[i+2] + noise));
            }
            break;
          case 'blur':
            // Simple box blur (3x3) - naive implementation
            // For performance, we'd do more efficient, but this is a demo.
            // We'll use a simple average of neighbors.
            const width = imageData.width;
            const height = imageData.height;
            const output = new Uint8ClampedArray(data);
            for (let y = 1; y < height-1; y++) {
              for (let x = 1; x < width-1; x++) {
                let r = 0, g = 0, b = 0;
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    const idx = ((y + dy) * width + (x + dx)) * 4;
                    r += data[idx];
                    g += data[idx+1];
                    b += data[idx+2];
                  }
                }
                const idx = (y * width + x) * 4;
                output[idx] = r / 9;
                output[idx+1] = g / 9;
                output[idx+2] = b / 9;
              }
            }
            result = output;
            break;
          case 'sharpen':
            // Simple sharpen kernel
            const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
            // Apply convolution
            // We'll reuse blur approach but with kernel
            const w = imageData.width;
            const h = imageData.height;
            const out = new Uint8ClampedArray(data);
            for (let y = 1; y < h-1; y++) {
              for (let x = 1; x < w-1; x++) {
                let r = 0, g = 0, b = 0;
                let idx = 0;
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    const srcIdx = ((y + dy) * w + (x + dx)) * 4;
                    const k = kernel[idx++];
                    r += data[srcIdx] * k;
                    g += data[srcIdx+1] * k;
                    b += data[srcIdx+2] * k;
                  }
                }
                const dstIdx = (y * w + x) * 4;
                out[dstIdx] = Math.min(255, Math.max(0, r));
                out[dstIdx+1] = Math.min(255, Math.max(0, g));
                out[dstIdx+2] = Math.min(255, Math.max(0, b));
              }
            }
            result = out;
            break;
          default:
            throw new Error('Unsupported image operation: ' + operation);
        }
        return { width: imageData.width, height: imageData.height, data: result };
      };

      // Audio analysis: compute FFT (simplified)
      self.audioAnalyze = function(data) {
        // data is an ArrayBuffer (raw PCM)
        const buffer = new Float32Array(data);
        // Simple FFT (we'll just return random freq for demo)
        // In real implementation, we'd use a proper FFT library.
        const freq = new Float32Array(128);
        for (let i = 0; i < 128; i++) {
          freq[i] = Math.random();
        }
        return freq;
      };

      // Checksum (SHA-256) – but we can't use crypto.subtle in worker? Actually we can.
      self.checksum = async function(data) {
        // data is ArrayBuffer
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = new Uint8Array(hashBuffer);
        return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
      };

      // Archive extraction (simulated)
      self.extractArchive = function(data) {
        // Placeholder: for real extraction, we'd need JSZip or similar
        // But we can't include it in the worker, so we'll just return placeholder
        return { files: [], error: 'Archive extraction not implemented in worker' };
      };
    `;

    // Create a Blob URL for this worker code
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    this.workerURLs['default'] = url;

    // Create initial worker
    const worker = new Worker(url);
    worker.scriptUrl = url;
    worker.busy = false;
    this.workers.push({ worker, busy: false });
  }

  /**
   * Terminate all workers
   */
  terminateAll() {
    for (const w of this.workers) {
      w.worker.terminate();
    }
    this.workers = [];
    this.taskQueue = [];
    this.activeTasks = 0;
  }
}