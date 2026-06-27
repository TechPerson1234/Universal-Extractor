// =============================================================================
// src/services/SettingsStore.js
// =============================================================================
// Manages application settings in localStorage with schema validation,
// migration, and default values.
// =============================================================================

export class SettingsStore {
  constructor() {
    this.key = 'nexus-settings';
    this.schemaVersion = 1;
    this.defaults = {
      // Appearance
      theme: 'cyberpunk',
      fontSize: 'Medium',
      animations: true,
      transparency: true,

      // File Management
      showHidden: false,
      sortBy: 'Name',
      sortDirection: 'Ascending',
      viewMode: 'List',
      confirmDelete: true,

      // Search
      searchMode: 'Simple',
      caseSensitive: false,
      liveSearch: true,
      maxResults: 100,

      // Performance
      virtualization: true,
      lazyLoading: true,
      workerThreads: 4,
      cacheSize: 50, // MB

      // Plugins
      imagePlugin: true,
      videoPlugin: true,
      audioPlugin: true,
      hexPlugin: true,
      textPlugin: true,
      modelPlugin: true,
      pdfPlugin: true,
      archivePlugin: true,

      // Storage
      persistence: true,
      autoSaveInterval: 5, // minutes
      maxHistory: 50,
      sessionRestore: true,

      // Keyboard shortcuts (customizable)
      shortcuts: {
        'newFile': 'Ctrl+N',
        'newFolder': 'Ctrl+Shift+N',
        'openFile': 'Ctrl+O',
        'save': 'Ctrl+S',
        'saveAs': 'Ctrl+Shift+S',
        'closeTab': 'Ctrl+W',
        'closeAllTabs': 'Ctrl+Shift+W',
        'undo': 'Ctrl+Z',
        'redo': 'Ctrl+Y',
        'cut': 'Ctrl+X',
        'copy': 'Ctrl+C',
        'paste': 'Ctrl+V',
        'selectAll': 'Ctrl+A',
        'delete': 'Delete',
        'rename': 'F2',
        'search': 'Ctrl+F',
        'findNext': 'F3',
        'findPrevious': 'Shift+F3',
        'toggleSidebar': 'Ctrl+B',
        'toggleInspector': 'Ctrl+I',
        'fullscreen': 'F11',
        'zoomIn': 'Ctrl+=',
        'zoomOut': 'Ctrl+-',
        'resetZoom': 'Ctrl+0',
        'refresh': 'F5',
        'duplicate': 'Ctrl+D',
        'properties': 'Alt+Enter',
        'extractAll': 'Ctrl+E',
        'packWorkspace': 'Ctrl+P',
      },
    };

    this.settings = this._load();
  }

  /**
   * Get a setting value
   * @param {string} key - Dot notation supported (e.g., 'shortcuts.save')
   * @param {*} defaultValue - Fallback if not found
   * @returns {*}
   */
  get(key, defaultValue = undefined) {
    const keys = key.split('.');
    let current = this.settings;
    for (const k of keys) {
      if (current === undefined || current === null) return defaultValue;
      current = current[k];
    }
    return current !== undefined ? current : defaultValue;
  }

  /**
   * Set a setting value
   * @param {string} key - Dot notation supported
   * @param {*} value
   */
  set(key, value) {
    const keys = key.split('.');
    const last = keys.pop();
    let current = this.settings;
    for (const k of keys) {
      if (!current[k] || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k];
    }
    current[last] = value;
    this._save();
  }

  /**
   * Get all settings
   */
  getAll() {
    return { ...this.settings };
  }

  /**
   * Reset all settings to defaults
   */
  reset() {
    this.settings = JSON.parse(JSON.stringify(this.defaults));
    this._save();
  }

  /**
   * Import settings from object
   */
  import(data) {
    // Merge with defaults, but only keys that exist in defaults
    const merged = { ...this.defaults };
    for (const key of Object.keys(data)) {
      if (key in this.defaults) {
        if (typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
          merged[key] = { ...this.defaults[key], ...data[key] };
        } else {
          merged[key] = data[key];
        }
      }
    }
    this.settings = merged;
    this._save();
  }

  /**
   * Export settings as JSON string
   */
  export() {
    return JSON.stringify(this.settings, null, 2);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------
  _load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) {
        // First time, save defaults
        this._saveDefaults();
        return { ...this.defaults };
      }
      const parsed = JSON.parse(raw);
      // Check schema version
      if (parsed._version && parsed._version !== this.schemaVersion) {
        // Could migrate, but we'll just merge with defaults
        console.warn('Settings schema version mismatch, merging with defaults');
        const merged = { ...this.defaults };
        for (const key of Object.keys(parsed)) {
          if (key !== '_version' && key in this.defaults) {
            if (typeof parsed[key] === 'object' && parsed[key] !== null && !Array.isArray(parsed[key])) {
              merged[key] = { ...this.defaults[key], ...parsed[key] };
            } else {
              merged[key] = parsed[key];
            }
          }
        }
        return merged;
      }
      return parsed;
    } catch (e) {
      console.warn('Failed to load settings, using defaults:', e);
      this._saveDefaults();
      return { ...this.defaults };
    }
  }

  _save() {
    try {
      const data = { ...this.settings, _version: this.schemaVersion };
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save settings:', e);
    }
  }

  _saveDefaults() {
    const data = { ...this.defaults, _version: this.schemaVersion };
    localStorage.setItem(this.key, JSON.stringify(data));
  }
}