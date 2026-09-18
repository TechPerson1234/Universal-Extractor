const DEBOUNCE_MS = 180;
const MAX_RESULTS = 500;
const HISTORY_KEY = 'nexus-search-history';
const MAX_HISTORY = 20;

export class SearchBar {
  constructor(container, options = {}) {
    this.container = container;
    this.vfs = options.vfs;
    this.onSearch = options.onSearch || (() => {});
    this.onSelect = options.onSelect || (() => {});

    this.query = '';
    this.mode = 'simple';
    this.caseSensitive = false;
    this.wholeWord = false;
    this.filters = {
      types: new Set(),
      tags: new Set(),
      minSize: null,
      maxSize: null,
      dateRange: null,
      pathScope: '/',
    };
    this.history = this._loadHistory();
    this._results = [];
    this._debounceTimer = null;
    this._input = null;
    this._suggestionsEl = null;
    this._filterPanel = null;
    this._selectedSuggestion = -1;
    this._fuzzyMatcher = null;
    this._chunkSearcher = options.chunkSearcher || null;

    this._buildUI();
    this._bindGlobalEvents();
  }

  _buildUI() {
    const c = this.container;
    c.innerHTML = '';
    c.style.cssText = 'position:relative;display:flex;align-items:center;gap:4px;background:var(--bg-void);border:1px solid #333;border-radius:4px;padding:2px 4px;transition:border-color 0.15s;';

    const icon = document.createElement('i');
    icon.className = 'fas fa-search';
    icon.style.cssText = 'color:#666;font-size:12px;margin-left:4px;flex-shrink:0;';
    c.appendChild(icon);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'global-search';
    input.placeholder = 'Search...';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.cssText = 'background:transparent;border:none;color:white;padding:4px 6px;width:100%;outline:none;font-family:monospace;font-size:12px;min-width:0;';
    c.appendChild(input);
    this._input = input;

    const modeBtn = document.createElement('button');
    modeBtn.className = 'nexus-touch';
    modeBtn.textContent = '.*';
    modeBtn.title = 'Toggle regex mode';
    modeBtn.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:11px;font-weight:bold;padding:2px 4px;font-family:monospace;flex-shrink:0;';
    modeBtn.addEventListener('click', () => this._cycleMode());
    c.appendChild(modeBtn);
    this._modeBtn = modeBtn;

    const caseBtn = document.createElement('button');
    caseBtn.className = 'nexus-touch';
    caseBtn.textContent = 'Aa';
    caseBtn.title = 'Case sensitive';
    caseBtn.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:11px;padding:2px 4px;flex-shrink:0;';
    caseBtn.addEventListener('click', () => {
      this.caseSensitive = !this.caseSensitive;
      caseBtn.style.color = this.caseSensitive ? 'var(--nexus-cyan)' : '#666';
      this._performSearch();
    });
    c.appendChild(caseBtn);
    this._caseBtn = caseBtn;

    const filterBtn = document.createElement('button');
    filterBtn.className = 'nexus-touch';
    filterBtn.innerHTML = '<i class="fas fa-sliders-h"></i>';
    filterBtn.title = 'Filters';
    filterBtn.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:11px;padding:2px 4px;flex-shrink:0;position:relative;';
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleFilterPanel();
    });
    c.appendChild(filterBtn);
    this._filterBtn = filterBtn;

    const badge = document.createElement('span');
    badge.style.cssText = 'position:absolute;top:-4px;right:-4px;background:var(--nexus-cyan);color:#000;font-size:8px;border-radius:8px;padding:1px 4px;font-weight:bold;display:none;';
    filterBtn.appendChild(badge);
    this._filterBadge = badge;

    this._buildSuggestionsHost();
    this._buildFilterPanel();
  }

  _buildSuggestionsHost() {
    const el = document.createElement('div');
    el.id = 'search-suggestions';
    el.style.cssText = 'position:absolute;top:100%;left:0;right:0;margin-top:4px;background:var(--bg-panel);border:1px solid #333;border-radius:6px;max-height:360px;overflow-y:auto;box-shadow:0 12px 32px rgba(0,0,0,0.85);z-index:200;display:none;';
    this.container.appendChild(el);
    this._suggestionsEl = el;
  }

  _buildFilterPanel() {
    const panel = document.createElement('div');
    panel.id = 'search-filter-panel';
    panel.style.cssText = 'position:absolute;top:100%;right:0;margin-top:4px;background:var(--bg-panel);border:1px solid #333;border-radius:6px;padding:14px;width:280px;box-shadow:0 12px 32px rgba(0,0,0,0.85);z-index:210;display:none;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:11px;font-weight:bold;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;';
    title.innerHTML = '<span>Search Filters</span><button id="filter-clear" style="background:none;border:none;color:#ff003c;cursor:pointer;font-size:10px;text-transform:uppercase;">Clear</button>';
    panel.appendChild(title);

    const typeSection = document.createElement('div');
    typeSection.style.cssText = 'margin-bottom:12px;';
    typeSection.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Type</div>';
    const typeGrid = document.createElement('div');
    typeGrid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:4px;';
    for (const t of ['IMAGE', 'VIDEO', 'AUDIO', 'TEXT', 'MODEL', 'PDF', 'ARCHIVE', 'BINARY']) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#ccc;cursor:pointer;padding:3px 6px;border-radius:3px;background:#0a0a0a;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.type = t;
      cb.style.cssText = 'accent-color:var(--nexus-cyan);';
      cb.addEventListener('change', () => {
        if (cb.checked) this.filters.types.add(t);
        else this.filters.types.delete(t);
        this._updateFilterBadge();
        this._performSearch();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(t));
      typeGrid.appendChild(label);
    }
    typeSection.appendChild(typeGrid);
    panel.appendChild(typeSection);

    const sizeSection = document.createElement('div');
    sizeSection.style.cssText = 'margin-bottom:12px;';
    sizeSection.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Size (KB)</div>';
    const sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display:flex;gap:6px;';
    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.placeholder = 'Min';
    minInput.style.cssText = 'flex:1;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px 6px;border-radius:3px;font-size:11px;';
    minInput.addEventListener('input', () => {
      const v = parseFloat(minInput.value);
      this.filters.minSize = isNaN(v) ? null : v * 1024;
      this._updateFilterBadge();
      this._performSearch();
    });
    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.placeholder = 'Max';
    maxInput.style.cssText = 'flex:1;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px 6px;border-radius:3px;font-size:11px;';
    maxInput.addEventListener('input', () => {
      const v = parseFloat(maxInput.value);
      this.filters.maxSize = isNaN(v) ? null : v * 1024;
      this._updateFilterBadge();
      this._performSearch();
    });
    sizeRow.appendChild(minInput);
    sizeRow.appendChild(maxInput);
    sizeSection.appendChild(sizeRow);
    panel.appendChild(sizeSection);

    const dateSection = document.createElement('div');
    dateSection.style.cssText = 'margin-bottom:12px;';
    dateSection.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Modified</div>';
    const dateSelect = document.createElement('select');
    dateSelect.style.cssText = 'width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px 6px;border-radius:3px;font-size:11px;';
    for (const [val, label] of [['', 'Any time'], ['1h', 'Last hour'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['1y', 'Last year']]) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      dateSelect.appendChild(opt);
    }
    dateSelect.addEventListener('change', () => {
      this.filters.dateRange = dateSelect.value || null;
      this._updateFilterBadge();
      this._performSearch();
    });
    dateSection.appendChild(dateSelect);
    panel.appendChild(dateSection);

    const clearBtn = panel.querySelector('#filter-clear');
    clearBtn.addEventListener('click', () => {
      this.filters.types.clear();
      this.filters.tags.clear();
      this.filters.minSize = null;
      this.filters.maxSize = null;
      this.filters.dateRange = null;
      panel.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
      panel.querySelectorAll('input[type=number]').forEach(inp => inp.value = '');
      dateSelect.value = '';
      this._updateFilterBadge();
      this._performSearch();
    });

    document.body.appendChild(panel);
    this._filterPanel = panel;
  }

  _bindGlobalEvents() {
    this._input.addEventListener('input', () => {
      this.query = this._input.value;
      this._debounceSearch();
      this._renderHistorySuggestions();
    });

    this._input.addEventListener('keydown', (e) => this._handleKeyDown(e));

    this._input.addEventListener('focus', () => {
      if (!this.query) this._renderHistorySuggestions();
      this.container.style.borderColor = 'var(--nexus-cyan)';
    });

    this._input.addEventListener('blur', () => {
      setTimeout(() => {
        this._suggestionsEl.style.display = 'none';
      }, 200);
      this.container.style.borderColor = '#333';
    });

    document.addEventListener('click', (e) => {
      if (this._filterPanel && !this._filterPanel.contains(e.target) && e.target !== this._filterBtn) {
        this._filterPanel.style.display = 'none';
      }
    });
  }

  _handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._moveSuggestionSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._moveSuggestionSelection(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this._selectedSuggestion >= 0) {
        const items = this._suggestionsEl.querySelectorAll('[data-path]');
        const target = items[this._selectedSuggestion];
        if (target) {
          this.onSelect(target.dataset.path);
          this._suggestionsEl.style.display = 'none';
          this._input.blur();
          return;
        }
      }
      this._saveToHistory(this.query);
      this._performSearch();
      this._suggestionsEl.style.display = 'none';
    } else if (e.key === 'Escape') {
      this._suggestionsEl.style.display = 'none';
      this._input.blur();
    }
  }

  _moveSuggestionSelection(delta) {
    const items = this._suggestionsEl.querySelectorAll('[data-path], [data-history]');
    if (!items.length) return;
    this._selectedSuggestion = Math.max(0, Math.min(items.length - 1, this._selectedSuggestion + delta));
    items.forEach((el, i) => {
      el.style.background = i === this._selectedSuggestion ? 'rgba(0,240,255,0.15)' : 'transparent';
    });
    const active = items[this._selectedSuggestion];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  _cycleMode() {
    const modes = ['simple', 'regex', 'fuzzy'];
    const idx = modes.indexOf(this.mode);
    this.mode = modes[(idx + 1) % modes.length];
    this._modeBtn.textContent = this.mode === 'regex' ? '.*' : this.mode === 'fuzzy' ? '≈' : 'ab';
    this._modeBtn.style.color = this.mode === 'simple' ? '#666' : 'var(--nexus-cyan)';
    this._modeBtn.title = `Mode: ${this.mode}`;
    if (this.query) this._performSearch();
  }

  _debounceSearch() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._performSearch(), DEBOUNCE_MS);
  }

  _performSearch() {
    const q = this.query.trim();
    if (!q) {
      this._results = [];
      this.onSearch([]);
      return;
    }

    let matcher;
    if (this.mode === 'regex') {
      try {
        matcher = new RegExp(q, this.caseSensitive ? '' : 'i');
      } catch {
        matcher = null;
      }
    } else if (this.mode === 'fuzzy') {
      matcher = this._fuzzyMatcherFor(q);
    } else {
      matcher = null;
    }

    const all = this.vfs.listAllFiles();
    const results = [];
    const now = Date.now();

    for (const file of all) {
      if (results.length >= MAX_RESULTS) break;
      if (this.filters.types.size && !this.filters.types.has(file.type)) continue;
      if (this.filters.minSize !== null && file.size < this.filters.minSize) continue;
      if (this.filters.maxSize !== null && file.size > this.filters.maxSize) continue;
      if (this.filters.dateRange) {
        const age = now - (file.modified || file.created || now);
        const limits = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3, '1y': 365 * 86400e3 };
        if (age > (limits[this.filters.dateRange] || Infinity)) continue;
      }
      const name = this.caseSensitive ? file.name : file.name.toLowerCase();
      const path = this.caseSensitive ? file.path : file.path.toLowerCase();
      const needle = this.caseSensitive ? q : q.toLowerCase();
      let score = 0;
      let matched = false;
      if (matcher) {
        if (matcher.test(file.name) || matcher.test(file.path)) {
          matched = true;
          score = 50;
        }
      } else if (this.mode === 'simple') {
        if (name.includes(needle)) {
          matched = true;
          score = name === needle ? 100 : name.startsWith(needle) ? 80 : 60;
        } else if (path.includes(needle)) {
          matched = true;
          score = 40;
        }
      }
      if (!matched && this.mode === 'fuzzy') {
        const r = this._fuzzyScore(needle, name);
        if (r > 0) {
          matched = true;
          score = r;
        }
      }
      if (matched) {
        const snippet = this._buildSnippet(file, q);
        results.push({ ...file, score, snippet });
      }
    }

    results.sort((a, b) => b.score - a.score);
    this._results = results;
    this._renderSuggestions(results);
    this.onSearch(results);
  }

  _fuzzyMatcherFor() {
    return null;
  }

  _fuzzyScore(needle, haystack) {
    if (!needle) return 0;
    let ni = 0;
    let score = 0;
    let lastMatch = -1;
    for (let hi = 0; hi < haystack.length && ni < needle.length; hi++) {
      if (haystack[hi] === needle[ni]) {
        score += lastMatch === hi - 1 ? 8 : 4;
        if (hi === 0) score += 6;
        lastMatch = hi;
        ni++;
      }
    }
    if (ni === needle.length) {
      score += Math.max(0, 30 - (haystack.length - needle.length));
      return score;
    }
    return 0;
  }

  _buildSnippet(file, q) {
    const name = file.name;
    const lowerName = name.toLowerCase();
    const lowerQ = q.toLowerCase();
    const idx = lowerName.indexOf(lowerQ);
    if (idx === -1 || this.mode !== 'simple') return null;
    const start = Math.max(0, idx - 20);
    const end = Math.min(name.length, idx + q.length + 20);
    return {
      before: name.slice(start, idx),
      match: name.slice(idx, idx + q.length),
      after: name.slice(idx + q.length, end),
    };
  }

  _renderSuggestions(results) {
    const el = this._suggestionsEl;
    el.innerHTML = '';
    this._selectedSuggestion = -1;

    if (!results.length) {
      if (this.query.trim()) {
        el.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px;">No results</div>';
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
      return;
    }

    const header = document.createElement('div');
    header.style.cssText = 'padding:6px 12px;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #222;';
    header.textContent = `${results.length} result${results.length === 1 ? '' : 's'}`;
    el.appendChild(header);

    for (const file of results.slice(0, 50)) {
      const row = document.createElement('div');
      row.dataset.path = file.path;
      row.className = 'nexus-touch';
      row.style.cssText = 'padding:8px 12px;display:flex;align-items:center;gap:10px;cursor:pointer;font-size:12px;border-bottom:1px solid #1a1a1a;transition:background 0.1s;';

      const icon = document.createElement('i');
      icon.className = `fas ${this._iconFor(file.type)}`;
      icon.style.cssText = 'color:' + this._colorFor(file.type) + ';font-size:12px;width:14px;text-align:center;flex-shrink:0;';
      row.appendChild(icon);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'color:#ddd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameEl.textContent = file.name;
      info.appendChild(nameEl);
      const pathEl = document.createElement('div');
      pathEl.style.cssText = 'color:#555;font-size:10px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;';
      pathEl.textContent = file.path;
      info.appendChild(pathEl);
      row.appendChild(info);

      const score = document.createElement('div');
      score.style.cssText = 'color:#444;font-size:10px;font-family:monospace;flex-shrink:0;';
      score.textContent = Math.round(file.score);
      row.appendChild(score);

      row.addEventListener('click', () => {
        this.onSelect(file.path);
        this._saveToHistory(this.query);
        el.style.display = 'none';
        this._input.blur();
      });

      row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.03)');
      row.addEventListener('mouseleave', () => row.style.background = '');

      el.appendChild(row);
    }

    el.style.display = 'block';
  }

  _renderHistorySuggestions() {
    if (this.query || !this.history.length) return;
    const el = this._suggestionsEl;
    el.innerHTML = '';
    const header = document.createElement('div');
    header.style.cssText = 'padding:6px 12px;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #222;';
    header.textContent = 'Recent searches';
    el.appendChild(header);
    for (const h of this.history.slice(0, 8)) {
      const row = document.createElement('div');
      row.dataset.history = h;
      row.className = 'nexus-touch';
      row.style.cssText = 'padding:8px 12px;display:flex;align-items:center;gap:10px;cursor:pointer;font-size:12px;color:#aaa;';
      row.innerHTML = `<i class="fas fa-history" style="color:#444;font-size:11px;"></i> <span>${h}</span>`;
      row.addEventListener('click', () => {
        this._input.value = h;
        this.query = h;
        this._performSearch();
      });
      row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.03)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      el.appendChild(row);
    }
    el.style.display = 'block';
  }

  _iconFor(type) {
    return {
      IMAGE: 'fa-image', VIDEO: 'fa-film', AUDIO: 'fa-wave-square',
      MODEL: 'fa-cube', PDF: 'fa-file-pdf', TEXT: 'fa-code',
      ARCHIVE: 'fa-file-archive', BINARY: 'fa-file',
    }[type] || 'fa-file';
  }

  _colorFor(type) {
    return {
      IMAGE: '#8a2be2', VIDEO: '#ff003c', AUDIO: '#00f0ff',
      MODEL: '#ff8800', PDF: '#ff003c', TEXT: '#00ff41',
      ARCHIVE: '#ffcc00', BINARY: '#666',
    }[type] || '#666';
  }

  _toggleFilterPanel() {
    const p = this._filterPanel;
    p.style.display = p.style.display === 'block' ? 'none' : 'block';
  }

  _updateFilterBadge() {
    let count = 0;
    if (this.filters.types.size) count += this.filters.types.size;
    if (this.filters.minSize !== null) count++;
    if (this.filters.maxSize !== null) count++;
    if (this.filters.dateRange) count++;
    if (count > 0) {
      this._filterBadge.textContent = count;
      this._filterBadge.style.display = 'block';
      this._filterBtn.style.color = 'var(--nexus-cyan)';
    } else {
      this._filterBadge.style.display = 'none';
      this._filterBtn.style.color = '#666';
    }
  }

  setQuery(query) {
    this._input.value = query;
    this.query = query;
    this._performSearch();
  }

  focus() {
    this._input.focus();
    this._input.select();
  }

  clear() {
    this._input.value = '';
    this.query = '';
    this._results = [];
    this.onSearch([]);
    this._suggestionsEl.style.display = 'none';
  }

  _saveToHistory(q) {
    if (!q || q.length < 2) return;
    this.history = [q, ...this.history.filter(h => h !== q)].slice(0, MAX_HISTORY);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
    } catch {}
  }

  _loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  }

  getResults() {
    return [...this._results];
  }

  destroy() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    if (this._filterPanel && this._filterPanel.parentNode) this._filterPanel.remove();
    this.container.innerHTML = '';
  }
}
