import { App } from './core/App.js';
import { EventBus } from './core/EventBus.js';
import { StateManager } from './core/StateManager.js';
import { VFS } from './core/VFS.js';
import { ChunkStore } from './core/ChunkStore.js';
import { ThemeManager } from './core/ThemeManager.js';
import { PluginRegistry } from './core/PluginRegistry.js';

const DI = {
  eventBus: null,
  stateManager: null,
  vfs: null,
  chunkStore: null,
  themeManager: null,
  pluginRegistry: null,
  app: null,
  bootedAt: null,
};

const BOOT_PHASES = [
  { key: 'eventBus', label: 'Booting EventBus...' },
  { key: 'themeManager', label: 'Loading theme engine...' },
  { key: 'pluginRegistry', label: 'Preparing plugin registry...' },
  { key: 'stateManager', label: 'Spinning up state manager...' },
  { key: 'chunkStore', label: 'Opening chunk store...' },
  { key: 'vfs', label: 'Mounting Virtual File System...' },
  { key: 'app', label: 'Wiring application core...' },
  { key: 'mount', label: 'Rendering interface...' },
  { key: 'ready', label: 'NEXUS online.' },
];

let _bootStarted = false;

function _setStatus(text, isError = false) {
  const el = document.getElementById('load-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#ff003c' : '';
}

function _setProgress(pct) {
  const bar = document.getElementById('load-progress');
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

function _hideOverlay() {
  const overlay = document.getElementById('loading-overlay');
  const app = document.getElementById('app');
  if (overlay) overlay.classList.add('hidden');
  if (app) {
    app.classList.add('ready');
    app.style.display = 'flex';
  }
  setTimeout(() => {
    if (overlay && overlay.parentNode) overlay.style.display = 'none';
  }, 700);
}

function _showFatal(err) {
  _setStatus('⚠ ' + (err?.message || String(err)), true);
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  const existing = document.getElementById('fatal-panel');
  if (existing) existing.remove();
  const panel = document.createElement('div');
  panel.id = 'fatal-panel';
  panel.style.cssText = 'position:fixed;bottom:20px;left:20px;right:20px;max-width:600px;margin:0 auto;background:#1a1a1a;border:1px solid #ff003c;border-radius:8px;padding:16px;color:#e0e0e0;font-family:monospace;font-size:12px;z-index:10001;';
  panel.innerHTML = `
    <div style="font-weight:bold;color:#ff003c;margin-bottom:8px;">BOOT FAILURE</div>
    <div style="color:#ccc;margin-bottom:8px;">${(err?.message || String(err)).replace(/</g, '&lt;')}</div>
    <button id="fatal-reload" style="background:#ff003c;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">Reload</button>
  `;
  overlay.appendChild(panel);
  panel.querySelector('#fatal-reload').onclick = () => location.reload();
}

async function _installServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  if (location.protocol === 'file:') return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch (err) {
    console.warn('[SW] registration failed', err);
    return null;
  }
}

async function _requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      const persisted = await navigator.storage.persisted();
      if (persisted) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

async function _warmupQuota() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      return est;
    } catch {
      return null;
    }
  }
  return null;
}

function _installGlobalErrorBoundary() {
  window.addEventListener('error', (event) => {
    console.error('[NEXUS] window error', event.error || event.message);
    if (DI.app) DI.app.showError?.(event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[NEXUS] unhandled rejection', event.reason);
    if (DI.app) DI.app.showError?.(event.reason);
  });
}

function _installEarlyWarning() {
  window.addEventListener('beforeunload', (e) => {
    if (DI.app && DI.app.workspace && DI.app.workspace.dirtyTabs && DI.app.workspace.dirtyTabs.size > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function _installVisibilitySaver() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && DI.vfs) {
      try { DI.vfs.saveToDB(); } catch (e) {}
    }
  });
}

export async function bootstrap(options = {}) {
  if (_bootStarted) {
    console.warn('[NEXUS] bootstrap already started');
    return;
  }
  _bootStarted = true;

  const {
    onProgress = (msg) => _setStatus(msg),
    onReady = () => _hideOverlay(),
    onError = (err) => _showFatal(err),
  } = options;

  const t0 = performance.now();

  try {
    _installGlobalErrorBoundary();
    _installEarlyWarning();
    _installVisibilitySaver();

    onProgress('Initializing EventBus...');
    _setProgress(5);
    DI.eventBus = new EventBus({ debug: false });

    onProgress('Loading theme engine...');
    _setProgress(12);
    DI.themeManager = new ThemeManager();

    onProgress('Preparing plugin registry...');
    _setProgress(20);
    DI.pluginRegistry = new PluginRegistry();

    onProgress('Spinning up state manager...');
    _setProgress(30);
    DI.stateManager = new StateManager({ maxHistory: 50, persist: true });

    onProgress('Opening chunk store...');
    _setProgress(40);
    DI.chunkStore = new ChunkStore({
      dbName: 'NexusChunks',
      chunkSize: 1024 * 1024,
      compress: true,
    });
    await DI.chunkStore.open();

    onProgress('Mounting Virtual File System...');
    _setProgress(55);
    DI.vfs = new VFS({
      chunkStore: DI.chunkStore,
      persistence: true,
      chunkSize: 1024 * 1024,
    });
    await DI.vfs.init();

    _setProgress(70);
    onProgress('Wiring application core...');
    DI.app = new App({
      eventBus: DI.eventBus,
      stateManager: DI.stateManager,
      vfs: DI.vfs,
      themeManager: DI.themeManager,
      pluginRegistry: DI.pluginRegistry,
    });

    _setProgress(82);
    onProgress('Rendering interface...');
    const appEl = document.getElementById('app');
    if (!appEl) throw new Error('#app container missing');
    await DI.app.mount(appEl);

    _setProgress(92);
    onProgress('Requesting persistent storage...');
    _requestPersistentStorage().catch(() => {});
    _warmupQuota().then((q) => {
      if (q && q.quota && q.usage / q.quota > 0.9) {
        DI.eventBus.emit('storage:near-full', q);
      }
    }).catch(() => {});

    onProgress('Installing service worker...');
    _installServiceWorker().then((reg) => {
      if (reg) {
        DI.eventBus.emit('pwa:registered', reg);
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              DI.eventBus.emit('pwa:update-available');
            }
          });
        });
      }
    }).catch(() => {});

    onProgress('NEXUS online.');
    _setProgress(100);
    DI.bootedAt = Date.now();

    window.__NEXUS_DI = DI;
    window.__nexus = {
      app: DI.app,
      vfs: DI.vfs,
      bus: DI.eventBus,
      state: DI.stateManager,
      version: 'v5.0',
    };

    onReady();

    DI.eventBus.emit('boot:complete', {
      duration: performance.now() - t0,
      bootedAt: DI.bootedAt,
      version: 'v5.0',
    });

    return DI;
  } catch (err) {
    console.error('[NEXUS] fatal boot error', err);
    _showFatal(err);
    onError(err);
    throw err;
  }
}

export function getDI() {
  return DI;
}

export function shutdown() {
  try {
    if (DI.app) DI.app.destroy();
    if (DI.vfs) DI.vfs.destroy();
    if (DI.chunkStore) DI.chunkStore.close();
  } catch (e) {
    console.error('Shutdown error', e);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.message === 'Load failed') {
      event.preventDefault();
    }
  });
}
