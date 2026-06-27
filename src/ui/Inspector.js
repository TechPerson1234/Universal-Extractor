// =============================================================================
// src/ui/Inspector.js
// =============================================================================
// Displays file metadata, quick actions, and plugin tools panel.
// =============================================================================

export class Inspector {
  constructor(container, options = {}) {
    this.container = container;
    this.vfs = options.vfs;
    this.onAction = options.onAction || (() => {});
    this.pluginRegistry = options.pluginRegistry || null;

    this.currentFile = null;
    this.currentPluginInstance = null;
    this.actions = [
      { id: 'export', label: 'Export', icon: 'fa-download', color: 'var(--nexus-cyan)' },
      { id: 'delete', label: 'Delete', icon: 'fa-trash', color: '#ff003c' },
      { id: 'rename', label: 'Rename', icon: 'fa-edit', color: '#fbbf24' },
      { id: 'duplicate', label: 'Duplicate', icon: 'fa-copy', color: '#8a2be2' },
      { id: 'checksum', label: 'Checksum', icon: 'fa-shield-alt', color: '#00ff41' },
    ];
  }

  /**
   * Load a file into the inspector
   */
  loadFile(file) {
    this.currentFile = file;
    this.container.innerHTML = '';
    this._renderMetadata(file);
    this._renderActions(file);
    this._renderPluginTools(file);
  }

  /**
   * Clear the inspector (no file loaded)
   */
  clear() {
    this.currentFile = null;
    this.container.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:12px;font-family:monospace;margin-top:40px;">&gt; NO DATA TARGET &lt;</p>';
    this.currentPluginInstance = null;
  }

  /**
   * Save current file via plugin
   */
  saveCurrentFile() {
    if (this.currentPluginInstance && typeof this.currentPluginInstance.save === 'function') {
      return this.currentPluginInstance.save();
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Render metadata
  // ---------------------------------------------------------------------------
  _renderMetadata(file) {
    const metaSection = document.createElement('div');
    metaSection.style.marginBottom = '16px';
    metaSection.style.borderBottom = '1px solid #333';
    metaSection.style.paddingBottom = '12px';

    const name = document.createElement('h3');
    name.textContent = file.name;
    name.style.fontSize = '16px';
    name.style.fontWeight = 'bold';
    name.style.color = 'white';
    name.style.marginBottom = '4px';
    metaSection.appendChild(name);

    const details = [
      { label: 'Type', value: file.type },
      { label: 'Size', value: this._formatBytes(file.size) },
      { label: 'Modified', value: new Date(file.modified).toLocaleString() },
      { label: 'Created', value: new Date(file.created).toLocaleString() },
      { label: 'Path', value: file.path },
    ];

    for (const d of details) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.fontSize = '12px';
      row.style.padding = '2px 0';
      row.style.color = 'var(--text-muted)';
      const label = document.createElement('span');
      label.textContent = d.label + ':';
      const value = document.createElement('span');
      value.textContent = d.value;
      value.style.color = '#ccc';
      value.style.fontFamily = 'monospace';
      row.appendChild(label);
      row.appendChild(value);
      metaSection.appendChild(row);
    }

    this.container.appendChild(metaSection);
  }

  // ---------------------------------------------------------------------------
  // Render action buttons
  // ---------------------------------------------------------------------------
  _renderActions(file) {
    const actionSection = document.createElement('div');
    actionSection.style.display = 'flex';
    actionSection.style.flexWrap = 'wrap';
    actionSection.style.gap = '6px';
    actionSection.style.marginBottom = '16px';
    actionSection.style.borderBottom = '1px solid #333';
    actionSection.style.paddingBottom = '12px';

    for (const act of this.actions) {
      const btn = document.createElement('button');
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '4px';
      btn.style.padding = '4px 10px';
      btn.style.borderRadius = '4px';
      btn.style.border = `1px solid ${act.color}`;
      btn.style.backgroundColor = 'transparent';
      btn.style.color = act.color;
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '12px';
      btn.style.transition = 'all 0.15s';
      btn.innerHTML = `<i class="fas ${act.icon}"></i> ${act.label}`;
      btn.addEventListener('mouseenter', () => {
        btn.style.backgroundColor = act.color + '33';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.backgroundColor = 'transparent';
      });
      btn.addEventListener('click', () => {
        this.onAction(act.id, file.path);
      });
      actionSection.appendChild(btn);
    }

    this.container.appendChild(actionSection);
  }

  // ---------------------------------------------------------------------------
  // Render plugin tools (if plugin registry available)
  // ---------------------------------------------------------------------------
  _renderPluginTools(file) {
    const toolsSection = document.createElement('div');
    toolsSection.id = 'inspector-tools';
    toolsSection.style.flex = '1';
    toolsSection.style.overflow = 'auto';

    if (this.pluginRegistry) {
      const plugin = this.pluginRegistry.getPlugin(file.type);
      if (plugin && typeof plugin.renderTools === 'function') {
        // The plugin can render its own tools into this container
        plugin.renderTools(toolsSection, file);
        // Store instance
        this.currentPluginInstance = plugin;
      } else {
        // Default: show placeholder
        toolsSection.innerHTML = '<p style="color:var(--text-muted);font-size:12px;text-align:center;">No tools available for this file type.</p>';
      }
    } else {
      toolsSection.innerHTML = '<p style="color:var(--text-muted);font-size:12px;text-align:center;">Plugin registry not available.</p>';
    }

    this.container.appendChild(toolsSection);
  }

  // ---------------------------------------------------------------------------
  // Helper
  // ---------------------------------------------------------------------------
  _formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}