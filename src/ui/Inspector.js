// =============================================================================
// src/ui/Inspector.js
// =============================================================================
// Displays file metadata, quick actions, and plugin tools panel.
// Plugins render their UI into the main editor surface and the tools container.
// =============================================================================

export class Inspector {
  constructor(container, options = {}) {
    this.container = container;
    this.vfs = options.vfs;
    this.pluginRegistry = options.pluginRegistry;
    this.editorSurface = options.editorSurface || document.getElementById('editor-surface');
    this.onAction = options.onAction || (() => {});

    this.currentFile = null;
    this.currentPlugin = null;
    this.currentPluginInstance = null;
    this.toolsContainer = null;

    // Quick action buttons definition
    this.actions = [
      { id: 'export', label: 'Export', icon: 'fa-download', color: 'var(--nexus-cyan)' },
      { id: 'delete', label: 'Delete', icon: 'fa-trash', color: '#ff003c' },
      { id: 'rename', label: 'Rename', icon: 'fa-edit', color: '#fbbf24' },
      { id: 'duplicate', label: 'Duplicate', icon: 'fa-copy', color: '#8a2be2' },
      { id: 'checksum', label: 'Checksum', icon: 'fa-shield-alt', color: '#00ff41' },
      { id: 'info', label: 'Properties', icon: 'fa-info-circle', color: '#00f0ff' },
    ];
  }

  /**
   * Load a file into the inspector and render its plugin
   * @param {Object} file - File object from VFS
   */
  async loadFile(file) {
    this.currentFile = file;
    this.container.innerHTML = '';

    // Render metadata
    this._renderMetadata(file);

    // Render action buttons
    this._renderActions(file);

    // Create container for plugin tools (right panel)
    this.toolsContainer = document.createElement('div');
    this.toolsContainer.id = 'inspector-tools';
    this.toolsContainer.style.flex = '1';
    this.toolsContainer.style.overflow = 'auto';
    this.toolsContainer.style.paddingTop = '12px';
    this.toolsContainer.style.borderTop = '1px solid #333';
    this.container.appendChild(this.toolsContainer);

    // Load and render the plugin
    await this._loadPlugin(file);
  }

  /**
   * Clear the inspector (no file loaded)
   */
  clear() {
    this.currentFile = null;
    this.currentPlugin = null;
    this.currentPluginInstance = null;
    this.container.innerHTML = `
      <p style="text-align:center;color:var(--text-muted);font-size:12px;font-family:monospace;margin-top:40px;">
        &gt; NO DATA TARGET &lt;
      </p>
    `;

    // Also clear the main editor surface
    if (this.editorSurface) {
      this.editorSurface.innerHTML = `
        <div style="text-align:center;opacity:0.2;pointer-events:none;">
          <i class="fas fa-skull" style="font-size:80px;color:white;"></i>
          <h2 style="font-size:28px;font-weight:900;letter-spacing:0.2em;color:white;">NEXUS IDLE</h2>
        </div>
      `;
    }
  }

  /**
   * Save the current file via its plugin (if it supports save)
   * @returns {Promise<any> | null}
   */
  async saveCurrentFile() {
    if (this.currentPluginInstance && typeof this.currentPluginInstance.save === 'function') {
      return this.currentPluginInstance.save();
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private rendering methods
  // ---------------------------------------------------------------------------

  _renderMetadata(file) {
    const metaSection = document.createElement('div');
    metaSection.style.marginBottom = '12px';
    metaSection.style.borderBottom = '1px solid #333';
    metaSection.style.paddingBottom = '12px';

    const name = document.createElement('h3');
    name.textContent = file.name;
    name.style.fontSize = '16px';
    name.style.fontWeight = 'bold';
    name.style.color = 'white';
    name.style.marginBottom = '4px';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    metaSection.appendChild(name);

    const details = [
      { label: 'Type', value: file.type },
      { label: 'Size', value: this._formatBytes(file.size) },
      { label: 'Modified', value: new Date(file.modified).toLocaleString() },
      { label: 'Path', value: file.path },
    ];

    for (const d of details) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.fontSize = '11px';
      row.style.padding = '2px 0';
      row.style.color = 'var(--text-muted)';
      const label = document.createElement('span');
      label.textContent = d.label + ':';
      const value = document.createElement('span');
      value.textContent = d.value;
      value.style.color = '#ccc';
      value.style.fontFamily = 'monospace';
      value.style.overflow = 'hidden';
      value.style.textOverflow = 'ellipsis';
      value.style.maxWidth = '150px';
      row.appendChild(label);
      row.appendChild(value);
      metaSection.appendChild(row);
    }

    this.container.appendChild(metaSection);
  }

  _renderActions(file) {
    const actionSection = document.createElement('div');
    actionSection.style.display = 'flex';
    actionSection.style.flexWrap = 'wrap';
    actionSection.style.gap = '4px';
    actionSection.style.marginBottom = '12px';
    actionSection.style.borderBottom = '1px solid #333';
    actionSection.style.paddingBottom = '12px';

    for (const act of this.actions) {
      const btn = document.createElement('button');
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '4px';
      btn.style.padding = '3px 8px';
      btn.style.borderRadius = '3px';
      btn.style.border = `1px solid ${act.color}`;
      btn.style.backgroundColor = 'transparent';
      btn.style.color = act.color;
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '11px';
      btn.style.transition = 'all 0.15s';
      btn.innerHTML = `<i class="fas ${act.icon}" style="font-size:11px;"></i> ${act.label}`;
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

  /**
   * Load the appropriate plugin for the file and initialize it
   * @param {Object} file - File object
   */
  async _loadPlugin(file) {
    // If we had a previous plugin instance, destroy it
    if (this.currentPluginInstance && typeof this.currentPluginInstance.destroy === 'function') {
      this.currentPluginInstance.destroy();
    }
    this.currentPluginInstance = null;

    // Get the plugin from the registry
    const plugin = this.pluginRegistry ? this.pluginRegistry.getPlugin(file.type) : null;
    this.currentPlugin = plugin;

    if (!plugin) {
      // No plugin found – show a fallback message in the editor surface
      if (this.editorSurface) {
        this.editorSurface.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-family:monospace;">
            <div style="text-align:center;">
              <i class="fas fa-file" style="font-size:48px;margin-bottom:16px;opacity:0.3;"></i>
              <p>No plugin available for type: ${file.type}</p>
              <p style="font-size:12px;">Showing raw data may be available via Hex viewer.</p>
            </div>
          </div>
        `;
      }
      if (this.toolsContainer) {
        this.toolsContainer.innerHTML = `
          <p style="color:var(--text-muted);font-size:12px;text-align:center;">
            No tools for this file type.
          </p>
        `;
      }
      return;
    }

    // Ensure the plugin has an init method
    if (typeof plugin.init !== 'function') {
      console.warn('Plugin for type', file.type, 'is missing init() method.');
      if (this.editorSurface) {
        this.editorSurface.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
            Plugin is misconfigured (no init method).
          </div>
        `;
      }
      return;
    }

    try {
      // Call the plugin's init method with the editor surface, tools container, and file
      const instance = await plugin.init(this.editorSurface, this.toolsContainer, file);
      this.currentPluginInstance = instance || null;
    } catch (err) {
      console.error('Plugin initialization error:', err);
      if (this.editorSurface) {
        this.editorSurface.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ff003c;font-family:monospace;">
            <div style="text-align:center;">
              <i class="fas fa-exclamation-triangle" style="font-size:48px;margin-bottom:16px;"></i>
              <p>Plugin error: ${err.message}</p>
            </div>
          </div>
        `;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------
  _formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}