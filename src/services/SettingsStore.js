const STORAGE_KEY = 'nexus-settings-v5';
const SHORTCUTS_KEY = 'nexus-shortcuts-v5';
const SCHEMA_VERSION = 5;

const DEFAULT_SETTINGS = {
  _version: SCHEMA_VERSION,
  appearance: {
    theme: 'cyberpunk',
    fontSize: 'medium',
    fontFamily: 'ui-monospace',
    animations: true,
    transparency: true,
    compactMode: false,
    accentColor: '#00f0ff',
    reduceMotion: false,
    highContrast: false,
  },
  files: {
    showHidden: false,
    sortBy: 'name',
    sortDirection: 'asc',
    viewMode: 'list',
    confirmDelete: true,
    confirmOverwrite: true,
    defaultFolder: '/',
    rememberLastFolder: true,
    previewOnHover: true,
    thumbnailSize: 48,
  },
  search: {
    mode: 'simple',
    caseSensitive: false,
    wholeWord: false,
    liveSearch: true,
    maxResults: 100,
    searchHistory: true,
    historyLimit: 20,
    includeContent: false,
    fuzzyThreshold: 3,
  },
  performance: {
    virtualization: true,
    lazyLoading: true,
    compressionEnabled: true,
    workerThreads: 4,
    cacheSize: 64,
    chunkSize: 1,
    maxParallelChunks: 4,
    progressiveRendering: true,
  },
  plugins: {
    imagePlugin: true,
    videoPlugin: true,
    audioPlugin: true,
    hexPlugin: true,
    textPlugin: true,
    modelPlugin: true,
    pdfPlugin: true,
    archivePlugin: true,
    autoDetectType: true,
  },
  storage: {
    persistence: true,
    autoSaveInterval: 5,
    maxHistory: 50,
    sessionRestore: true,
    quotaWarning: 85,
    autoEvict: false,
    evictionThreshold: 90,
  },
  network: {
    offlineMode: false,
    proxyUrl: '',
    userAgent: '',
    timeout: 30,
    retryCount: 3,
    allowInsecure: false,
  },
  advanced: {
    debugMode: false,
    telemetry: false,
    developerTools: false,
    verboseLogging: false,
    experimentalFeatures: false,
    unsafeMode: false,
  },
  ui: {
    sidebarWidth: 280,
    inspectorWidth: 320,
    statusBarVisible: true,
    tabHeight: 40,
    itemHeight: 32,
    mobileBreakpoint: 768,
    toastsDuration: 3000,
    toastsPosition: 'top-right',
    toastsMaxVisible: 5,
  },
};

const DEFAULT_SHORTCUTS = {
  'file.new': 'Ctrl+N',
  'file.newFolder': 'Ctrl+Shift+N',
  'file.open': 'Ctrl+O',
  'file.save': 'Ctrl+S',
  'file.saveAll': 'Ctrl+Shift+S',
  'file.export': 'Ctrl+E',
  'file.share': 'Ctrl+Shift+E',
  'file.close': 'Ctrl+W',
  'file.closeAll': 'Ctrl+Shift+W',
  'edit.undo': 'Ctrl+Z',
  'edit.redo': 'Ctrl+Y',
  'edit.cut': 'Ctrl+X',
  'edit.copy': 'Ctrl+C',
  'edit.paste': 'Ctrl+V',
  'edit.selectAll': 'Ctrl+A',
  'edit.delete': 'Delete',
  'edit.rename': 'F2',
  'edit.duplicate': 'Ctrl+D',
  'search.open': 'Ctrl+F',
  'search.next': 'F3',
  'search.prev': 'Shift+F3',
  'search.replace': 'Ctrl+H',
  'view.sidebar': 'Ctrl+B',
  'view.inspector': 'Ctrl+I',
  'view.fullscreen': 'F11',
  'view.zoomIn': 'Ctrl+=',
  'view.zoomOut': 'Ctrl+-',
  'view.zoomReset': 'Ctrl+0',
  'view.refresh': 'F5',
  'app.settings': 'Ctrl+,',
  'app.help': '?',
  'app.shortcuts': 'Ctrl+K',
};

const VALIDATORS = {
  'appearance.theme': (v) => ['cyberpunk', 'matrix', 'light', 'dark', 'custom'].includes(v),
  'appearance.fontSize': (v) => ['small', 'medium', 'large', 'xl'].includes(v),
  'appearance.accentColor': (v) => /^#[0-9a-f]{6}$/i.test(v),
  'files.sortBy': (v) => ['name', 'size', 'type', 'date', 'modified'].includes(v),
  'files.sortDirection': (v) => ['asc', 'desc'].includes(v),
  'files.viewMode': (v) => ['list', 'grid', 'details'].includes(v),
  'files.thumbnailSize': (v) => v >= 24 && v <= 256,
  'search.mode': (v) => ['simple', 'regex', 'fuzzy'].includes(v),
  'search.maxResults': (v) => v >= 10 && v <= 5000,
  'search.historyLimit': (v) => v >= 5 && v <= 100,
  'performance.workerThreads': (v) => v >= 1 && v <= 16,
  'performance.cacheSize': (v) => v >= 8 && v <= 1024,
  'performance.chunkSize': (v) => v >= 0.25 && v <= 32,
  'performance.maxParallelChunks': (v) => v >= 1 && v <= 16,
  'storage.autoSaveInterval': (v) => v >= 1 && v <= 120,
  'storage.maxHistory': (v) => v >= 5 && v <= 500,
  'storage.quotaWarning': (v) => v >= 50 && v <= 99,
  'storage.evictionThreshold': (v) => v >= 50 && v <= 99,
  'network.timeout': (v) => v >= 5 && v <= 300,
  'network.retryCount': (v) => v >= 0 && v <= 10,
  'ui.sidebarWidth': (v) => v >= 200 && v <= 600,
  'ui.inspectorWidth': (v) => v >= 200 && v <= 600,
  'ui.mobileBreakpoint': (v) => v >= 480 && v <= 1200,
  'ui.toastsDuration': (v) => v >= 500 && v <= 30000,
  'ui.toastsMaxVisible': (v) => v >= 1 && v <= 20,
};

export class SettingsStore {
  constructor(options = {}) {
    this.storageKey = options.storageKey || STORAGE_KEY;
    this.shortcutsKey = options.shortcutsKey || SHORTCUTS_KEY;
    this.persist = options.persist !== false;
    this.cloudSync = options.cloudSync || null;
    this.settings = this._loadSettings();
    this.shortcuts = this._loadShortcuts();
    this._listeners = new Set();
    this._shortcutListeners = new Set();
    this._migrationRan = false;
  }

  get(path, defaultValue = undefined) {
    if (!path) return { ...this.settings };
    const parts = path.split('.');
    let current = this.settings;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return defaultValue;
      current = current[part];
    }
    return current !== undefined ? current : defaultValue;
  }

  set(path, value) {
    const parts = path.split('.');
    const key = parts.pop();
    let current = this.settings;
    for (const part of parts) {
      if (!current[part] || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }
    if (!this._validate(path, value)) {
      console.warn(`[SettingsStore] invalid value for ${path}:`, value);
      return false;
    }
    const oldValue = current[key];
    if (oldValue === value) return true;
    current[key] = value;
    this._save();
    this._notify(path, value, oldValue);
    if (this.cloudSync) this._queueCloudSync(path, value);
    return true;
  }

  setMany(updates) {
    const applied = [];
    for (const [path, value] of Object.entries(updates)) {
      if (this.set(path, value)) applied.push(path);
    }
    return applied;
  }

  reset(path = null) {
    if (path) {
      const parts = path.split('.');
      const key = parts.pop();
      let current = this.settings;
      let defaults = DEFAULT_SETTINGS;
      for (const part of parts) {
        current = current[part];
        defaults = defaults[part];
      }
      const oldValue = current[key];
      current[key] = defaults[key];
      this._save();
      this._notify(path, defaults[key], oldValue);
    } else {
      this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      this._save();
      this._notify('*', this.settings, null);
    }
    if (this.cloudSync) this.cloudSync.push(this.settings);
  }

  getAll() {
    return JSON.parse(JSON.stringify(this.settings));
  }

  getShortcut(action) {
    return this.shortcuts[action] || null;
  }

  setShortcut(action, combo) {
    if (!combo) {
      delete this.shortcuts[action];
    } else {
      for (const [a, c] of Object.entries(this.shortcuts)) {
        if (a !== action && c === combo) {
          console.warn(`[SettingsStore] shortcut ${combo} already bound to ${a}`);
          return false;
        }
      }
      this.shortcuts[action] = combo;
    }
    this._saveShortcuts();
    this._notifyShortcuts(action, combo);
    return true;
  }

  resetShortcuts() {
    this.shortcuts = { ...DEFAULT_SHORTCUTS };
    this._saveShortcuts();
    this._notifyShortcuts('*', this.shortcuts);
  }

  getShortcuts() {
    return { ...this.shortcuts };
  }

  findActionByShortcut(combo) {
    for (const [action, c] of Object.entries(this.shortcuts)) {
      if (c === combo) return action;
    }
    return null;
  }

  export(format = 'json') {
    const data = {
      settings: this.settings,
      shortcuts: this.shortcuts,
      version: SCHEMA_VERSION,
      exported: Date.now(),
      app: 'NEXUS EXTRACTOR v5.0',
    };
    if (format === 'json') return JSON.stringify(data, null, 2);
    return data;
  }

  import(data, options = {}) {
    const { merge = true, importShortcuts = true } = options;
    let parsed = data;
    if (typeof data === 'string') {
      try { parsed = JSON.parse(data); } catch { throw new Error('Invalid JSON'); }
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid settings data');
    const incoming = parsed.settings || parsed;
    if (merge) {
      this._deepMerge(this.settings, incoming);
    } else {
      this.settings = { ...DEFAULT_SETTINGS, ...incoming };
    }
    if (importShortcuts && parsed.shortcuts) {
      this.shortcuts = { ...DEFAULT_SHORTCUTS, ...parsed.shortcuts };
      this._saveShortcuts();
    }
    this._save();
    this._notify('*', this.settings, null);
    return true;
  }

  getStorage() {
    try {
      return {
        settingsSize: (localStorage.getItem(this.storageKey) || '').length,
        shortcutsSize: (localStorage.getItem(this.shortcutsKey) || '').length,
      };
    } catch {
      return { settingsSize: 0, shortcutsSize: 0 };
    }
  }

  clearStorage() {
    try {
      localStorage.removeItem(this.storageKey);
      localStorage.removeItem(this.shortcutsKey);
      this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      this.shortcuts = { ...DEFAULT_SHORTCUTS };
      this._notify('*', this.settings, null);
    } catch {}
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  subscribeShortcuts(fn) {
    this._shortcutListeners.add(fn);
    return () => this._shortcutListeners.delete(fn);
  }

  getSchema() {
    const schema = {};
    this._flattenSchema(DEFAULT_SETTINGS, '', schema);
    return schema;
  }

  _flattenSchema(obj, prefix, out) {
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('_')) continue;
      const fullPath = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this._flattenSchema(value, fullPath, out);
      } else {
        out[fullPath] = { default: value, type: typeof value };
      }
    }
  }

  _validate(path, value) {
    const validator = VALIDATORS[path];
    if (!validator) return true;
    try { return validator(value); } catch { return false; }
  }

  _save() {
    if (!this.persist) return;
    try {
      const data = { ...this.settings, _version: SCHEMA_VERSION, _saved: Date.now() };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.error('[SettingsStore] quota exceeded');
      }
    }
  }

  _saveShortcuts() {
    if (!this.persist) return;
    try {
      localStorage.setItem(this.shortcutsKey, JSON.stringify(this.shortcuts));
    } catch {}
  }

  _loadSettings() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      const parsed = JSON.parse(raw);
      return this._migrate(parsed);
    } catch (e) {
      console.warn('[SettingsStore] load failed, using defaults', e);
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
  }

  _loadShortcuts() {
    try {
      const raw = localStorage.getItem(this.shortcutsKey);
      if (raw) return { ...DEFAULT_SHORTCUTS, ...JSON.parse(raw) };
    } catch {}
    return { ...DEFAULT_SHORTCUTS };
  }

  _migrate(parsed) {
    const version = parsed._version || 1;
    if (version === SCHEMA_VERSION) {
      return this._deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), parsed);
    }
    console.info(`[SettingsStore] migrating from v${version} to v${SCHEMA_VERSION}`);
    const migrated = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    this._deepMerge(migrated, parsed);
    migrated._version = SCHEMA_VERSION;
    this._migrationRan = true;
    setTimeout(() => this._save(), 0);
    return migrated;
  }

  _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (key === '_version' || key === '_saved') continue;
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {};
        this._deepMerge(target[key], source[key]);
      } else {
        if (key in target) target[key] = source[key];
      }
    }
    return target;
  }

  _notify(path, value, oldValue) {
    for (const fn of this._listeners) {
      try { fn({ path, value, oldValue, ts: Date.now() }); } catch {}
    }
  }

  _notifyShortcuts(action, combo) {
    for (const fn of this._shortcutListeners) {
      try { fn({ action, combo, ts: Date.now() }); } catch {}
    }
  }

  _queueCloudSync(path, value) {
    if (!this.cloudSync) return;
    clearTimeout(this._cloudTimer);
    this._cloudTimer = setTimeout(() => {
      try { this.cloudSync.push({ path, value, ts: Date.now() }); }
      catch (e) { console.warn('[SettingsStore] cloud sync failed', e); }
    }, 500);
  }
}

export const settingsStore = new SettingsStore();
export { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, SCHEMA_VERSION };
