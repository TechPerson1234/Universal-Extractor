// =============================================================================
// src/ui/SearchBar.js
// =============================================================================
// Advanced search bar with filters, regex, live search, and result highlighting.
// =============================================================================

export class SearchBar {
  constructor(container, options = {}) {
    this.container = container;
    this.vfs = options.vfs;
    this.onSearch = options.onSearch || (() => {});

    this.query = '';
    this.filters = {
      type: 'all', // 'all', 'image', 'video', 'audio', 'text', 'model', 'pdf', 'archive'
      date: null, // 'today', 'week', 'month', 'year'
      minSize: null,
      maxSize: null,
    };
    this.useRegex = false;
    this.caseSensitive = false;

    this._buildUI();
    this._bindEvents();
  }

  _buildUI() {
    const container = this.container;
    container.innerHTML = '';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '4px';
    container.style.backgroundColor = 'var(--bg-void)';
    container.style.border = '1px solid #333';
    container.style.borderRadius = '4px';
    container.style.padding = '2px 4px';

    // Search icon
    const icon = document.createElement('i');
    icon.className = 'fas fa-search';
    icon.style.color = '#666';
    icon.style.fontSize = '12px';
    icon.style.marginLeft = '6px';
    container.appendChild(icon);

    // Input
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'global-search';
    input.placeholder = 'Search VFS...';
    input.style.background = 'transparent';
    input.style.border = 'none';
    input.style.color = 'white';
    input.style.padding = '4px 8px';
    input.style.width = '100%';
    input.style.outline = 'none';
    input.style.fontFamily = 'monospace';
    input.style.fontSize = '13px';
    container.appendChild(input);

    // Filter button
    const filterBtn = document.createElement('button');
    filterBtn.innerHTML = '<i class="fas fa-sliders-h"></i>';
    filterBtn.style.background = 'none';
    filterBtn.style.border = 'none';
    filterBtn.style.color = '#666';
    filterBtn.style.cursor = 'pointer';
    filterBtn.style.fontSize = '12px';
    filterBtn.title = 'Search filters';
    container.appendChild(filterBtn);

    // Regex toggle
    const regexBtn = document.createElement('button');
    regexBtn.innerHTML = '.*';
    regexBtn.style.background = 'none';
    regexBtn.style.border = 'none';
    regexBtn.style.color = '#666';
    regexBtn.style.cursor = 'pointer';
    regexBtn.style.fontSize = '14px';
    regexBtn.style.fontWeight = 'bold';
    regexBtn.title = 'Toggle regex';
    container.appendChild(regexBtn);

    // Case toggle
    const caseBtn = document.createElement('button');
    caseBtn.innerHTML = 'Aa';
    caseBtn.style.background = 'none';
    caseBtn.style.border = 'none';
    caseBtn.style.color = '#666';
    caseBtn.style.cursor = 'pointer';
    caseBtn.style.fontSize = '12px';
    caseBtn.title = 'Case sensitive';
    container.appendChild(caseBtn);

    // Store refs
    this.input = input;
    this.filterBtn = filterBtn;
    this.regexBtn = regexBtn;
    this.caseBtn = caseBtn;
  }

  _bindEvents() {
    // Input events
    this.input.addEventListener('input', () => {
      this.query = this.input.value;
      this._performSearch();
    });

    // Filter button -> show filter panel
    this.filterBtn.addEventListener('click', () => {
      this._showFilterPanel();
    });

    // Regex toggle
    this.regexBtn.addEventListener('click', () => {
      this.useRegex = !this.useRegex;
      this.regexBtn.style.color = this.useRegex ? 'var(--nexus-cyan)' : '#666';
      this._performSearch();
    });

    // Case toggle
    this.caseBtn.addEventListener('click', () => {
      this.caseSensitive = !this.caseSensitive;
      this.caseBtn.style.color = this.caseSensitive ? 'var(--nexus-cyan)' : '#666';
      this._performSearch();
    });
  }

  _performSearch() {
    const query = this.query.trim();
    if (!query) {
      this.onSearch([]);
      return;
    }

    // Build search term
    let searchTerm = query;
    let results = [];

    // Use VFS search
    const allFiles = this.vfs.getAllFiles();
    const lowerQuery = query.toLowerCase();
    const caseSensitive = this.caseSensitive;

    for (const file of allFiles) {
      let match = false;
      const name = caseSensitive ? file.name : file.name.toLowerCase();
      const path = caseSensitive ? file.path : file.path.toLowerCase();
      const search = caseSensitive ? query : lowerQuery;

      if (this.useRegex) {
        try {
          const regex = new RegExp(search, caseSensitive ? '' : 'i');
          match = regex.test(name) || regex.test(path);
        } catch (e) {
          // Invalid regex, fallback to simple
          match = name.includes(search) || path.includes(search);
        }
      } else {
        match = name.includes(search) || path.includes(search);
      }

      // Apply filters
      if (match) {
        // Type filter
        if (this.filters.type !== 'all' && file.type !== this.filters.type.toUpperCase()) {
          match = false;
        }
        // Date filter
        if (match && this.filters.date) {
          const now = Date.now();
          const fileDate = file.modified || file.created;
          const diff = now - fileDate;
          switch (this.filters.date) {
            case 'today': if (diff > 86400000) match = false; break;
            case 'week': if (diff > 7 * 86400000) match = false; break;
            case 'month': if (diff > 30 * 86400000) match = false; break;
            case 'year': if (diff > 365 * 86400000) match = false; break;
          }
        }
        // Size filters
        if (match && this.filters.minSize !== null && file.size < this.filters.minSize) {
          match = false;
        }
        if (match && this.filters.maxSize !== null && file.size > this.filters.maxSize) {
          match = false;
        }
      }

      if (match) {
        results.push(file);
      }
    }

    this.onSearch(results);
  }

  _showFilterPanel() {
    // Simple popup with filter controls
    const existing = document.getElementById('search-filter-panel');
    if (existing) {
      existing.remove();
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'search-filter-panel';
    panel.style.position = 'absolute';
    panel.style.top = '56px';
    panel.style.right = '20px';
    panel.style.backgroundColor = 'var(--bg-panel)';
    panel.style.border = '1px solid #333';
    panel.style.borderRadius = '6px';
    panel.style.padding = '16px';
    panel.style.width = '240px';
    panel.style.boxShadow = '0 8px 24px rgba(0,0,0,0.8)';
    panel.style.zIndex = '100';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '12px';

    // Type filter
    const typeGroup = document.createElement('div');
    typeGroup.innerHTML = '<label style="font-size:12px;font-weight:bold;color:var(--text-muted);">Type</label>';
    const typeSelect = document.createElement('select');
    typeSelect.style.width = '100%';
    typeSelect.style.backgroundColor = 'var(--bg-void)';
    typeSelect.style.color = 'white';
    typeSelect.style.border = '1px solid #333';
    typeSelect.style.padding = '4px';
    typeSelect.style.borderRadius = '4px';
    const types = ['all', 'image', 'video', 'audio', 'text', 'model', 'pdf', 'archive'];
    for (const t of types) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      if (t === this.filters.type) opt.selected = true;
      typeSelect.appendChild(opt);
    }
    typeSelect.addEventListener('change', () => {
      this.filters.type = typeSelect.value;
      this._performSearch();
    });
    typeGroup.appendChild(typeSelect);
    panel.appendChild(typeGroup);

    // Date filter
    const dateGroup = document.createElement('div');
    dateGroup.innerHTML = '<label style="font-size:12px;font-weight:bold;color:var(--text-muted);">Modified</label>';
    const dateSelect = document.createElement('select');
    dateSelect.style.width = '100%';
    dateSelect.style.backgroundColor = 'var(--bg-void)';
    dateSelect.style.color = 'white';
    dateSelect.style.border = '1px solid #333';
    dateSelect.style.padding = '4px';
    dateSelect.style.borderRadius = '4px';
    const dates = ['all', 'today', 'week', 'month', 'year'];
    for (const d of dates) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d === 'all' ? 'Any time' : d.charAt(0).toUpperCase() + d.slice(1);
      if (d === this.filters.date) opt.selected = true;
      dateSelect.appendChild(opt);
    }
    dateSelect.addEventListener('change', () => {
      this.filters.date = dateSelect.value === 'all' ? null : dateSelect.value;
      this._performSearch();
    });
    dateGroup.appendChild(dateSelect);
    panel.appendChild(dateGroup);

    // Size filters (min/max)
    const sizeGroup = document.createElement('div');
    sizeGroup.innerHTML = '<label style="font-size:12px;font-weight:bold;color:var(--text-muted);">Size (MB)</label>';
    const sizeRow = document.createElement('div');
    sizeRow.style.display = 'flex';
    sizeRow.style.gap = '8px';
    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.placeholder = 'Min';
    minInput.style.flex = '1';
    minInput.style.backgroundColor = 'var(--bg-void)';
    minInput.style.color = 'white';
    minInput.style.border = '1px solid #333';
    minInput.style.padding = '4px';
    minInput.style.borderRadius = '4px';
    minInput.value = this.filters.minSize !== null ? this.filters.minSize / (1024*1024) : '';
    minInput.addEventListener('change', () => {
      const val = parseFloat(minInput.value);
      this.filters.minSize = isNaN(val) ? null : val * 1024 * 1024;
      this._performSearch();
    });
    sizeRow.appendChild(minInput);

    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.placeholder = 'Max';
    maxInput.style.flex = '1';
    maxInput.style.backgroundColor = 'var(--bg-void)';
    maxInput.style.color = 'white';
    maxInput.style.border = '1px solid #333';
    maxInput.style.padding = '4px';
    maxInput.style.borderRadius = '4px';
    maxInput.value = this.filters.maxSize !== null ? this.filters.maxSize / (1024*1024) : '';
    maxInput.addEventListener('change', () => {
      const val = parseFloat(maxInput.value);
      this.filters.maxSize = isNaN(val) ? null : val * 1024 * 1024;
      this._performSearch();
    });
    sizeRow.appendChild(maxInput);
    sizeGroup.appendChild(sizeRow);
    panel.appendChild(sizeGroup);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.backgroundColor = 'var(--nexus-cyan)';
    closeBtn.style.color = '#000';
    closeBtn.style.border = 'none';
    closeBtn.style.padding = '4px 12px';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontWeight = 'bold';
    closeBtn.addEventListener('click', () => {
      panel.remove();
    });
    panel.appendChild(closeBtn);

    // Attach to body
    document.body.appendChild(panel);
  }

  // Public method to set search query externally
  setQuery(query) {
    this.input.value = query;
    this.query = query;
    this._performSearch();
  }
}