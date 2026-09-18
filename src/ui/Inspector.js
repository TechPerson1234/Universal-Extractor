export class Inspector {
  constructor(container, options = {}) {
    this.container = container;
    this.vfs = options.vfs;
    this.pluginRegistry = options.pluginRegistry;
    this.editorSurface = options.editorSurface || document.getElementById('editor-surface');
    this.onAction = options.onAction || (() => {});

    this.currentFile = null;
    this.currentPath = null;
    this.currentPlugin = null;
    this.currentInstance = null;
    this.toolsContainer = null;
    this.metaSection = null;
    this.actionsSection = null;
    this.collapsed = new Set();

    this.actions = [
      { id: 'export', label: 'Export', icon: 'fa-download', color: 'var(--nexus-cyan)' },
      { id: 'share', label: 'Share', icon: 'fa-share-alt', color: '#00f0ff' },
      { id: 'rename', label: 'Rename', icon: 'fa-edit', color: '#fbbf24' },
      { id: 'duplicate', label: 'Duplicate', icon: 'fa-copy', color: '#8a2be2' },
      { id: 'checksum', label: 'Checksum', icon: 'fa-shield-alt', color: '#00ff41' },
      { id: 'verify', label: 'Verify', icon: 'fa-check-double', color: '#00ff41' },
      { id: 'info', label: 'Properties', icon: 'fa-info-circle', color: '#00f0ff' },
      { id: 'delete', label: 'Delete', icon: 'fa-trash', color: '#ff003c' },
    ];

    this.clear();
  }

  async loadFile(file) {
    this.currentFile = file;
    this.currentPath = file.path;
    this.container.innerHTML = '';

    this.metaSection = this._createSection('Metadata', 'fa-info-circle', true);
    this._renderMetadata(file);
    this.container.appendChild(this.metaSection);

    this.actionsSection = this._createSection('Actions', 'fa-bolt', true);
    this._renderActions(file);
    this.container.appendChild(this.actionsSection);

    const toolsSection = this._createSection('Tools', 'fa-wrench', true);
    this.toolsContainer = document.createElement('div');
    this.toolsContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    toolsSection.appendChild(this.toolsContainer);
    this.container.appendChild(toolsSection);

    await this._loadPlugin(file);
  }

  clear() {
    if (this.currentInstance && typeof this.currentInstance.destroy === 'function') {
      try { this.currentInstance.destroy(); } catch {}
    }
    this.currentFile = null;
    this.currentPath = null;
    this.currentPlugin = null;
    this.currentInstance = null;
    this.toolsContainer = null;

    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:20px;text-align:center;gap:8px;">
        <i class="fas fa-terminal" style="font-size:36px;color:var(--text-muted);opacity:0.3;"></i>
        <p style="color:var(--text-muted);font-size:11px;font-family:monospace;letter-spacing:0.1em;">&gt; NO TARGET &lt;</p>
      </div>
    `;

    if (this.editorSurface) {
      this.editorSurface.innerHTML = `
        <div style="text-align:center;opacity:0.2;pointer-events:none;padding:20px;">
          <i class="fas fa-skull" style="font-size:80px;color:white;"></i>
          <h2 style="font-size:28px;font-weight:900;letter-spacing:0.2em;color:white;margin-top:8px;">NEXUS IDLE</h2>
        </div>
      `;
    }
  }

  _createSection(title, icon, collapsible = false) {
    const section = document.createElement('div');
    section.style.cssText = 'border-bottom:1px solid #222;padding-bottom:12px;margin-bottom:12px;';

    const header = document.createElement('div');
    header.className = collapsible ? 'nexus-touch' : '';
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0;cursor:' + (collapsible ? 'pointer' : 'default') + ';';
    const isCollapsed = this.collapsed.has(title);
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;font-size:11px;font-weight:bold;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">
        <i class="fas ${icon}" style="color:var(--nexus-cyan);font-size:11px;"></i>
        <span>${title}</span>
      </div>
      ${collapsible ? `<i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'}" style="color:#555;font-size:10px;"></i>` : ''}
    `;

    const body = document.createElement('div');
    body.style.cssText = `margin-top:8px;${isCollapsed ? 'display:none;' : ''}`;

    if (collapsible) {
      header.addEventListener('click', () => {
        const wasCollapsed = this.collapsed.has(title);
        if (wasCollapsed) this.collapsed.delete(title);
        else this.collapsed.add(title);
        const chev = header.querySelector('.fa-chevron-right, .fa-chevron-down');
        if (chev) {
          chev.className = `fas fa-chevron-${wasCollapsed ? 'down' : 'right'}`;
          chev.style.color = '#555';
        }
        body.style.display = wasCollapsed ? 'block' : 'none';
      });
    }

    section.appendChild(header);
    section.appendChild(body);
    section._body = body;
    return section;
  }

  _renderMetadata(file) {
    const body = this.metaSection._body;
    body.innerHTML = '';

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'font-size:14px;font-weight:bold;color:white;word-break:break-all;margin-bottom:8px;line-height:1.3;';
    nameRow.textContent = file.name;
    body.appendChild(nameRow);

    const rows = [
      ['Type', file.type || '—'],
      ['MIME', file.mimeType || '—'],
      ['Size', this._formatBytes(file.size)],
      ['Chunks', file.chunkCount != null ? String(file.chunkCount) : '—'],
      ['Modified', new Date(file.modified || Date.now()).toLocaleString()],
      ['Created', new Date(file.created || Date.now()).toLocaleString()],
    ];

    if (file.checksum) {
      rows.push(['SHA-256', file.checksum.slice(0, 16) + '...']);
    }

    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:3px 0;align-items:flex-start;';
      const l = document.createElement('span');
      l.textContent = label + ':';
      l.style.cssText = 'color:var(--text-muted);flex-shrink:0;';
      const v = document.createElement('span');
      v.textContent = value;
      v.style.cssText = 'color:#ccc;font-family:monospace;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;';
      v.title = value;
      row.appendChild(l);
      row.appendChild(v);
      body.appendChild(row);
    }

    const pathRow = document.createElement('div');
    pathRow.style.cssText = 'font-size:10px;color:#555;font-family:monospace;margin-top:8px;padding:6px 8px;background:#0a0a0a;border-radius:4px;border:1px solid #222;word-break:break-all;';
    pathRow.textContent = file.path;
    body.appendChild(pathRow);

    if (file.tags && file.tags.length) {
      const tagWrap = document.createElement('div');
      tagWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;';
      for (const tag of file.tags) {
        const tagEl = document.createElement('span');
        tagEl.textContent = tag;
        tagEl.style.cssText = 'font-size:10px;padding:2px 6px;background:rgba(138,43,226,0.2);color:#8a2be2;border:1px solid #8a2be2;border-radius:10px;';
        tagWrap.appendChild(tagEl);
      }
      body.appendChild(tagWrap);
    }
  }

  _renderActions(file) {
    const body = this.actionsSection._body;
    body.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:5px;';

    for (const act of this.actions) {
      const btn = document.createElement('button');
      btn.className = 'nexus-touch';
      btn.style.cssText = `display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 6px;border-radius:4px;border:1px solid ${act.color}33;background:${act.color}0d;color:${act.color};cursor:pointer;font-size:11px;transition:all 0.12s;font-family:inherit;`;
      btn.innerHTML = `<i class="fas ${act.icon}" style="font-size:11px;"></i> <span>${act.label}</span>`;
      btn.addEventListener('mouseenter', () => {
        btn.style.background = act.color + '22';
        btn.style.borderColor = act.color;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = act.color + '0d';
        btn.style.borderColor = act.color + '33';
      });
      btn.addEventListener('click', () => {
        this.onAction(act.id, file.path);
      });
      grid.appendChild(btn);
    }

    body.appendChild(grid);
  }

  async _loadPlugin(file) {
    if (this.currentInstance && typeof this.currentInstance.destroy === 'function') {
      try { this.currentInstance.destroy(); } catch {}
    }
    this.currentInstance = null;

    if (!this.pluginRegistry) {
      this._showPluginError('Plugin registry unavailable');
      return;
    }

    const plugin = this.pluginRegistry.getPlugin(file.type);
    this.currentPlugin = plugin;

    if (!plugin) {
      const fallback = this.pluginRegistry.getPlugin('BINARY');
      if (!fallback) {
        this._showPluginMissing(file.type);
        return;
      }
      this._showPluginMissing(file.type, true);
      try {
        const inst = await fallback.init(this.editorSurface, this.toolsContainer, file);
        this.currentInstance = inst;
      } catch (e) {
        this._showPluginError(e.message);
      }
      return;
    }

    if (typeof plugin.init !== 'function') {
      this._showPluginError('Plugin misconfigured (no init)');
      return;
    }

    try {
      if (this.editorSurface) {
        this.editorSurface.innerHTML = '<div style="color:var(--text-muted);font-family:monospace;font-size:12px;">Loading plugin...</div>';
      }
      const inst = await plugin.init(this.editorSurface, this.toolsContainer, file);
      this.currentInstance = inst || null;
    } catch (err) {
      console.error('Plugin init error:', err);
      this._showPluginError(err.message || 'Unknown error');
    }
  }

  _showPluginMissing(type, usingFallback = false) {
    if (this.editorSurface) {
      this.editorSurface.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-family:monospace;padding:20px;text-align:center;">
          <div>
            <i class="fas fa-file" style="font-size:48px;margin-bottom:12px;opacity:0.3;"></i>
            <p style="font-size:13px;">No plugin for type: <strong style="color:var(--nexus-cyan);">${type}</strong></p>
            ${usingFallback ? '<p style="font-size:11px;margin-top:8px;color:#666;">Falling back to hex viewer</p>' : ''}
          </div>
        </div>
      `;
    }
    if (this.toolsContainer && !usingFallback) {
      this.toolsContainer.innerHTML = '<p style="color:var(--text-muted);font-size:11px;text-align:center;font-family:monospace;">No tools available</p>';
    }
  }

  _showPluginError(message) {
    if (this.editorSurface) {
      this.editorSurface.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ff003c;font-family:monospace;padding:20px;text-align:center;">
          <div>
            <i class="fas fa-exclamation-triangle" style="font-size:48px;margin-bottom:12px;"></i>
            <p style="font-size:13px;">Plugin error</p>
            <p style="font-size:11px;color:#888;margin-top:6px;">${(message || '').replace(/</g, '&lt;')}</p>
          </div>
        </div>
      `;
    }
  }

  async saveCurrentFile() {
    if (this.currentInstance && typeof this.currentInstance.save === 'function') {
      try {
        return await this.currentInstance.save();
      } catch (e) {
        console.error('Save failed:', e);
        return null;
      }
    }
    return null;
  }

  _formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
