const DEFAULT_CONFIG = {
  swPath: '/sw.js',
  scope: '/',
  updateIntervalMs: 60 * 60 * 1000,
  enableBackgroundSync: true,
  enableShareTarget: true,
  enableFileHandlers: true,
  cacheName: 'nexus-v5',
  messageTimeout: 5000,
};

export class ServiceWorkerManager {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.registration = null;
    this.installing = null;
    this.waiting = null;
    this.active = null;
    this.controller = null;
    this.updateAvailable = false;
    this.offline = !navigator.onLine;
    this.supported = 'serviceWorker' in navigator;
    this.shareTargetSupported = 'share' in navigator;
    this.fileHandlersSupported = 'launchQueue' in window;
    this._listeners = new Set();
    this._updateTimer = null;
    this._messageId = 0;
    this._pendingMessages = new Map();
    this._syncRegistrations = new Set();
    this._stats = {
      registered: false,
      updates: 0,
      installs: 0,
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0,
      lastUpdateCheck: 0,
    };
  }

  async init() {
    if (!this.supported) {
      this._emit('unsupported', { reason: 'no-service-worker' });
      return { supported: false };
    }

    try {
      await this._register();
      this._setupListeners();
      this._setupOnlineOfflineHandlers();
      this._setupShareTarget();
      this._setupFileHandlers();
      this._startUpdateChecker();
      this._stats.registered = true;
      this._emit('ready', { registration: this.registration });
      return { supported: true, registration: this.registration };
    } catch (err) {
      this._stats.errors++;
      this._emit('error', { error: err });
      return { supported: false, error: err };
    }
  }

  async _register() {
    const reg = await navigator.serviceWorker.register(this.config.swPath, {
      scope: this.config.scope,
      updateViaCache: 'none',
    });

    this.registration = reg;
    this.installing = reg.installing;
    this.waiting = reg.waiting;
    this.active = reg.active;
    this.controller = navigator.serviceWorker.controller;

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      this.installing = newWorker;
      this._emit('installing', { worker: newWorker });

      newWorker.addEventListener('statechange', () => {
        const state = newWorker.state;
        this._emit('state', { state });
        if (state === 'installed') {
          if (navigator.serviceWorker.controller) {
            this.updateAvailable = true;
            this.waiting = newWorker;
            this._stats.updates++;
            this._emit('update-available', { worker: newWorker });
          } else {
            this._stats.installs++;
            this._emit('installed', { worker: newWorker });
          }
        } else if (state === 'activated') {
          this.active = newWorker;
          this._emit('activated', { worker: newWorker });
        } else if (state === 'redundant') {
          this._emit('redundant', { worker: newWorker });
        }
      });
    });

    if (reg.waiting && navigator.serviceWorker.controller) {
      this.waiting = reg.waiting;
      this.updateAvailable = true;
      this._emit('update-available', { worker: reg.waiting });
    }

    return reg;
  }

  _setupListeners() {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      this.controller = navigator.serviceWorker.controller;
      this._emit('controller-changed', { controller: this.controller });
      if (this.updateAvailable) {
        window.location.reload();
      }
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
      this._stats.messagesReceived++;
      const { id, type, payload } = event.data || {};
      if (id && this._pendingMessages.has(id)) {
        const resolver = this._pendingMessages.get(id);
        this._pendingMessages.delete(id);
        clearTimeout(resolver.timer);
        resolver.resolve(payload);
      }
      this._emit('message', { type, payload, raw: event.data });
    });
  }

  _setupOnlineOfflineHandlers() {
    window.addEventListener('online', () => {
      this.offline = false;
      this._emit('online', {});
      this.requestBackgroundSync('nexus-sync');
    });

    window.addEventListener('offline', () => {
      this.offline = true;
      this._emit('offline', {});
    });
  }

  _setupShareTarget() {
    if (!this.shareTargetSupported) return;
    const params = new URLSearchParams(window.location.search);
    if (window.location.pathname === '/share-target') {
      const shared = {
        title: params.get('title'),
        text: params.get('text'),
        url: params.get('url'),
      };
      this._emit('share-received', shared);
    }
  }

  _setupFileHandlers() {
    if (!this.fileHandlersSupported) return;
    if (typeof window.LaunchQueue === 'undefined') return;
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || !params.files.length) return;
      const files = [];
      for (const handle of params.files) {
        try {
          const file = await handle.getFile();
          files.push(file);
        } catch (err) {
          this._emit('file-handler-error', { error: err, handle });
        }
      }
      if (files.length) {
        this._emit('files-launched', { files });
      }
    });
  }

  _startUpdateChecker() {
    if (this._updateTimer) clearInterval(this._updateTimer);
    this._updateTimer = setInterval(() => {
      this.checkForUpdate().catch(() => {});
    }, this.config.updateIntervalMs);
  }

  async checkForUpdate() {
    if (!this.registration) return false;
    try {
      this._stats.lastUpdateCheck = Date.now();
      await this.registration.update();
      return this.updateAvailable;
    } catch (err) {
      this._stats.errors++;
      return false;
    }
  }

  async applyUpdate() {
    if (!this.waiting) return false;
    this.waiting.postMessage({ type: 'SKIP_WAITING' });
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        clearTimeout(timeout);
        resolve(true);
      }, { once: true });
    });
  }

  async unregister() {
    if (!this.registration) return false;
    try {
      const result = await this.registration.unregister();
      this.registration = null;
      this._emit('unregistered', {});
      return result;
    } catch (err) {
      this._stats.errors++;
      return false;
    }
  }

  async sendMessage(type, payload = {}, timeoutMs = this.config.messageTimeout) {
    if (!navigator.serviceWorker.controller) {
      throw new Error('No active service worker controller');
    }
    const id = ++this._messageId;
    this._stats.messagesSent++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingMessages.delete(id);
        reject(new Error(`Message timeout: ${type}`));
      }, timeoutMs);
      this._pendingMessages.set(id, { resolve, reject, timer });
      navigator.serviceWorker.controller.postMessage({ id, type, payload });
    });
  }

  async precacheUrls(urls) {
    try {
      const result = await this.sendMessage('PRECACHE', { urls });
      return result;
    } catch (err) {
      this._stats.errors++;
      throw err;
    }
  }

  async clearCache(cacheName) {
    try {
      return await this.sendMessage('CLEAR_CACHE', { cacheName });
    } catch (err) {
      this._stats.errors++;
      throw err;
    }
  }

  async getCacheStats() {
    try {
      return await this.sendMessage('CACHE_STATS');
    } catch (err) {
      return null;
    }
  }

  async requestBackgroundSync(tag = 'nexus-sync') {
    if (!this.config.enableBackgroundSync) return false;
    if (!('sync' in (this.registration || {}))) return false;
    try {
      await this.registration.sync.register(tag);
      this._syncRegistrations.add(tag);
      this._emit('sync-registered', { tag });
      return true;
    } catch (err) {
      this._stats.errors++;
      return false;
    }
  }

  async requestPeriodicSync(tag = 'nexus-periodic', options = {}) {
    if (!('periodicSync' in (this.registration || {}))) return false;
    try {
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state !== 'granted') return false;
      await this.registration.periodicSync.register(tag, {
        minInterval: options.minInterval || 24 * 60 * 60 * 1000,
      });
      return true;
    } catch {
      return false;
    }
  }

  async registerShareTargetHandler(handler) {
    if (typeof handler !== 'function') return;
    this._listeners.add((evt) => {
      if (evt.type === 'share-received') handler(evt.data);
    });
  }

  async registerFileHandler(handler) {
    if (typeof handler !== 'function') return;
    this._listeners.add((evt) => {
      if (evt.type === 'files-launched') handler(evt.data);
    });
  }

  isOffline() {
    return this.offline;
  }

  isUpdateAvailable() {
    return this.updateAvailable;
  }

  getRegistration() {
    return this.registration;
  }

  getStats() {
    return {
      ...this._stats,
      supported: this.supported,
      online: !this.offline,
      updateAvailable: this.updateAvailable,
      hasRegistration: !!this.registration,
      hasController: !!this.controller,
      syncTags: Array.from(this._syncRegistrations),
    };
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(type, data) {
    for (const fn of this._listeners) {
      try { fn({ type, data, ts: Date.now() }); } catch {}
    }
  }

  destroy() {
    if (this._updateTimer) clearInterval(this._updateTimer);
    this._listeners.clear();
    this._pendingMessages.clear();
  }
}

export const serviceWorkerManager = new ServiceWorkerManager();
