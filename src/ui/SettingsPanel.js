const SETTINGS_KEY = 'nexus-settings-v5';
const SHORTCUTS_KEY = 'nexus-shortcuts-v5';

const DEFAULT_SETTINGS = {
  appearance: {
    theme: 'cyberpunk',
    fontSize: 'medium',
    animations: true,
    transparency: true,
    compactMode: false,
    accentColor: '#00f0ff',
  },
  files: {
    showHidden: false,
    sortBy: 'name',
    sortDirection: 'asc',
    viewMode: 'list',
    confirmDelete: true,
    confirmOverwrite: true,
    defaultFolder: '/',
  },
  search: {
    mode: 'simple',
    caseSensitive: false,
    liveSearch: true,
    maxResults: 100,
    searchHistory: true,
  },
  performance: {
    virtualization: true,
    lazyLoading: true,
    workerThreads: 4,
    cacheSize: 64,
    chunkSize: 1,
    compressionEnabled: true,
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
  },
  storage: {
    persistence: true,
    autoSaveInterval: 5,
    maxHistory: 50,
    sessionRestore: true,
    quotaWarning: 85,
  },
  network: {
    offlineMode: false,
    proxyUrl: '',
    userAgent: '',
  },
  advanced: {
    debugMode: false,
    telemetry: false,
    developerTools: false,
  },
};

const DEFAULT_SHORTCUTS = {
  'new.file': 'Ctrl+N',
  'new.folder': 'Ctrl+Shift+N',
  'open.file': 'Ctrl+O',
  'save.file': 'Ctrl+S',
  'save.all': 'Ctrl+Shift+S',
  'close.tab': 'Ctrl+W',
  'close.all': 'Ctrl+Shift+W',
  'edit.undo': 'Ctrl+Z',
  'edit.redo': 'Ctrl+Y',
  'edit.cut': 'Ctrl+X',
  'edit.copy': 'Ctrl+C',
  'edit.paste': 'Ctrl+V',
  'edit.selectAll': 'Ctrl+A',
  'edit.delete': 'Delete',
  'edit.rename': 'F2',
  'search.open': 'Ctrl+F',
  'search.next': 'F3',
  'search.prev': 'Shift+F3',
  'view.sidebar': 'Ctrl+B',
  'view.inspector': 'Ctrl+I',
  'view.fullscreen': 'F11',
  'view.zoomIn': 'Ctrl+=',
  'view.zoomOut': 'Ctrl+-',
  'view.zoomReset': 'Ctrl+0',
  'view.refresh': 'F5',
  'app.settings': 'Ctrl+,',
  'app.help': '?',
  'app.export': 'Ctrl+E',
  'app.share': 'Ctrl+Shift+E',
};

const CATEGORIES = [
  { id: 'appearance', label: 'Appearance', icon: 'fa-palette' },
  { id: 'files', label: 'Files', icon: 'fa-folder' },
  { id: 'search', label: 'Search', icon: 'fa-search' },
  { id: 'performance', label: 'Performance', icon: 'fa-tachometer-alt' },
  { id: 'plugins', label: 'Plugins', icon: 'fa-puzzle-piece' },
  { id: 'storage', label: 'Storage', icon: 'fa-database' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'fa-keyboard' },
  { id: 'network', label: 'Network', icon: 'fa-wifi' },
  { id: 'advanced', label: 'Advanced', icon: 'fa-flask' },
];

export class SettingsPanel {
  constructor(container, options = {}) {
    this.container = container;
    this.themeManager = options.themeManager;
    this.onSettingsChanged = options.onSettingsChanged || (() => {});
    this.onShortcutsChanged = options.onShortcutsChanged || (() => {});

    this.settings = this._loadSettings();
    this.shortcuts = this._loadShortcuts();
    this.activeCategory = 'appearance';
    this._shortcutRecording = null;
  }

  render() {
    const c = this.container;
    c.innerHTML = '';
    c.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;';
    header.innerHTML = `
      <h3 style="font-weight:bold;font-size:15px;color:white;margin:0;">Settings</h3>
      <div style="display:flex;gap:6px;">
        <button id="sx-export" class="nexus-touch" style="background:transparent;color:var(--nexus-cyan);border:1px solid var(--nexus-cyan);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-family:inherit;">Export</button>
        <button id="sx-import" class="nexus-touch" style="background:transparent;color:var(--nexus-cyan);border:1px solid var(--nexus-cyan);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-family:inherit;">Import</button>
        <button id="sx-reset" class="nexus-touch" style="background:transparent;color:#ff003c;border:1px solid #ff003c;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-family:inherit;">Reset</button>
      </div>
    `;
    c.appendChild(header);

    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid #333;padding-bottom:8px;';

    for (const cat of CATEGORIES) {
      const tab = document.createElement('button');
      tab.className = 'nexus-touch';
      tab.dataset.cat = cat.id;
      tab.style.cssText = `display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:4px;border:none;background:transparent;color:${cat.id === this.activeCategory ? 'var(--nexus-cyan)' : 'var(--text-muted)'};cursor:pointer;font-size:12px;font-family:inherit;white-space:nowrap;${cat.id === this.activeCategory ? 'border-bottom:2px solid var(--nexus-cyan);' : ''}`;
      tab.innerHTML = `<i class="fas ${cat.icon}" style="font-size:11px;"></i> ${cat.label}`;
      tab.addEventListener('click', () => {
        this.activeCategory = cat.id;
        this.render();
      });
      tabs.appendChild(tab);
    }
    c.appendChild(tabs);

    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow-y:auto;padding-right:4px;';
    c.appendChild(body);

    if (this.activeCategory === 'shortcuts') {
      this._renderShortcuts(body);
    } else {
      const cat = this.settings[this.activeCategory] || {};
      this._renderCategory(body, this.activeCategory, cat);
    }

    this._bindHeaderEvents();
  }

  _renderCategory(body, categoryId, data) {
    const schema = this._schemaFor(categoryId);
    for (const field of schema) {
      const row = this._createRow(field, data[field.key]);
      body.appendChild(row);
    }
  }

  _schemaFor(category) {
    const schemas = {
      appearance: [
        { key: 'theme', label: 'Theme', type: 'select', options: ['cyberpunk', 'matrix', 'light', 'dark'] },
        { key: 'fontSize', label: 'Font Size', type: 'select', options: ['small', 'medium', 'large', 'xl'] },
        { key: 'accentColor', label: 'Accent Color', type: 'color' },
        { key: 'animations', label: 'Animations', type: 'toggle' },
        { key: 'transparency', label: 'Transparency Effects', type: 'toggle' },
        { key: 'compactMode', label: 'Compact Mode', type: 'toggle' },
      ],
      files: [
        { key: 'showHidden', label: 'Show Hidden Files', type: 'toggle' },
        { key: 'sortBy', label: 'Sort By', type: 'select', options: ['name', 'size', 'type', 'date'] },
        { key: 'sortDirection', label: 'Sort Direction', type: 'select', options: ['asc', 'desc'] },
        { key: 'viewMode', label: 'View Mode', type: 'select', options: ['list', 'grid', 'details'] },
        { key: 'defaultFolder', label: 'Default Folder', type: 'text' },
        { key: 'confirmDelete', label: 'Confirm Delete', type: 'toggle' },
        { key: 'confirmOverwrite', label: 'Confirm Overwrite', type: 'toggle' },
      ],
      search: [
        { key: 'mode', label: 'Search Mode', type: 'select', options: ['simple', 'regex', 'fuzzy'] },
        { key: 'caseSensitive', label: 'Case Sensitive', type: 'toggle' },
        { key: 'liveSearch', label: 'Live Search', type: 'toggle' },
        { key: 'searchHistory', label: 'Save Search History', type: 'toggle' },
        { key: 'maxResults', label: 'Max Results', type: 'number', min: 10, max: 1000, step: 10 },
      ],
      performance: [
        { key: 'virtualization', label: 'Virtualization', type: 'toggle' },
        { key: 'lazyLoading', label: 'Lazy Loading', type: 'toggle' },
        { key: 'compressionEnabled', label: 'Chunk Compression', type: 'toggle' },
        { key: 'workerThreads', label: 'Worker Threads', type: 'number', min: 1, max: 16, step: 1 },
        { key: 'cacheSize', label: 'Cache Size (MB)', type: 'number', min: 8, max: 512, step: 8 },
        { key: 'chunkSize', label: 'Chunk Size (MB)', type: 'number', min: 0.25, max: 16, step: 0.25 },
      ],
      plugins: [
        { key: 'imagePlugin', label: 'Image Editor', type: 'toggle' },
        { key: 'videoPlugin', label: 'Video Player', type: 'toggle' },
        { key: 'audioPlugin', label: 'Audio Player', type: 'toggle' },
        { key: 'hexPlugin', label: 'Hex Editor', type: 'toggle' },
        { key: 'textPlugin', label: 'Text Editor', type: 'toggle' },
        { key: 'modelPlugin', label: '3D Viewer', type: 'toggle' },
        { key: 'pdfPlugin', label: 'PDF Viewer', type: 'toggle' },
        { key: 'archivePlugin', label: 'Archive Explorer', type: 'toggle' },
      ],
      storage: [
        { key: 'persistence', label: 'Persist to IndexedDB', type: 'toggle' },
        { key: 'sessionRestore', label: 'Restore Session', type: 'toggle' },
        { key: 'autoSaveInterval', label: 'Auto-Save (min)', type: 'number', min: 1, max: 60, step: 1 },
        { key: 'maxHistory', label: 'Max Undo History', type: 'number', min: 10, max: 200, step: 10 },
        { key: 'quotaWarning', label: 'Quota Warning (%)', type: 'number', min: 50, max: 99, step: 1 },
      ],
      network: [
        { key: 'offlineMode', label: 'Force Offline Mode', type: 'toggle' },
        { key: 'proxyUrl', label: 'CORS Proxy URL', type: 'text' },
        { key: 'userAgent', label: 'Custom User-Agent', type: 'text' },
      ],
      advanced: [
        { key: 'debugMode', label: 'Debug Mode', type: 'toggle' },
        { key: 'telemetry', label: 'Anonymous Telemetry', type: 'toggle' },
        { key: 'developerTools', label: 'Developer Tools Panel', type: 'toggle' },
      ],
    };
    return schemas[category] || [];
  }

  _createRow(field, value) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #1a1a1a;';

    const labelWrap = document.createElement('div');
    labelWrap.style.cssText = 'flex:1;min-width:0;';
    const label = document.createElement('div');
    label.textContent = field.label;
    label.style.cssText = 'font-size:13px;color:#ddd;';
    labelWrap.appendChild(label);
    if (field.hint) {
      const hint = document.createElement('div');
      hint.textContent = field.hint;
      hint.style.cssText = 'font-size:10px;color:#666;margin-top:2px;';
      labelWrap.appendChild(hint);
    }
    row.appendChild(labelWrap);

    const ctrl = this._createControl(field, value);
    row.appendChild(ctrl);
    return row;
  }

  _createControl(field, value) {
    const def = this.settings[this.activeCategory][field.key];

    if (field.type === 'toggle') {
      const btn = document.createElement('button');
      btn.className = 'nexus-touch';
      const on = !!value;
      btn.style.cssText = `width:44px;height:22px;border-radius:11px;border:none;cursor:pointer;position:relative;transition:background 0.2s;background:${on ? 'var(--nexus-cyan)' : '#333'};`;
      const knob = document.createElement('span');
      knob.style.cssText = `position:absolute;top:2px;left:${on ? '24px' : '2px'};width:18px;height:18px;border-radius:50%;background:${on ? '#000' : '#ccc'};transition:left 0.2s;`;
      btn.appendChild(knob);
      btn.addEventListener('click', () => {
        const nv = !this.settings[this.activeCategory][field.key];
        this.settings[this.activeCategory][field.key] = nv;
        knob.style.left = nv ? '24px' : '2px';
        knob.style.background = nv ? '#000' : '#ccc';
        btn.style.background = nv ? 'var(--nexus-cyan)' : '#333';
        this._onChange(field.key, nv);
      });
      return btn;
    }

    if (field.type === 'select') {
      const sel = document.createElement('select');
      sel.style.cssText = 'background:#0a0a0a;color:white;border:1px solid #333;padding:4px 8px;border-radius:4px;font-size:12px;font-family:inherit;min-width:100px;';
      for (const opt of field.options) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (opt === value) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        this.settings[this.activeCategory][field.key] = sel.value;
        this._onChange(field.key, sel.value);
      });
      return sel;
    }

    if (field.type === 'number') {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = field.min ?? '';
      inp.max = field.max ?? '';
      inp.step = field.step ?? 1;
      inp.value = value ?? field.min ?? 0;
      inp.style.cssText = 'width:80px;background:#0a0a0a;color:white;border:1px solid #333;padding:4px 8px;border-radius:4px;font-size:12px;font-family:inherit;';
      inp.addEventListener('change', () => {
        let v = parseFloat(inp.value);
        if (isNaN(v)) v = field.min || 0;
        if (field.min != null) v = Math.max(field.min, v);
        if (field.max != null) v = Math.min(field.max, v);
        inp.value = v;
        this.settings[this.activeCategory][field.key] = v;
        this._onChange(field.key, v);
      });
      wrap.appendChild(inp);
      return wrap;
    }

    if (field.type === 'color') {
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = value || '#00f0ff';
      inp.style.cssText = 'width:44px;height:26px;background:transparent;border:1px solid #333;border-radius:4px;cursor:pointer;';
      inp.addEventListener('input', () => {
        this.settings[this.activeCategory][field.key] = inp.value;
        this._onChange(field.key, inp.value);
      });
      return inp;
    }

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value || '';
    inp.style.cssText = 'width:200px;background:#0a0a0a;color:white;border:1px solid #333;padding:4px 8px;border-radius:4px;font-size:12px;font-family:inherit;';
    inp.addEventListener('change', () => {
      this.settings[this.activeCategory][field.key] = inp.value;
      this._onChange(field.key, inp.value);
    });
    return inp;
  }

  _renderShortcuts(body) {
    const info = document.createElement('div');
    info.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:8px;';
    info.textContent = 'Click a shortcut to record a new binding. Press Escape to cancel.';
    body.appendChild(info);

    const groups = {};
    for (const key of Object.keys(this.shortcuts)) {
      const [group] = key.split('.');
      if (!groups[group]) groups[group] = [];
      groups[group].push(key);
    }

    for (const [group, keys] of Object.entries(groups)) {
      const header = document.createElement('div');
      header.style.cssText = 'font-size:11px;font-weight:bold;color:var(--nexus-cyan);text-transform:uppercase;letter-spacing:0.08em;margin-top:12px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #222;';
      header.textContent = group;
      body.appendChild(header);

      for (const key of keys) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1a1a1a;';

        const label = document.createElement('span');
        label.textContent = key.split('.').slice(1).join('.');
        label.style.cssText = 'font-size:12px;color:#ddd;';
        row.appendChild(label);

        const binding = document.createElement('button');
        binding.className = 'nexus-touch';
        binding.style.cssText = 'background:#0a0a0a;color:var(--nexus-cyan);border:1px solid #333;padding:4px 12px;border-radius:4px;font-family:monospace;font-size:11px;cursor:pointer;min-width:100px;';
        binding.textContent = this.shortcuts[key] || '—';
        binding.addEventListener('click', () => this._recordShortcut(key, binding));
        row.appendChild(binding);

        body.appendChild(row);
      }
    }
  }

  _recordShortcut(key, btn) {
    if (this._shortcutRecording) {
      this._shortcutRecording.btn.textContent = this.shortcuts[this._shortcutRecording.key] || '—';
      this._shortcutRecording.btn.style.borderColor = '#333';
    }
    this._shortcutRecording = { key, btn };
    btn.textContent = 'Press keys...';
    btn.style.borderColor = 'var(--nexus-cyan)';

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        btn.textContent = this.shortcuts[key] || '—';
        btn.style.borderColor = '#333';
        document.removeEventListener('keydown', handler, true);
        this._shortcutRecording = null;
        return;
      }
      const combo = this._eventToCombo(e);
      if (!combo) return;
      this.shortcuts[key] = combo;
      btn.textContent = combo;
      btn.style.borderColor = '#333';
      document.removeEventListener('keydown', handler, true);
      this._shortcutRecording = null;
      this._saveShortcuts();
      this.onShortcutsChanged(this.shortcuts);
    };
    document.addEventListener('keydown', handler, true);
  }

  _eventToCombo(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    const key = e.key;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
    const map = { ' ': 'Space', 'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right' };
    parts.push(map[key] || (key.length === 1 ? key.toUpperCase() : key));
    return parts.join('+');
  }

  _bindHeaderEvents() {
    const exportBtn = this.container.querySelector('#sx-export');
    const importBtn = this.container.querySelector('#sx-import');
    const resetBtn = this.container.querySelector('#sx-reset');
    if (exportBtn) exportBtn.addEventListener('click', () => this._export());
    if (importBtn) importBtn.addEventListener('click', () => this._import());
    if (resetBtn) resetBtn.addEventListener('click', () => this._reset());
  }

  _export() {
    const data = { settings: this.settings, shortcuts: this.shortcuts, version: 5, exported: Date.now() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-settings-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  _import() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.settings) this.settings = this._mergeSettings(data.settings);
          if (data.shortcuts) this.shortcuts = { ...DEFAULT_SHORTCUTS, ...data.shortcuts };
          this._saveSettings();
          this._saveShortcuts();
          this.onSettingsChanged(this.settings);
          this.onShortcutsChanged(this.shortcuts);
          this.render();
        } catch (err) {
          alert('Invalid settings file: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  _reset() {
    if (!confirm('Reset all settings to defaults?')) return;
    this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    this.shortcuts = { ...DEFAULT_SHORTCUTS };
    this._saveSettings();
    this._saveShortcuts();
    this.onSettingsChanged(this.settings);
    this.onShortcutsChanged(this.shortcuts);
    this.render();
  }

  _onChange(key, value) {
    this._saveSettings();
    this.onSettingsChanged(this.settings);
    if (this.activeCategory === 'appearance') {
      this._applyAppearance();
    }
  }

  _applyAppearance() {
    const a = this.settings.appearance;
    document.documentElement.style.setProperty('--nexus-cyan', a.accentColor || '#00f0ff');
    if (this.themeManager && a.theme) {
      try { this.themeManager.apply(a.theme); } catch {}
    }
  }

  _mergeSettings(incoming) {
    const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    for (const cat of Object.keys(incoming)) {
      if (!out[cat]) continue;
      for (const key of Object.keys(incoming[cat])) {
        if (key in out[cat]) out[cat][key] = incoming[cat][key];
      }
    }
    return out;
  }

  _saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {}
  }

  _saveShortcuts() {
    try {
      localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(this.shortcuts));
    } catch {}
  }

  _loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return this._mergeSettings(JSON.parse(raw));
    } catch {}
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  _loadShortcuts() {
    try {
      const raw = localStorage.getItem(SHORTCUTS_KEY);
      if (raw) return { ...DEFAULT_SHORTCUTS, ...JSON.parse(raw) };
    } catch {}
    return { ...DEFAULT_SHORTCUTS };
  }

  getSettings() {
    return JSON.parse(JSON.stringify(this.settings));
  }

  getShortcuts() {
    return { ...this.shortcuts };
  }

  destroy() {
    this.container.innerHTML = '';
  }
}
