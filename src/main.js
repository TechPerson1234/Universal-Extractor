import { App } from './core/App.js';
import { EventBus } from './core/EventBus.js';
import { StateManager } from './core/StateManager.js';
import { VFS } from './core/VFS.js';
import { ChunkStore } from './core/ChunkStore.js';
import { ThemeManager } from './core/ThemeManager.js';
import { PluginRegistry } from './core/PluginRegistry.js';
import { StreamPipeline } from './core/StreamPipeline.js';

import { FileService } from './services/FileService.js';
import { ExportService } from './services/ExportService.js';
import { WorkerManager } from './services/WorkerManager.js';
import { ImportService } from './services/ImportService.js';
import { CodecService } from './services/CodecService.js';
import { IndexedDBService } from './services/IndexedDBService.js';
import { SettingsStore } from './services/SettingsStore.js';

const DI = {
  eventBus: null,
  stateManager: null,
  vfs: null,
  chunkStore: null,
  themeManager: null,
  pluginRegistry: null,
  streamPipeline: null,
  fileService: null,
  exportService: null,
  workerManager: null,
  importService: null,
  codecService: null,
  indexedDBService: null,
  settingsStore: null,
  app: null,
  bootedAt: null,
  version: '5.0.0',
};

const BOOT_PHASES = [
  { key: 'settings', label: 'Loading settings...', weight: 5 },
  { key: 'eventBus', label: 'Booting event bus...', weight: 5 },
  { key: 'theme', label: 'Applying theme...', weight: 5 },
  { key: 'indexedDB', label: 'Opening IndexedDB...', weight: 10 },
  { key: 'chunkStore', label: 'Initializing chunk store...', weight: 10 },
  { key: 'vfs', label: 'Mounting virtual file system...', weight: 15 },
  { key: 'services', label: 'Wiring services...', weight: 10 },
  { key: 'workers', label: 'Spinning up worker pool...', weight: 10 },
  { key: 'plugins', label: 'Loading plugins...', weight: 5 },
  { key: 'state', label: 'Preparing state manager...', weight: 5 },
  { key: 'app', label: 'Building application core...', weight: 10 },
  { key: 'mount', label: 'Rendering interface...', weight: 5 },
  { key: 'pwa', label: 'Registering service worker...', weight: 5 },
  { key: 'ready', label: 'NEXUS online.', weight: 0 },
];

let _bootStarted = false;
let _bootProgress = 0;
let _bootErrors = [];

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

function _advanceProgress(weight) {
  _bootProgress = Math.min(100, _bootProgress + weight);
  _setProgress(_bootProgress);
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
  }, 800);
}

function _showFatal(err) {
  _bootErrors.push(err);
  _setStatus('⚠ ' + (err?.message || String(err)), true);
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  const existing = document.getElementById('fatal-panel');
  if (existing) existing.remove();
  const panel = document.createElement('div');
  panel.id = 'fatal-panel';
  panel.style.cssText = 'position:fixed;bottom:20px;left:20px;right:20px;max-width:640px;margin:0 auto;background:#1a1a1a;border:1px solid #ff003c;border-radius:8px;padding:16px;color:#e0e0e0;font-family:monospace;font-size:12px;z-index:10001;box-shadow:0 12px 32px rgba(0,0,0,0.85);';
  panel.innerHTML = `
    <div style="font-weight:bold;color:#ff003c;margin-bottom:8px;font-size:14px;">BOOT FAILURE</div>
    <div style="color:#ccc;margin-bottom:12px;line-height:1.5;">${(err?.message || String(err)).replace(/</g, '&lt;')}</div>
    <div style="display:flex;gap:8px;">
      <button id="fatal-reload" style="background:#ff003c;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-weight:bold;">Reload</button>
      <button id="fatal-copy" style="background:transparent;color:#ccc;border:1px solid #555;padding:6px 14px;border-radius:4px;cursor:pointer;">Copy Error</button>
      <button id="fatal-dismiss" style="background:transparent;color:#888;border:1px solid #333;padding:6px 14px;border-radius:4px;cursor:pointer;margin-left:auto;">Dismiss</button>
    </div>
    <details style="margin-top:12px;font-size:11px;color:#888;">
      <summary style="cursor:pointer;">Stack trace</summary>
      <pre style="margin-top:8px;white-space:pre-wrap;word-break:break-all;">${(err?.stack || '').replace(/</g, '&lt;')}</pre>
    </details>
  `;
  overlay.appendChild(panel);
  panel.querySelector('#fatal-reload').onclick = () => location.reload();
  panel.querySelector('#fatal-copy').onclick = () => {
    navigator.clipboard?.writeText(err?.stack || String(err));
  };
  panel.querySelector('#fatal-dismiss').onclick = () => panel.remove();
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
      return await navigator.storage.estimate();
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
      try { DI.settingsStore?._save?.(); } catch (e) {}
    }
  });
}

function _installPWAEventHandlers() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'file-shared' && data.file) {
        DI.importService?.importFiles([data.file]).catch((e) =>
          console.error('Share target import failed', e)
        );
      }
      if (data.type === 'update-available') {
        DI.eventBus?.emit('pwa:update-available');
      }
    });
  }

  if (typeof window.LaunchQueue !== 'undefined') {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || !params.files.length) return;
      const files = [];
      for (const handle of params.files) {
        try { files.push(await handle.getFile()); } catch {}
      }
      if (files.length) {
        DI.importService?.importFiles(files).catch((e) =>
          console.error('Launch queue import failed', e)
        );
      }
    });
  }
}

function _wireServiceEvents() {
  if (!DI.eventBus) return;

  DI.workerManager?.subscribe((evt) => {
    DI.eventBus.emit('worker:' + evt.type, evt);
  });

  DI.vfs?.onProgress((p) => {
    DI.eventBus.emit('vfs:progress', p);
  });

  DI.vfs?.onChange((evt) => {
    DI.eventBus.emit('vfs:changed', evt);
  });

  DI.settingsStore?.subscribe((evt) => {
    DI.eventBus.emit('settings:changed', evt);
    if (evt.path === 'appearance.theme' && DI.themeManager) {
      try { DI.themeManager.apply(evt.value); } catch {}
    }
    if (evt.path === 'appearance.accentColor') {
      document.documentElement.style.setProperty('--nexus-cyan', evt.value);
    }
  });

  DI.settingsStore?.subscribeShortcuts((evt) => {
    DI.eventBus.emit('shortcuts:changed', evt);
  });
}

function _applyStoredSettings() {
  const s = DI.settingsStore;
  if (!s) return;
  try {
    const theme = s.get('appearance.theme', 'cyberpunk');
    if (theme && DI.themeManager) DI.themeManager.apply(theme);
    const accent = s.get('appearance.accentColor', '#00f0ff');
    document.documentElement.style.setProperty('--nexus-cyan', accent);
    const reduceMotion = s.get('appearance.reduceMotion', false);
    if (reduceMotion) {
      document.documentElement.style.setProperty('--animation-duration', '0ms');
    }
    const compact = s.get('appearance.compactMode', false);
    if (compact) document.documentElement.classList.add('nexus-compact');
  } catch (e) {
    console.warn('[NEXUS] Failed to apply settings', e);
  }
}

async function _bootSettings() {
  _setStatus('Loading settings...');
  DI.settingsStore = new SettingsStore({
    persist: true,
    cloudSync: null,
  });
  _advanceProgress(5);
  return DI.settingsStore;
}

async function _bootEventBus() {
  _setStatus('Booting event bus...');
  DI.eventBus = new EventBus({ debug: false, replaySize: 5 });
  _advanceProgress(5);
  return DI.eventBus;
}

async function _bootTheme() {
  _setStatus('Applying theme...');
  DI.themeManager = new ThemeManager();
  _advanceProgress(5);
  return DI.themeManager;
}

async function _bootIndexedDB() {
  _setStatus('Opening IndexedDB...');
  DI.indexedDBService = new IndexedDBService({
    dbName: 'NexusDB',
    dbVersion: 1,
  });
  try {
    await DI.indexedDBService.open();
  } catch (e) {
    console.warn('IndexedDBService open failed', e);
  }
  _advanceProgress(10);
  return DI.indexedDBService;
}

async function _bootChunkStore() {
  _setStatus('Initializing chunk store...');
  DI.chunkStore = new ChunkStore({
    dbName: 'NexusChunks',
    chunkSize: 1024 * 1024,
    compress: true,
    maxCacheEntries: 96,
    maxCacheBytes: 96 * 1024 * 1024,
  });
  await DI.chunkStore.open();
  _advanceProgress(10);
  return DI.chunkStore;
}

async function _bootVFS() {
  _setStatus('Mounting virtual file system...');
  DI.vfs = new VFS({
    chunkStore: DI.chunkStore,
    persistence: true,
    chunkSize: 1024 * 1024,
    smallFileThreshold: 8 * 1024 * 1024,
  });
  await DI.vfs.init();
  _advanceProgress(15);
  return DI.vfs;
}

async function _bootServices() {
  _setStatus('Wiring services...');

  DI.streamPipeline = new StreamPipeline(
    new ReadableStream({ start(c) { c.close(); } })
  );

  DI.fileService = new FileService({
    chunkSize: 1024 * 1024,
  });

  DI.exportService = new ExportService({
    chunkSize: 1024 * 1024,
    zipName: 'nexus-export',
  });

  DI.workerManager = new WorkerManager({
    maxWorkers: Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)),
    timeout: 120000,
  });

  DI.codecService = new CodecService();

  DI.importService = new ImportService({
    vfs: DI.vfs,
    eventBus: DI.eventBus,
    fileService: DI.fileService,
    maxUrlSize: 2 * 1024 * 1024 * 1024,
    urlTimeout: 60000,
  });

  _advanceProgress(10);
  return {
    fileService: DI.fileService,
    exportService: DI.exportService,
    workerManager: DI.workerManager,
    codecService: DI.codecService,
    importService: DI.importService,
  };
}

async function _bootWorkers() {
  _setStatus('Spinning up worker pool...');
  try {
    await DI.workerManager.warmup();
    const stats = DI.workerManager.getStats();
    console.info(`[NEXUS] Worker pool ready: ${stats.workers} workers`);
  } catch (e) {
    console.warn('[NEXUS] Worker warmup failed', e);
  }
  _advanceProgress(10);
}

async function _bootPlugins() {
  _setStatus('Loading plugins...');
  DI.pluginRegistry = new PluginRegistry({
    loadTimeout: 15000,
    maxLog: 500,
  });
  _advanceProgress(5);
  return DI.pluginRegistry;
}

async function _bootStateManager() {
  _setStatus('Preparing state manager...');
  DI.stateManager = new StateManager({
    maxHistory: DI.settingsStore?.get('storage.maxHistory', 50) || 50,
    persist: true,
    diffMode: true,
  });
  _advanceProgress(5);
  return DI.stateManager;
}

async function _bootApp() {
  _setStatus('Building application core...');

  DI.app = new App({
    eventBus: DI.eventBus,
    stateManager: DI.stateManager,
    vfs: DI.vfs,
    themeManager: DI.themeManager,
    pluginRegistry: DI.pluginRegistry,
    workerManager: DI.workerManager,
    fileService: DI.fileService,
    exportService: DI.exportService,
    importService: DI.importService,
    codecService: DI.codecService,
    settingsStore: DI.settingsStore,
    chunkStore: DI.chunkStore,
  });

  _advanceProgress(10);
  return DI.app;
}

async function _mountApp() {
  _setStatus('Rendering interface...');
  const appEl = document.getElementById('app');
  if (!appEl) throw new Error('#app container missing');
  await DI.app.mount(appEl);
  _advanceProgress(5);
}

async function _bootPWA() {
  _setStatus('Registering service worker...');

  _requestPersistentStorage().catch(() => {});
  _warmupQuota()
    .then((q) => {
      if (q && q.quota && q.usage / q.quota > 0.9) {
        DI.eventBus.emit('storage:near-full', q);
      }
    })
    .catch(() => {});

  _installPWAEventHandlers();

  try {
    const reg = await _installServiceWorker();
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
  } catch (e) {
    console.warn('[NEXUS] SW registration failed', e);
  }

  _advanceProgress(5);
}

export async function bootstrap(options = {}) {
  if (_bootStarted) {
    console.warn('[NEXUS] bootstrap already started');
    return DI;
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

    await _bootSettings();
    await _bootEventBus();
    await _bootTheme();

    _applyStoredSettings();

    await _bootIndexedDB();
    await _bootChunkStore();
    await _bootVFS();
    await _bootServices();

    _wireServiceEvents();

    await _bootWorkers();
    await _bootPlugins();
    await _bootStateManager();
    await _bootApp();
    await _mountApp();
    await _bootPWA();

    _setStatus('NEXUS online.');
    _setProgress(100);
    DI.bootedAt = Date.now();

    window.__NEXUS_DI = DI;
    window.__nexus = {
      app: DI.app,
      vfs: DI.vfs,
      bus: DI.eventBus,
      state: DI.stateManager,
      settings: DI.settingsStore,
      workers: DI.workerManager,
      codec: DI.codecService,
      file: DI.fileService,
      export: DI.exportService,
      import: DI.importService,
      idb: DI.indexedDBService,
      version: DI.version,
      di: DI,
    };

    onReady();

    DI.eventBus.emit('boot:complete', {
      duration: performance.now() - t0,
      bootedAt: DI.bootedAt,
      version: DI.version,
      stats: {
        workers: DI.workerManager?.getStats(),
        vfs: DI.vfs?.getStats(),
        settings: DI.settingsStore?.getStorage(),
      },
      errors: _bootErrors.length,
    });

    console.info(
      `%c[NEXUS] booted in ${(performance.now() - t0).toFixed(0)}ms`,
      'color:#00f0ff;font-weight:bold;'
    );

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

export function getApp() { return DI.app; }
export function getVFS() { return DI.vfs; }
export function getEventBus() { return DI.eventBus; }
export function getSettings() { return DI.settingsStore; }
export function getWorkers() { return DI.workerManager; }

export async function shutdown() {
  try {
    if (DI.app) await DI.app.destroy?.();
    if (DI.workerManager) DI.workerManager.terminateAll();
    if (DI.vfs) await DI.vfs.destroy?.();
    if (DI.chunkStore) await DI.chunkStore.close?.();
    if (DI.indexedDBService) await DI.indexedDBService.close?.();
    if (DI.stateManager) DI.stateManager.clear?.();
  } catch (e) {
    console.error('[NEXUS] shutdown error', e);
  } finally {
    _bootStarted = false;
  }
}

export async function reload() {
  await shutdown();
  return bootstrap();
}

export function getBootErrors() {
  return [..._bootErrors];
}

export function getBootStatus() {
  return {
    started: _bootStarted,
    progress: _bootProgress,
    phases: BOOT_PHASES.length,
    errors: _bootErrors.length,
    bootedAt: DI.bootedAt,
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.message === 'Load failed') {
      event.preventDefault();
    }
  });

  window.__nexusShutdown = shutdown;
  window.__nexusReload = reload;
  window.__nexusBootStatus = getBootStatus;
}

export { DI };
