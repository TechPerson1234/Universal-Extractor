// =============================================================================
// src/ui/SettingsPanel.js (CORRECTED)
// =============================================================================
// Full settings UI with categories, controls, import/export, and reset.
// =============================================================================

export class SettingsPanel {
  constructor(container, options = {}) {
    this.container = container;
    this.themeManager = options.themeManager;
    this.onSettingsChanged = options.onSettingsChanged || (() => {});

    this.settings = this._loadSettings();
    this.categories = this._buildCategories();
    this._render();
  }

  _buildCategories() {
    return [
      {
        id: 'appearance',
        label: 'Appearance',
        icon: 'fa-palette',
        settings: [
          { id: 'theme', label: 'Theme', type: 'select', options: ['cyberpunk', 'matrix', 'light', 'dark'], default: 'cyberpunk' },
          { id: 'fontSize', label: 'Font Size', type: 'select', options: ['Small', 'Medium', 'Large', 'XL'], default: 'Medium' },
          { id: 'animations', label: 'Animations', type: 'toggle', default: true },
          { id: 'transparency', label: 'Transparency Effects', type: 'toggle', default: true },
        ]
      },
      {
        id: 'file_management',
        label: 'File Management',
        icon: 'fa-folder',
        settings: [
          { id: 'showHidden', label: 'Show Hidden Files', type: 'toggle', default: false },
          { id: 'sortBy', label: 'Sort By', type: 'select', options: ['Name', 'Size', 'Type', 'Date'], default: 'Name' },
          { id: 'sortDirection', label: 'Sort Direction', type: 'select', options: ['Ascending', 'Descending'], default: 'Ascending' },
          { id: 'viewMode', label: 'View Mode', type: 'select', options: ['List', 'Grid', 'Details'], default: 'List' },
          { id: 'confirmDelete', label: 'Confirm Delete', type: 'toggle', default: true },
        ]
      },
      {
        id: 'search',
        label: 'Search',
        icon: 'fa-search',
        settings: [
          { id: 'searchMode', label: 'Search Mode', type: 'select', options: ['Simple', 'Regex', 'Fuzzy'], default: 'Simple' },
          { id: 'caseSensitive', label: 'Case Sensitive', type: 'toggle', default: false },
          { id: 'liveSearch', label: 'Live Search', type: 'toggle', default: true },
          { id: 'maxResults', label: 'Max Results', type: 'number', min: 10, max: 1000, default: 100 },
        ]
      },
      {
        id: 'performance',
        label: 'Performance',
        icon: 'fa-tachometer-alt',
        settings: [
          { id: 'virtualization', label: 'Virtualization', type: 'toggle', default: true },
          { id: 'lazyLoading', label: 'Lazy Loading', type: 'toggle', default: true },
          { id: 'workerThreads', label: 'Worker Threads', type: 'number', min: 1, max: 8, default: 4 },
          { id: 'cacheSize', label: 'Cache Size (MB)', type: 'number', min: 10, max: 500, default: 50 },
        ]
      },
      {
        id: 'plugins',
        label: 'Plugins',
        icon: 'fa-puzzle-piece',
        settings: [
          { id: 'imagePlugin', label: 'Image Plugin', type: 'toggle', default: true },
          { id: 'videoPlugin', label: 'Video Plugin', type: 'toggle', default: true },
          { id: 'audioPlugin', label: 'Audio Plugin', type: 'toggle', default: true },
          { id: 'hexPlugin', label: 'Hex Plugin', type: 'toggle', default: true },
          { id: 'textPlugin', label: 'Text Plugin', type: 'toggle', default: true },
          { id: 'modelPlugin', label: 'Model Plugin', type: 'toggle', default: true },
          { id: 'pdfPlugin', label: 'PDF Plugin', type: 'toggle', default: true },
          { id: 'archivePlugin', label: 'Archive Plugin', type: 'toggle', default: true },
        ]
      },
      {
        id: 'storage',
        label: 'Storage',
        icon: 'fa-database',
        settings: [
          { id: 'persistence', label: 'Persistence', type: 'toggle', default: true },
          { id: 'autoSaveInterval', label: 'Auto-Save Interval (min)', type: 'number', min: 1, max: 60, default: 5 },
          { id: 'maxHistory', label: 'Max History (undo/redo)', type: 'number', min: 10, max: 100, default: 50 },
          { id: 'sessionRestore', label: 'Session Restore', type: 'toggle', default: true },
        ]
      }
    ];
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  _render() {
    const container = this.container;
    container.innerHTML = '';

    // Title and export/import/reset buttons
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '20px';
    header.innerHTML = `
      <h3 style="font-weight:bold;font-size:16px;">Settings</h3>
      <div style="display:flex;gap:8px;">
        <button id="settings-export" style="background:var(--bg-void);color:var(--nexus-cyan);border:1px solid var(--nexus-cyan);padding:4px 12px;border-radius:4px;cursor:pointer;">Export</button>
        <button id="settings-import" style="background:var(--bg-void);color:var(--nexus-cyan);border:1px solid var(--nexus-cyan);padding:4px 12px;border-radius:4px;cursor:pointer;">Import</button>
        <button id="settings-reset" style="background:var(--bg-void);color:#ff003c;border:1px solid #ff003c;padding:4px 12px;border-radius:4px;cursor:pointer;">Reset</button>
      </div>
    `;
    container.appendChild(header);

    // Category tabs
    const tabs = document.createElement('div');
    tabs.style.display = 'flex';
    tabs.style.gap = '4px';
    tabs.style.marginBottom = '16px';
    tabs.style.borderBottom = '1px solid #333';
    tabs.style.paddingBottom = '8px';
    tabs.style.overflowX = 'auto';

    let activeCategory = this.categories[0].id;
    for (const cat of this.categories) {
      const tab = document.createElement('button');
      tab.textContent = cat.label;
      tab.style.padding = '4px 12px';
      tab.style.borderRadius = '4px';
      tab.style.border = 'none';
      tab.style.backgroundColor = 'transparent';
      tab.style.color = 'var(--text-muted)';
      tab.style.cursor = 'pointer';
      tab.style.fontSize = '13px';
      tab.style.whiteSpace = 'nowrap';
      if (cat.id === activeCategory) {
        tab.style.color = 'var(--nexus-cyan)';
        tab.style.borderBottom = '2px solid var(--nexus-cyan)';
      }
      tab.addEventListener('click', () => {
        activeCategory = cat.id;
        this._renderCategory(container, cat.id);
        // Update tab styles
        tabs.querySelectorAll('button').forEach(b => {
          b.style.color = 'var(--text-muted)';
          b.style.borderBottom = 'none';
        });
        tab.style.color = 'var(--nexus-cyan)';
        tab.style.borderBottom = '2px solid var(--nexus-cyan)';
      });
      tabs.appendChild(tab);
    }
    container.appendChild(tabs);

    // Render the first category
    this._renderCategory(container, activeCategory);

    // Bind events for export/import/reset buttons
    this._bindEvents();
  }

  _renderCategory(container, categoryId) {
    const cat = this.categories.find(c => c.id === categoryId);
    if (!cat) return;

    // Remove old category content
    const old = container.querySelector('.settings-category');
    if (old) old.remove();

    const div = document.createElement('div');
    div.className = 'settings-category';
    div.style.display = 'flex';
    div.style.flexDirection = 'column';
    div.style.gap = '12px';

    for (const setting of cat.settings) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.padding = '4px 0';
      row.style.borderBottom = '1px solid #222';

      const label = document.createElement('label');
      label.textContent = setting.label;
      label.style.fontSize = '13px';
      label.style.color = 'var(--text-main)';
      row.appendChild(label);

      const control = this._createControl(setting);
      row.appendChild(control);

      div.appendChild(row);
    }

    container.appendChild(div);
  }

  _createControl(setting) {
    const value = this.settings[setting.id] !== undefined ? this.settings[setting.id] : setting.default;

    let el;
    switch (setting.type) {
      case 'toggle':
        el = document.createElement('input');
        el.type = 'checkbox';
        el.checked = value;
        el.style.width = '18px';
        el.style.height = '18px';
        el.style.accentColor = 'var(--nexus-cyan)';
        el.addEventListener('change', () => {
          this.settings[setting.id] = el.checked;
          this._saveSettings();
          this.onSettingsChanged(this.settings);
        });
        break;

      case 'select':
        el = document.createElement('select');
        el.style.backgroundColor = 'var(--bg-void)';
        el.style.color = 'white';
        el.style.border = '1px solid #333';
        el.style.padding = '2px 8px';
        el.style.borderRadius = '4px';
        for (const opt of setting.options) {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt;
          if (opt === value) option.selected = true;
          el.appendChild(option);
        }
        el.addEventListener('change', () => {
          this.settings[setting.id] = el.value;
          this._saveSettings();
          this.onSettingsChanged(this.settings);
        });
        break;

      case 'number':
        el = document.createElement('input');
        el.type = 'number';
        el.min = setting.min;
        el.max = setting.max;
        el.value = value;
        el.style.width = '80px';
        el.style.backgroundColor = 'var(--bg-void)';
        el.style.color = 'white';
        el.style.border = '1px solid #333';
        el.style.padding = '2px 8px';
        el.style.borderRadius = '4px';
        el.addEventListener('change', () => {
          let val = parseFloat(el.value);
          if (isNaN(val)) val = setting.default;
          if (setting.min !== undefined) val = Math.max(val, setting.min);
          if (setting.max !== undefined) val = Math.min(val, setting.max);
          el.value = val;
          this.settings[setting.id] = val;
          this._saveSettings();
          this.onSettingsChanged(this.settings);
        });
        break;

      default:
        el = document.createElement('span');
        el.textContent = 'Unsupported';
        el.style.color = 'var(--text-muted)';
    }

    return el;
  }

  // ---------------------------------------------------------------------------
  // Settings storage
  // ---------------------------------------------------------------------------
  _loadSettings() {
    try {
      const raw = localStorage.getItem('nexus-settings');
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {}
    return {};
  }

  _saveSettings() {
    try {
      localStorage.setItem('nexus-settings', JSON.stringify(this.settings));
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Export / Import / Reset
  // ---------------------------------------------------------------------------
  _exportSettings() {
    const data = JSON.stringify(this.settings, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexus-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  _importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          this.settings = data;
          this._saveSettings();
          this._render(); // re-render to reflect changes
          this.onSettingsChanged(this.settings);
        } catch (err) {
          alert('Invalid settings file.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  _resetSettings() {
    if (!confirm('Reset all settings to defaults?')) return;
    // Build default settings from categories
    const defaults = {};
    for (const cat of this.categories) {
      for (const set of cat.settings) {
        defaults[set.id] = set.default;
      }
    }
    this.settings = defaults;
    this._saveSettings();
    this._render();
    this.onSettingsChanged(this.settings);
  }

  // ---------------------------------------------------------------------------
  // Bind events for export/import/reset buttons
  // ---------------------------------------------------------------------------
  _bindEvents() {
    const exportBtn = document.getElementById('settings-export');
    if (exportBtn) exportBtn.addEventListener('click', () => this._exportSettings());
    const importBtn = document.getElementById('settings-import');
    if (importBtn) importBtn.addEventListener('click', () => this._importSettings());
    const resetBtn = document.getElementById('settings-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => this._resetSettings());
  }
}