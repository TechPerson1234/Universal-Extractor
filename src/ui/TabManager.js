const SESSION_KEY = 'nexus-tabs-v5';
const SWIPE_THRESHOLD = 80;

export class TabManager {
  constructor(container, options = {}) {
    this.container = container;
    this.onSwitch = options.onSwitch || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onCloseAll = options.onCloseAll || (() => {});
    this.onPin = options.onPin || (() => {});
    this.onReorder = options.onReorder || (() => {});

    this.tabs = [];
    this.activeTab = null;
    this._tabEls = new Map();
    this._dragState = null;
    this._splitMode = false;
    this._splitSecond = null;

    this._restoreSession();
  }

  setTabs(paths, activePath = null) {
    const existing = new Map(this.tabs.map(t => [t.path, t]));
    this.tabs = paths.map(p => {
      if (existing.has(p)) return existing.get(p);
      return {
        path: p,
        name: this._extractName(p),
        pinned: false,
        dirty: false,
        created: Date.now(),
      };
    });
    if (activePath && this.tabs.some(t => t.path === activePath)) {
      this.activeTab = activePath;
    } else if (this.tabs.length && !this.activeTab) {
      this.activeTab = this.tabs[0].path;
    }
    if (!this.tabs.some(t => t.path === this.activeTab)) {
      this.activeTab = this.tabs[0]?.path || null;
    }
    this.render();
    this._saveSession();
  }

  addTab(path, activate = true) {
    let tab = this.tabs.find(t => t.path === path);
    if (!tab) {
      tab = {
        path,
        name: this._extractName(path),
        pinned: false,
        dirty: false,
        created: Date.now(),
      };
      this.tabs.push(tab);
    }
    if (activate) this.activeTab = path;
    this.render();
    this._saveSession();
    return tab;
  }

  removeTab(path) {
    const idx = this.tabs.findIndex(t => t.path === path);
    if (idx === -1) return;
    const tab = this.tabs[idx];
    if (tab.dirty) {
      if (!confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) return;
    }
    this.tabs.splice(idx, 1);
    if (this.activeTab === path) {
      const next = this.tabs[idx] || this.tabs[idx - 1] || null;
      this.activeTab = next ? next.path : null;
    }
    if (this._splitSecond === path) this._splitSecond = null;
    this.render();
    this._saveSession();
    if (this.activeTab) this.onSwitch(this.activeTab);
    else this.onCloseAll();
  }

  setActiveTab(path) {
    if (!this.tabs.some(t => t.path === path)) return;
    if (this.activeTab === path) return;
    this.activeTab = path;
    this.render();
    this._saveSession();
    this.onSwitch(path);
  }

  setDirty(path, dirty = true) {
    const tab = this.tabs.find(t => t.path === path);
    if (!tab) return;
    if (tab.dirty === dirty) return;
    tab.dirty = dirty;
    this.render();
  }

  togglePin(path) {
    const tab = this.tabs.find(t => t.path === path);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    this.render();
    this._saveSession();
    this.onPin(path, tab.pinned);
  }

  closeAll() {
    const dirty = this.tabs.filter(t => t.dirty);
    if (dirty.length) {
      if (!confirm(`${dirty.length} tab(s) with unsaved changes. Close all?`)) return;
    }
    this.tabs = [];
    this.activeTab = null;
    this._splitSecond = null;
    this.render();
    this._saveSession();
    this.onCloseAll();
  }

  closeOthers(path) {
    this.tabs = this.tabs.filter(t => t.path === path || t.pinned);
    this.activeTab = path;
    this.render();
    this._saveSession();
    this.onSwitch(path);
  }

  enableSplit(path) {
    this._splitMode = true;
    this._splitSecond = path;
    this.render();
  }

  disableSplit() {
    this._splitMode = false;
    this._splitSecond = null;
    this.render();
  }

  getSplit() {
    return this._splitMode ? this._splitSecond : null;
  }

  render() {
    const container = this.container;
    container.innerHTML = '';
    this._tabEls.clear();

    if (!this.tabs.length) {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'padding:10px 16px;color:var(--text-muted);font-size:12px;font-family:monospace;';
      placeholder.textContent = '◇ No files open';
      container.appendChild(placeholder);
      return;
    }

    const pinned = this.tabs.filter(t => t.pinned);
    const unpinned = this.tabs.filter(t => !t.pinned);
    const sorted = [...pinned, ...unpinned];

    for (const tab of sorted) {
      const el = this._createTabElement(tab);
      container.appendChild(el);
      this._tabEls.set(tab.path, el);
    }

    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex:1;min-width:0;';
    container.appendChild(spacer);

    const closeAllBtn = document.createElement('button');
    closeAllBtn.className = 'nexus-touch';
    closeAllBtn.innerHTML = '<i class="fas fa-times-circle"></i>';
    closeAllBtn.title = 'Close all tabs';
    closeAllBtn.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;padding:8px 12px;font-size:14px;flex-shrink:0;';
    closeAllBtn.addEventListener('mouseenter', () => closeAllBtn.style.color = '#ff003c');
    closeAllBtn.addEventListener('mouseleave', () => closeAllBtn.style.color = '#666');
    closeAllBtn.addEventListener('click', () => this.closeAll());
    container.appendChild(closeAllBtn);
  }

  _createTabElement(tab) {
    const el = document.createElement('div');
    const isActive = tab.path === this.activeTab;
    const isSplit = this._splitSecond === tab.path;

    el.className = 'nexus-touch vfs-tab';
    el.dataset.path = tab.path;
    el.style.cssText = `
      display:inline-flex;align-items:center;gap:6px;
      padding:6px 10px 6px 12px;cursor:pointer;font-size:12px;
      white-space:nowrap;background:${isActive ? 'var(--bg-void)' : 'transparent'};
      color:${isActive ? 'var(--nexus-cyan)' : '#999'};
      border-bottom:2px solid ${isActive ? 'var(--nexus-cyan)' : (isSplit ? '#8a2be2' : 'transparent')};
      border-right:1px solid #1a1a1a;height:100%;min-width:100px;max-width:200px;
      position:relative;transition:background 0.12s,color 0.12s;
    `;

    if (tab.pinned) {
      const pin = document.createElement('i');
      pin.className = 'fas fa-thumbtack';
      pin.style.cssText = 'font-size:9px;color:var(--nexus-cyan);transform:rotate(45deg);flex-shrink:0;';
      el.appendChild(pin);
    }

    const icon = document.createElement('i');
    icon.className = `fas ${this._iconForPath(tab.path)}`;
    icon.style.cssText = 'font-size:11px;opacity:0.7;flex-shrink:0;';
    el.appendChild(icon);

    const name = document.createElement('span');
    name.textContent = tab.name;
    name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;';
    el.appendChild(name);

    if (tab.dirty) {
      const dot = document.createElement('span');
      dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#ffcc00;flex-shrink:0;';
      el.appendChild(dot);
    }

    const closeBtn = document.createElement('i');
    closeBtn.className = 'fas fa-times';
    closeBtn.style.cssText = 'font-size:11px;opacity:0.4;padding:2px;flex-shrink:0;';
    closeBtn.addEventListener('mouseenter', () => closeBtn.style.opacity = '1');
    closeBtn.addEventListener('mouseleave', () => closeBtn.style.opacity = '0.4');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeTab(tab.path);
    });
    el.appendChild(closeBtn);

    el.addEventListener('click', () => {
      if (tab.path !== this.activeTab) this.setActiveTab(tab.path);
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showTabMenu(e.clientX, e.clientY, tab);
    });

    el.addEventListener('dblclick', (e) => {
      if (e.target === closeBtn) return;
      this.togglePin(tab.path);
    });

    if (!tab.pinned) {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        this._dragState = { path: tab.path, fromIndex: this.tabs.indexOf(tab) };
        e.dataTransfer.setData('text/plain', tab.path);
        el.style.opacity = '0.4';
      });
      el.addEventListener('dragend', () => {
        el.style.opacity = '1';
        this._dragState = null;
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.style.borderLeft = '2px solid var(--nexus-cyan)';
      });
      el.addEventListener('dragleave', () => {
        el.style.borderLeft = '';
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.style.borderLeft = '';
        const srcPath = e.dataTransfer.getData('text/plain');
        if (srcPath && srcPath !== tab.path && this._dragState) {
          this._reorderTabs(srcPath, tab.path);
        }
      });
    }

    let touchStartX = 0;
    let touchCurrentX = 0;
    el.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchCurrentX = touchStartX;
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      touchCurrentX = e.touches[0].clientX;
      const dx = touchCurrentX - touchStartX;
      if (Math.abs(dx) > 10) el.style.transform = `translateX(${dx * 0.5}px)`;
    }, { passive: true });
    el.addEventListener('touchend', () => {
      el.style.transform = '';
      const dx = touchCurrentX - touchStartX;
      if (Math.abs(dx) > SWIPE_THRESHOLD && tab.dirty) {
        this.removeTab(tab.path);
      }
    });

    el.addEventListener('mouseenter', () => {
      if (!isActive) el.style.background = 'rgba(255,255,255,0.03)';
    });
    el.addEventListener('mouseleave', () => {
      if (!isActive) el.style.background = 'transparent';
    });

    return el;
  }

  _reorderTabs(srcPath, targetPath) {
    const srcIdx = this.tabs.findIndex(t => t.path === srcPath);
    const tgtIdx = this.tabs.findIndex(t => t.path === targetPath);
    if (srcIdx === -1 || tgtIdx === -1) return;
    const [moved] = this.tabs.splice(srcIdx, 1);
    this.tabs.splice(tgtIdx, 0, moved);
    this.render();
    this._saveSession();
    this.onReorder(this.tabs.map(t => t.path));
  }

  _showTabMenu(x, y, tab) {
    const menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;background:var(--bg-panel);border:1px solid #333;border-radius:6px;padding:4px 0;min-width:160px;box-shadow:0 8px 24px rgba(0,0,0,0.85);z-index:9999;';

    const actions = [
      { action: 'pin', label: tab.pinned ? 'Unpin' : 'Pin', icon: 'fa-thumbtack' },
      { action: 'close', label: 'Close', icon: 'fa-times' },
      { action: 'closeOthers', label: 'Close Others', icon: 'fa-times-circle' },
      { action: 'split', label: this._splitSecond === tab.path ? 'Unsplit' : 'Split View', icon: 'fa-columns' },
      { action: 'copyPath', label: 'Copy Path', icon: 'fa-link' },
    ];

    for (const act of actions) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:10px;color:#ccc;';
      row.innerHTML = `<i class="fas ${act.icon}" style="width:16px;color:#888;"></i> ${act.label}`;
      row.addEventListener('mouseenter', () => row.style.background = 'rgba(0,240,255,0.1)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', () => {
        menu.remove();
        this._handleTabMenuAction(act.action, tab);
      });
      menu.appendChild(row);
    }

    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
    document.body.appendChild(menu);
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  _handleTabMenuAction(action, tab) {
    switch (action) {
      case 'pin': return this.togglePin(tab.path);
      case 'close': return this.removeTab(tab.path);
      case 'closeOthers': return this.closeOthers(tab.path);
      case 'split':
        if (this._splitSecond === tab.path) this.disableSplit();
        else this.enableSplit(tab.path);
        return;
      case 'copyPath':
        if (navigator.clipboard) navigator.clipboard.writeText(tab.path);
        return;
    }
  }

  _extractName(path) {
    return path.split('/').pop() || path;
  }

  _iconForPath(path) {
    const name = path.toLowerCase();
    if (/\.(png|jpg|jpeg|gif|webp|bmp|svg|avif)$/.test(name)) return 'fa-image';
    if (/\.(mp4|webm|mov|avi|mkv)$/.test(name)) return 'fa-film';
    if (/\.(mp3|wav|ogg|flac|m4a)$/.test(name)) return 'fa-wave-square';
    if (/\.(pdf)$/.test(name)) return 'fa-file-pdf';
    if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return 'fa-file-archive';
    if (/\.(js|ts|json|html|css|py|rb|go|rs|java|c|cpp)$/.test(name)) return 'fa-code';
    if (/\.(obj|stl|gltf|glb|fbx)$/.test(name)) return 'fa-cube';
    return 'fa-file';
  }

  getTabs() {
    return this.tabs.map(t => ({ ...t }));
  }

  getActiveTab() {
    return this.activeTab;
  }

  getDirtyTabs() {
    return this.tabs.filter(t => t.dirty).map(t => t.path);
  }

  _saveSession() {
    try {
      const data = {
        tabs: this.tabs.map(t => ({ path: t.path, pinned: t.pinned })),
        active: this.activeTab,
        savedAt: Date.now(),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch {}
  }

  _restoreSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this.tabs = (data.tabs || []).map(t => ({
        path: t.path,
        name: this._extractName(t.path),
        pinned: t.pinned || false,
        dirty: false,
        created: Date.now(),
      }));
      this.activeTab = data.active || (this.tabs[0]?.path || null);
    } catch {}
  }

  destroy() {
    this.container.innerHTML = '';
    this._tabEls.clear();
  }
}
