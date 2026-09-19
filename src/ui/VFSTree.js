const ITEM_HEIGHT = 32;
const OVERSCAN = 8;
const LONG_PRESS_MS = 550;
const SWIPE_THRESHOLD = 60;

const ICON_MAP = {
  folder: 'fa-folder',
  IMAGE: 'fa-image',
  VIDEO: 'fa-film',
  AUDIO: 'fa-wave-square',
  MODEL: 'fa-cube',
  PDF: 'fa-file-pdf',
  TEXT: 'fa-code',
  ARCHIVE: 'fa-file-archive',
  BINARY: 'fa-file',
};

const COLOR_MAP = {
  folder: '#fbbf24',
  IMAGE: '#8a2be2',
  VIDEO: '#ff003c',
  AUDIO: '#00f0ff',
  MODEL: '#ff8800',
  PDF: '#ff003c',
  TEXT: '#00ff41',
  ARCHIVE: '#ffcc00',
  BINARY: '#666',
};

export class VFSTree {
  constructor(container, options = {}) {
    this.container = container;
    this.vfs = options.vfs;
    this.onSelect = options.onSelect || (() => {});
    this.onContextMenu = options.onContextMenu || (() => {});
    this.onCreateFolder = options.onCreateFolder || (() => {});
    this.onMultiSelect = options.onMultiSelect || (() => {});

    this.currentPath = '/';
    this.items = [];
    this.selectedPaths = new Set();
    this.focusedPath = null;
    this.contextMenu = null;
    this.expandedFolders = new Set(['/']);
    this._itemEls = new Map();
    this._visibleRange = { start: 0, end: 0 };
    this._scrollRaf = null;
    this._touchState = new Map();
    this._dragState = null;
    this._renamingPath = null;
    this._sortMode = 'name-asc';
    this._filterType = null;
    this._searchResults = null;
    this._contextMenuSetup = false;
    this._globalListenersSetup = false;

    this._setupContextMenu();
    this._setupGlobalListeners();
  }

  async init() {
    this._setupContextMenu();
    this._setupGlobalListeners();
    await this.render('/');
  }

  async render(path = this.currentPath) {
    if (path !== this.currentPath) this.currentPath = path;
    try {
      this.items = this.vfs.listFolder(this.currentPath);
    } catch (err) {
      this.items = [];
      console.error('VFSTree render failed:', err);
    }
    this._applySort();
    this._applyFilter();
    this._renderVisible();
    this._updateStats();
  }

  refresh() {
    return this.render(this.currentPath);
  }

  _applySort() {
    const [key, dir] = this._sortMode.split('-');
    const mul = dir === 'desc' ? -1 : 1;
    this.items.sort((a, b) => {
      const aFolder = a.kind === 'folder' ? 0 : 1;
      const bFolder = b.kind === 'folder' ? 0 : 1;
      if (aFolder !== bFolder) return aFolder - bFolder;
      if (key === 'name') return mul * a.name.localeCompare(b.name);
      if (key === 'size') return mul * ((a.size || 0) - (b.size || 0));
      if (key === 'type') return mul * (a.type || '').localeCompare(b.type || '');
      if (key === 'date') return mul * ((a.modified || 0) - (b.modified || 0));
      return 0;
    });
  }

  _applyFilter() {
    if (!this._filterType) return;
    if (this._filterType === 'all') return;
    this.items = this.items.filter(i =>
      i.kind === 'folder' || i.type === this._filterType
    );
  }

  setSort(mode) {
    this._sortMode = mode;
    this.render();
  }

  setFilter(type) {
    this._filterType = type;
    this.render();
  }

  _renderVisible() {
    const container = this.container;
    if (!container) return;
    const scrollTop = container.scrollTop;
    const viewH = container.clientHeight;
    const total = this.items.length;
    const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
    const end = Math.min(total, Math.ceil((scrollTop + viewH) / ITEM_HEIGHT) + OVERSCAN);
    this._visibleRange = { start, end };

    const fragment = document.createDocumentFragment();

    const topSpacer = document.createElement('div');
    topSpacer.style.height = (start * ITEM_HEIGHT) + 'px';
    fragment.appendChild(topSpacer);

    for (let i = start; i < end; i++) {
      const el = this._createItemElement(this.items[i], i);
      fragment.appendChild(el);
    }

    const bottomSpacer = document.createElement('div');
    bottomSpacer.style.height = ((total - end) * ITEM_HEIGHT) + 'px';
    fragment.appendChild(bottomSpacer);

    container.innerHTML = '';
    container.appendChild(fragment);
    this._itemEls.clear();
  }

  _createItemElement(item, index) {
    const el = document.createElement('div');
    el.className = 'vfs-item nexus-touch';
    el.dataset.path = item.path;
    el.dataset.kind = item.kind;
    el.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:4px 8px;height:${ITEM_HEIGHT}px;cursor:pointer;border-radius:4px;transition:background 0.12s;color:#ccc;font-size:13px;position:relative;overflow:hidden;`;

    if (this.selectedPaths.has(item.path)) {
      el.style.background = 'rgba(0,240,255,0.15)';
      el.style.color = 'var(--nexus-cyan)';
    }

    const left = document.createElement('div');
    left.style.cssText = 'display:flex;align-items:center;gap:8px;overflow:hidden;flex:1;min-width:0;';

    if (item.kind === 'folder') {
      const chev = document.createElement('i');
      chev.className = `fas fa-chevron-${this.expandedFolders.has(item.path) ? 'down' : 'right'}`;
      chev.style.cssText = 'font-size:9px;color:#666;width:10px;';
      left.appendChild(chev);
    }

    const icon = document.createElement('i');
    const iconClass = item.kind === 'folder' ? ICON_MAP.folder : (ICON_MAP[item.type] || ICON_MAP.BINARY);
    icon.className = `fas ${iconClass}`;
    icon.style.cssText = `width:16px;text-align:center;color:${item.kind === 'folder' ? COLOR_MAP.folder : (COLOR_MAP[item.type] || '#666')};`;
    left.appendChild(icon);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'vfs-name';
    nameSpan.textContent = item.name;
    nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    left.appendChild(nameSpan);

    if (this._searchResults && this._searchResults.has(item.path)) {
      const badge = document.createElement('span');
      badge.textContent = '★';
      badge.style.cssText = 'font-size:9px;color:#ffcc00;margin-left:4px;';
      left.appendChild(badge);
    }

    el.appendChild(left);

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';

    if (item.kind !== 'folder' && item.size) {
      const sizeSpan = document.createElement('span');
      sizeSpan.textContent = this._formatBytes(item.size);
      sizeSpan.style.cssText = 'font-size:10px;color:#555;font-family:monospace;';
      right.appendChild(sizeSpan);
    }

    if (item.tags && item.tags.length) {
      const tagDot = document.createElement('span');
      tagDot.textContent = `●${item.tags.length}`;
      tagDot.style.cssText = 'font-size:9px;color:#8a2be2;';
      right.appendChild(tagDot);
    }

    el.appendChild(right);

    this._attachItemEvents(el, item);
    this._itemEls.set(item.path, el);
    return el;
  }

  _attachItemEvents(el, item) {
    let longPressTimer = null;
    let startX = 0, startY = 0;
    let touchMoved = false;

    el.addEventListener('click', (e) => {
      if (this._renamingPath === item.path) return;
      const multi = e.ctrlKey || e.metaKey || e.shiftKey;
      this._handleSelect(item, multi);
    });

    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (item.kind === 'folder') {
        if (this.expandedFolders.has(item.path)) {
          this.expandedFolders.delete(item.path);
        } else {
          this.expandedFolders.add(item.path);
        }
        this.render(item.path);
      } else {
        this.onSelect(item.path);
      }
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.selectedPaths.has(item.path)) {
        this.selectedPaths.clear();
        this.selectedPaths.add(item.path);
        this._renderVisible();
      }
      const x = e.clientX;
      const y = e.clientY;
      requestAnimationFrame(() => {
        this._showContextMenu(x, y, item);
      });
    });

    el.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      touchMoved = false;
      longPressTimer = setTimeout(() => {
        if (!touchMoved) {
          if (navigator.vibrate) navigator.vibrate(15);
          this.selectedPaths.clear();
          this.selectedPaths.add(item.path);
          this._renderVisible();
          this._showContextMenu(touch.clientX, touch.clientY, item);
        }
      }, LONG_PRESS_MS);
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        touchMoved = true;
        clearTimeout(longPressTimer);
        if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dy) < 30) {
          this._handleSwipe(el, item, dx > 0 ? 'right' : 'left');
        }
      }
    }, { passive: true });

    el.addEventListener('touchend', () => {
      clearTimeout(longPressTimer);
    });

    el.addEventListener('mouseenter', () => {
      if (!this.selectedPaths.has(item.path)) {
        el.style.background = 'rgba(255,255,255,0.04)';
      }
    });
    el.addEventListener('mouseleave', () => {
      if (!this.selectedPaths.has(item.path)) {
        el.style.background = '';
      }
    });

    if (item.kind === 'file') {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        this._dragState = { path: item.path, name: item.name };
        e.dataTransfer.setData('text/plain', item.path);
        e.dataTransfer.effectAllowed = 'copyMove';
        el.style.opacity = '0.5';
      });
      el.addEventListener('dragend', () => {
        el.style.opacity = '1';
        this._dragState = null;
      });
    }

    if (item.kind === 'folder') {
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.style.background = 'rgba(0,240,255,0.2)';
      });
      el.addEventListener('dragleave', () => {
        if (!this.selectedPaths.has(item.path)) el.style.background = '';
      });
      el.addEventListener('drop', async (e) => {
        e.preventDefault();
        el.style.background = '';
        const srcPath = e.dataTransfer.getData('text/plain');
        if (srcPath && srcPath !== item.path) {
          const fileName = srcPath.split('/').pop();
          const destPath = item.path === '/' ? '/' + fileName : item.path + '/' + fileName;
          try {
            await this.vfs.moveFile(srcPath, destPath);
            this.refresh();
          } catch (err) {
            console.error('Move failed:', err);
          }
        }
      });
    }
  }

  _handleSwipe(el, item, direction) {
    el.animate([
      { transform: `translateX(${direction === 'left' ? '-20px' : '20px'})` },
      { transform: 'translateX(0)' },
    ], { duration: 200, easing: 'ease-out' });
    if (direction === 'left') {
      this.onContextMenu(item.path, 'delete');
    } else {
      this.onContextMenu(item.path, 'rename');
    }
  }

  _handleSelect(item, multi = false) {
    if (multi) {
      if (this.selectedPaths.has(item.path)) this.selectedPaths.delete(item.path);
      else this.selectedPaths.add(item.path);
    } else {
      this.selectedPaths.clear();
      this.selectedPaths.add(item.path);
    }
    this.focusedPath = item.path;
    this._renderVisible();
    if (item.kind === 'file') this.onSelect(item.path);
    if (this.selectedPaths.size > 1) {
      this.onMultiSelect(Array.from(this.selectedPaths));
    }
  }

  selectItem(path) {
    this.selectedPaths.clear();
    this.selectedPaths.add(path);
    this._renderVisible();
    const el = this._itemEls.get(path);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  highlightResults(results) {
    this._searchResults = new Set(results.map(r => r.path));
    this._renderVisible();
  }

  clearHighlight() {
    this._searchResults = null;
    this._renderVisible();
  }

  _showContextMenu(x, y, item) {
    if (!this.contextMenu) {
      console.warn('[VFSTree] context menu not initialized, calling _setupContextMenu');
      this._setupContextMenu();
    }
    const menu = this.contextMenu;
    if (!menu) return;
    menu.innerHTML = '';

    const actions = this._buildActionsFor(item);
    for (const act of actions) {
      if (act.separator) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:#333;margin:4px 0;';
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'nexus-touch';
      row.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:10px;color:#ccc;';
      row.innerHTML = `<i class="fas ${act.icon}" style="width:16px;color:${act.color || '#888'};"></i> ${act.label}`;
      row.addEventListener('mouseenter', () => row.style.background = 'rgba(0,240,255,0.1)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = 'none';
        this.onContextMenu(item.path, act.action);
      });
      menu.appendChild(row);
    }

    menu.style.display = 'block';
    menu.style.visibility = 'hidden';
    const menuW = menu.offsetWidth || 200;
    const menuH = menu.offsetHeight || 200;
    menu.style.visibility = '';
    const maxX = window.innerWidth - menuW - 8;
    const maxY = window.innerHeight - menuH - 8;
    menu.style.left = Math.max(8, Math.min(x, maxX)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, maxY)) + 'px';
  }

  _buildActionsFor(item) {
    if (item.kind === 'folder') {
      return [
        { action: 'new-file', label: 'New File', icon: 'fa-file-plus', color: '#00f0ff' },
        { action: 'rename', label: 'Rename', icon: 'fa-edit', color: '#ffcc00' },
        { action: 'delete', label: 'Delete', icon: 'fa-trash', color: '#ff003c' },
      ];
    }
    return [
      { action: 'open', label: 'Open', icon: 'fa-folder-open', color: '#00f0ff' },
      { action: 'export', label: 'Export', icon: 'fa-download', color: '#00ff41' },
      { separator: true },
      { action: 'rename', label: 'Rename', icon: 'fa-edit', color: '#ffcc00' },
      { action: 'duplicate', label: 'Duplicate', icon: 'fa-copy', color: '#8a2be2' },
      { separator: true },
      { action: 'checksum', label: 'Checksum', icon: 'fa-shield-alt', color: '#00ff41' },
      { action: 'verify', label: 'Verify', icon: 'fa-check-double', color: '#00ff41' },
      { action: 'add-tag', label: 'Add Tag', icon: 'fa-tag', color: '#8a2be2' },
      { separator: true },
      { action: 'share', label: 'Share', icon: 'fa-share-alt', color: '#00f0ff' },
      { action: 'info', label: 'Properties', icon: 'fa-info-circle', color: '#00f0ff' },
      { separator: true },
      { action: 'delete', label: 'Delete', icon: 'fa-trash', color: '#ff003c' },
    ];
  }

  _setupContextMenu() {
    if (this._contextMenuSetup && this.contextMenu) return;
    this._contextMenuSetup = true;
    if (this.contextMenu) {
      try { this.contextMenu.remove(); } catch {}
    }
    this.contextMenu = document.createElement('div');
    this.contextMenu.style.cssText = 'position:fixed;background:var(--bg-panel);border:1px solid #333;border-radius:6px;padding:4px 0;min-width:180px;box-shadow:0 8px 24px rgba(0,0,0,0.85);z-index:99999;display:none;';
    document.body.appendChild(this.contextMenu);
    document.addEventListener('click', () => {
      if (this.contextMenu) this.contextMenu.style.display = 'none';
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.contextMenu && !this.contextMenu.contains(e.target)) {
        const insideTree = e.target.closest && e.target.closest('.vfs-item');
        if (!insideTree) this.contextMenu.style.display = 'none';
      }
    });
  }

  _setupGlobalListeners() {
    if (this._globalListenersSetup) return;
    this._globalListenersSetup = true;

    this.container.addEventListener('scroll', () => {
      if (this._scrollRaf) return;
      this._scrollRaf = requestAnimationFrame(() => {
        this._scrollRaf = null;
        this._renderVisible();
      });
    });

    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._moveFocus(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._moveFocus(-1);
      } else if (e.key === 'Enter' && this.focusedPath) {
        const item = this.items.find(i => i.path === this.focusedPath);
        if (item) this._handleSelect(item);
      }
    });

    this.container.setAttribute('tabindex', '0');

    document.addEventListener('nexus:search', (e) => {
      const q = e.detail?.query;
      if (q && this.vfs) {
        const results = this.vfs.search(q);
        this.highlightResults(results);
      }
    });

    const newFolderBtn = document.getElementById('vfs-new-folder');
    if (newFolderBtn) {
      newFolderBtn.addEventListener('click', () => {
        const name = prompt('Folder name:');
        if (name && name.trim()) this.onCreateFolder(name.trim());
      });
    }

    const refreshBtn = document.getElementById('vfs-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refresh());
    }
  }

  _moveFocus(delta) {
    const currentIdx = this.items.findIndex(i => i.path === this.focusedPath);
    const nextIdx = Math.max(0, Math.min(this.items.length - 1, currentIdx + delta));
    if (nextIdx === -1 || !this.items[nextIdx]) return;
    this.focusedPath = this.items[nextIdx].path;
    this.selectItem(this.focusedPath);
  }

  async startRename(path) {
    const el = this._itemEls.get(path);
    if (!el) return;
    const nameSpan = el.querySelector('.vfs-name');
    if (!nameSpan) return;
    const currentName = nameSpan.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.style.cssText = 'flex:1;background:#0a0a0a;border:1px solid var(--nexus-cyan);color:white;padding:2px 6px;border-radius:3px;font-size:13px;font-family:inherit;';
    this._renamingPath = path;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const commit = async () => {
      const newName = input.value.trim();
      this._renamingPath = null;
      if (newName && newName !== currentName) {
        this.onContextMenu(path, 'rename-with:' + newName);
      } else {
        this.refresh();
      }
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') {
        this._renamingPath = null;
        input.value = currentName;
        input.blur();
      }
    });
  }

  _updateStats() {
    const el = document.getElementById('vfs-stats');
    if (el) {
      const files = this.items.filter(i => i.kind === 'file').length;
      const folders = this.items.filter(i => i.kind === 'folder').length;
      el.textContent = `${folders}D ${files}F`;
    }
    if (this.vfs) {
      const quotaEl = document.getElementById('vfs-quota');
      if (quotaEl && navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(est => {
          const pct = est.quota ? ((est.usage / est.quota) * 100).toFixed(0) : 0;
          if (quotaEl) {
            quotaEl.textContent = `${pct}%`;
            quotaEl.style.color = pct > 85 ? '#ff003c' : pct > 60 ? '#ffcc00' : 'var(--nexus-cyan)';
          }
        }).catch(() => {});
      }
    }
  }

  _formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getSelection() {
    return Array.from(this.selectedPaths);
  }

  destroy() {
    if (this.contextMenu) this.contextMenu.remove();
    this.container.innerHTML = '';
    this._itemEls.clear();
  }
}
