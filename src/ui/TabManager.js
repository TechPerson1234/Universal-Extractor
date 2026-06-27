// =============================================================================
// src/ui/TabManager.js
// =============================================================================
// Manages open tabs – rendering, switching, closing, pinning,
// session restore, and dirty state indicators.
// =============================================================================

export class TabManager {
  constructor(container, options = {}) {
    this.container = container;
    this.onSwitch = options.onSwitch || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onCloseAll = options.onCloseAll || (() => {});
    this.onPin = options.onPin || (() => {});

    this.tabs = []; // array of { path, name, pinned, dirty }
    this.activeTab = null;
    this.tabElements = new Map(); // path -> DOM element

    // Load session
    this._restoreSession();
  }

  /**
   * Set the list of open tabs
   */
  setTabs(paths, activePath = null) {
    this.tabs = paths.map(p => {
      const existing = this.tabs.find(t => t.path === p);
      if (existing) return existing;
      return {
        path: p,
        name: p.split('/').pop(),
        pinned: false,
        dirty: false,
      };
    });
    if (activePath && this.tabs.some(t => t.path === activePath)) {
      this.activeTab = activePath;
    } else if (this.tabs.length > 0) {
      this.activeTab = this.tabs[0].path;
    } else {
      this.activeTab = null;
    }
    this.render();
    this._saveSession();
  }

  /**
   * Add a tab
   */
  addTab(path, activate = true) {
    if (!this.tabs.some(t => t.path === path)) {
      this.tabs.push({
        path,
        name: path.split('/').pop(),
        pinned: false,
        dirty: false,
      });
    }
    if (activate) {
      this.activeTab = path;
    }
    this.render();
    this._saveSession();
    return this.tabs;
  }

  /**
   * Remove a tab
   */
  removeTab(path) {
    const idx = this.tabs.findIndex(t => t.path === path);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);
    if (this.activeTab === path) {
      this.activeTab = this.tabs.length > 0 ? this.tabs[0].path : null;
    }
    this.render();
    this._saveSession();
    if (this.activeTab) {
      this.onSwitch(this.activeTab);
    } else {
      // No tabs left
      this.onCloseAll();
    }
  }

  /**
   * Set active tab
   */
  setActiveTab(path) {
    if (this.tabs.some(t => t.path === path)) {
      this.activeTab = path;
      this.render();
      this._saveSession();
      this.onSwitch(path);
    }
  }

  /**
   * Mark a tab as dirty (unsaved changes)
   */
  setDirty(path, dirty = true) {
    const tab = this.tabs.find(t => t.path === path);
    if (tab) {
      tab.dirty = dirty;
      this.render();
    }
  }

  /**
   * Toggle pin state
   */
  togglePin(path) {
    const tab = this.tabs.find(t => t.path === path);
    if (tab) {
      tab.pinned = !tab.pinned;
      this.render();
      this._saveSession();
      this.onPin(path, tab.pinned);
    }
  }

  /**
   * Render tabs
   */
  render() {
    const container = this.container;
    container.innerHTML = '';

    if (this.tabs.length === 0) {
      // Show a placeholder
      const placeholder = document.createElement('div');
      placeholder.style.padding = '8px 12px';
      placeholder.style.color = 'var(--text-muted)';
      placeholder.style.fontSize = '13px';
      placeholder.textContent = 'No files open';
      container.appendChild(placeholder);
      return;
    }

    // Sort pinned tabs first
    const sorted = [...this.tabs];
    sorted.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });

    for (const tab of sorted) {
      const el = document.createElement('div');
      el.className = 'tab';
      if (tab.path === this.activeTab) {
        el.style.borderBottom = '2px solid var(--nexus-cyan)';
        el.style.color = 'var(--nexus-cyan)';
      } else {
        el.style.borderBottom = '2px solid transparent';
        el.style.color = '#aaa';
      }
      el.style.display = 'inline-flex';
      el.style.alignItems = 'center';
      el.style.padding = '4px 12px';
      el.style.cursor = 'pointer';
      el.style.fontSize = '13px';
      el.style.whiteSpace = 'nowrap';
      el.style.backgroundColor = 'transparent';
      el.style.transition = 'all 0.15s';
      el.style.gap = '6px';
      el.style.height = '100%';
      el.style.borderRight = '1px solid #222';

      // Pin icon if pinned
      if (tab.pinned) {
        const pin = document.createElement('i');
        pin.className = 'fas fa-thumbtack';
        pin.style.fontSize = '10px';
        pin.style.color = 'var(--nexus-cyan)';
        pin.style.transform = 'rotate(45deg)';
        el.appendChild(pin);
      }

      // Name
      const nameSpan = document.createElement('span');
      nameSpan.textContent = tab.name;
      el.appendChild(nameSpan);

      // Dirty indicator
      if (tab.dirty) {
        const dot = document.createElement('span');
        dot.style.width = '8px';
        dot.style.height = '8px';
        dot.style.borderRadius = '50%';
        dot.style.backgroundColor = '#ffcc00';
        dot.style.display = 'inline-block';
        dot.style.marginLeft = '4px';
        el.appendChild(dot);
      }

      // Close button
      const closeBtn = document.createElement('i');
      closeBtn.className = 'fas fa-times';
      closeBtn.style.fontSize = '12px';
      closeBtn.style.marginLeft = '6px';
      closeBtn.style.color = '#666';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.transition = 'color 0.15s';
      closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.color = '#fff';
      });
      closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.color = '#666';
      });
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeTab(tab.path);
      });
      el.appendChild(closeBtn);

      // Click to switch
      el.addEventListener('click', () => {
        if (tab.path !== this.activeTab) {
          this.setActiveTab(tab.path);
        }
      });

      // Double-click to toggle pin
      el.addEventListener('dblclick', () => {
        this.togglePin(tab.path);
      });

      container.appendChild(el);
      this.tabElements.set(tab.path, el);
    }
  }

  /**
   * Get the list of tab paths
   */
  getTabPaths() {
    return this.tabs.map(t => t.path);
  }

  /**
   * Get active tab path
   */
  getActiveTab() {
    return this.activeTab;
  }

  /**
   * Close all tabs
   */
  closeAll() {
    this.tabs = [];
    this.activeTab = null;
    this.render();
    this._saveSession();
    this.onCloseAll();
  }

  // ---------------------------------------------------------------------------
  // Session persistence
  // ---------------------------------------------------------------------------
  _saveSession() {
    try {
      const data = {
        tabs: this.tabs.map(t => ({ path: t.path, pinned: t.pinned })),
        active: this.activeTab,
      };
      localStorage.setItem('nexus-tabs', JSON.stringify(data));
    } catch (e) {}
  }

  _restoreSession() {
    try {
      const raw = localStorage.getItem('nexus-tabs');
      if (raw) {
        const data = JSON.parse(raw);
        this.tabs = data.tabs.map(t => ({
          path: t.path,
          name: t.path.split('/').pop(),
          pinned: t.pinned || false,
          dirty: false,
        }));
        this.activeTab = data.active || (this.tabs.length > 0 ? this.tabs[0].path : null);
        // Validate paths exist in VFS? We'll let App handle that.
      }
    } catch (e) {}
  }
}