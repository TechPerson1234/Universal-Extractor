// =============================================================================
// src/core/App.js (FULLY FIXED)
// =============================================================================
// Main application orchestrator – manages lifecycle, workspace, UI coordination,
// and high-level event routing. All context menu actions are implemented.
// =============================================================================

import { UIManager } from '../ui/UIManager.js';
import { VFSTree } from '../ui/VFSTree.js';
import { TabManager } from '../ui/TabManager.js';
import { SearchBar } from '../ui/SearchBar.js';
import { Inspector } from '../ui/Inspector.js';
import { Notifications } from '../ui/Notifications.js';
import { SettingsPanel } from '../ui/SettingsPanel.js';
import { registerAllPlugins } from '../plugins/AllPlugins.js';

export class App {
  constructor(deps) {
    this.eventBus = deps.eventBus;
    this.stateManager = deps.stateManager;
    this.vfs = deps.vfs;
    this.themeManager = deps.themeManager;
    this.pluginRegistry = deps.pluginRegistry;

    this.uiManager = null;
    this.vfsTree = null;
    this.tabManager = null;
    this.searchBar = null;
    this.inspector = null;
    this.notifications = null;
    this.settingsPanel = null;

    this.workspace = {
      currentFolder: '/',
      activeFile: null,
      openTabs: [],
    };

    this._bindEvents();
  }

  /**
   * Mount the application to a DOM container
   */
  mount(container) {
    // STEP 1: Register all plugins so they are available
    registerAllPlugins(this.pluginRegistry);
    console.log('Plugins registered:', this.pluginRegistry.getRegisteredTypes());

    // Initialize notifications
    this.notifications = new Notifications(container);

    // Initialize UI manager with drop handler
    this.uiManager = new UIManager(container, {
      onDrop: (files) => this._handleDrop(files),
    });

    this.uiManager.renderLayout();

    // --- VFS Tree ---
    const treeContainer = this.uiManager.getTreeContainer();
    this.vfsTree = new VFSTree(treeContainer, {
      vfs: this.vfs,
      onSelect: (path) => this._openFile(path),
      onContextMenu: (path, action) => this._handleContextAction(path, action),
      onCreateFolder: (name) => this._createFolder(name),
    });

    // --- Tab Manager ---
    const tabContainer = this.uiManager.getTabContainer();
    this.tabManager = new TabManager(tabContainer, {
      onSwitch: (path) => this._switchTab(path),
      onClose: (path) => this._closeTab(path),
      onCloseAll: () => this._closeAllTabs(),
    });

    // --- Search Bar ---
    const searchContainer = this.uiManager.getSearchContainer();
    this.searchBar = new SearchBar(searchContainer, {
      vfs: this.vfs,
      onSearch: (results) => this.vfsTree.highlightResults(results),
    });

    // --- Inspector ---
    // Pass editorSurface so plugins can render into the main editor area
    const inspectorContainer = this.uiManager.getInspectorContainer();
    this.inspector = new Inspector(inspectorContainer, {
      vfs: this.vfs,
      pluginRegistry: this.pluginRegistry,
      editorSurface: this.uiManager.getEditorSurface(),
      onAction: (action, path) => this._handleInspectorAction(action, path),
    });

    // --- Settings Panel ---
    this.settingsPanel = new SettingsPanel(this.uiManager.getSettingsContainer(), {
      themeManager: this.themeManager,
      onSettingsChanged: (settings) => this._applySettings(settings),
    });

    // --- Bridge VFS changes to UI ---
    this.vfs.onChange(() => {
      this.eventBus.emit('vfs:changed');
    });

    this.eventBus.on('vfs:changed', () => {
      this.vfsTree.render(this.workspace.currentFolder);
      this._updateRAMMeter();
      this.stateManager.pushState(this._captureState());
      this._autoSave();
    });

    // Restore session
    this._restoreSession();

    // Initial render
    this.vfsTree.render('/');
    this.tabManager.render();
    this._updateRAMMeter();

    this._setupKeyboardShortcuts();

    this.eventBus.emit('app:ready');
  }

  // ---------------------------------------------------------------------------
  // File drop handling
  // ---------------------------------------------------------------------------
  async _handleDrop(files) {
    for (const file of files) {
      try {
        await this.vfs.ingest(file);
      } catch (err) {
        this.notifications.show('Failed to ingest: ' + file.name, 'error');
        console.error(err);
      }
    }
    this.vfsTree.render(this.workspace.currentFolder);
    this._updateRAMMeter();
    this.eventBus.emit('vfs:changed');
    this.notifications.show(`Added ${files.length} file(s)`, 'success', 2000);
  }

  // ---------------------------------------------------------------------------
  // File opening and tab management
  // ---------------------------------------------------------------------------
  _openFile(path) {
    const file = this.vfs.getFile(path);
    if (!file) {
      this.notifications.show('File not found: ' + path, 'error');
      return;
    }

    if (!this.workspace.openTabs.includes(path)) {
      this.workspace.openTabs.push(path);
    }
    this.workspace.activeFile = path;
    this.tabManager.setActiveTab(path);
    this.vfsTree.selectItem(path);

    // Load file into inspector – this will trigger plugin rendering
    this.inspector.loadFile(file);

    this._saveSession();
    this.stateManager.pushState(this._captureState());
    this.eventBus.emit('file:opened', path);
  }

  _switchTab(path) {
    if (this.workspace.activeFile !== path) {
      this._openFile(path);
    }
  }

  _closeTab(path) {
    const idx = this.workspace.openTabs.indexOf(path);
    if (idx === -1) return;
    this.workspace.openTabs.splice(idx, 1);
    if (this.workspace.activeFile === path) {
      this.workspace.activeFile = this.workspace.openTabs[0] || null;
      if (this.workspace.activeFile) {
        this._openFile(this.workspace.activeFile);
      } else {
        this.inspector.clear();
        this.uiManager.clearEditor();
      }
    }
    this.tabManager.render();
    this._saveSession();
    this.stateManager.pushState(this._captureState());
  }

  _closeAllTabs() {
    this.workspace.openTabs = [];
    this.workspace.activeFile = null;
    this.inspector.clear();
    this.uiManager.clearEditor();
    this.tabManager.render();
    this._saveSession();
    this.stateManager.pushState(this._captureState());
  }

  _createFolder(name) {
    const path = this.workspace.currentFolder === '/' ? '/' + name : this.workspace.currentFolder + '/' + name;
    this.vfs.createFolder(path);
    this.vfsTree.render(this.workspace.currentFolder);
  }

  // ---------------------------------------------------------------------------
  // Context menu actions (FULLY IMPLEMENTED)
  // ---------------------------------------------------------------------------
  _handleContextAction(path, action) {
    const file = this.vfs.getFile(path);
    if (!file) {
      this.notifications.show('File not found', 'error');
      return;
    }

    switch (action) {
      case 'rename':
        this._renameFile(path);
        break;
      case 'delete':
        this._deleteFile(path);
        break;
      case 'duplicate':
        this._duplicateFile(path);
        break;
      case 'export':
        this._exportFile(path);
        break;
      case 'checksum':
        this._calculateChecksum(path);
        break;
      case 'info':
        this._showFileInfo(path);
        break;
      default:
        console.warn('Unknown context action:', action);
        this.notifications.show('Unknown action: ' + action, 'warning');
    }
  }

  // Individual action implementations
  _renameFile(path) {
    const newName = prompt('Enter new name:', path.split('/').pop());
    if (!newName || newName.trim() === '') return;
    const newPath = path.substring(0, path.lastIndexOf('/') + 1) + newName.trim();
    if (newPath === path) return;
    this.vfs.moveFile(path, newPath);
    // Update tabs
    const idx = this.workspace.openTabs.indexOf(path);
    if (idx !== -1) this.workspace.openTabs[idx] = newPath;
    if (this.workspace.activeFile === path) this.workspace.activeFile = newPath;
    this.tabManager.render();
    this.vfsTree.render(this.workspace.currentFolder);
    this.notifications.show('Renamed to: ' + newName.trim(), 'success');
  }

  _deleteFile(path) {
    if (!confirm(`Delete "${path}"?`)) return;
    this.vfs.removeFile(path);
    this.notifications.show('Deleted: ' + path, 'info');
    if (this.workspace.activeFile === path) this._closeTab(path);
    this.vfsTree.render(this.workspace.currentFolder);
  }

  _duplicateFile(path) {
    const file = this.vfs.getFile(path);
    if (!file) return;
    const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
    const base = file.name.replace(/\.[^.]+$/, '');
    const newName = base + '_copy' + ext;
    const newPath = path.substring(0, path.lastIndexOf('/') + 1) + newName;
    // Clone blob
    const clonedBlob = file.blob.slice(0, file.blob.size, file.blob.type);
    this.vfs.addFile(newPath, clonedBlob, file.type);
    this.notifications.show('Duplicated: ' + file.name, 'success');
    this.vfsTree.render(this.workspace.currentFolder);
  }

  _exportFile(path) {
    const file = this.vfs.getFile(path);
    if (!file) return;
    // Use FileSaver if available, otherwise fallback to anchor download
    if (typeof saveAs !== 'undefined') {
      saveAs(file.blob, file.name);
    } else {
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    this.notifications.show('Exported: ' + file.name, 'success');
  }

  async _calculateChecksum(path) {
    const file = this.vfs.getFile(path);
    if (!file) return;
    try {
      const hash = await this.vfs.calculateChecksum(path);
      this.notifications.show(`SHA-256: ${hash}`, 'info', 5000);
    } catch (e) {
      this.notifications.show('Checksum calculation failed', 'error');
      console.error(e);
    }
  }

  _showFileInfo(path) {
    const file = this.vfs.getFile(path);
    if (!file) return;
    const info =
      `Name: ${file.name}\n` +
      `Type: ${file.type}\n` +
      `Size: ${this._formatBytes(file.size)}\n` +
      `Path: ${file.path}\n` +
      `Modified: ${new Date(file.modified).toLocaleString()}\n` +
      `Created: ${new Date(file.created).toLocaleString()}`;
    alert(info);
  }

  _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // ---------------------------------------------------------------------------
  // Inspector actions (reuse context actions)
  // ---------------------------------------------------------------------------
  _handleInspectorAction(action, path) {
    this._handleContextAction(path, action);
  }

  // ---------------------------------------------------------------------------
  // Utility methods
  // ---------------------------------------------------------------------------
  _updateRAMMeter() {
    let total = 0;
    this.vfs.getAllFiles().forEach(f => total += f.size);
    this.uiManager.updateRAMMeter(total);
  }

  _captureState() {
    return {
      vfs: this.vfs.serialize(),
      currentFolder: this.workspace.currentFolder,
      activeFile: this.workspace.activeFile,
      openTabs: [...this.workspace.openTabs],
    };
  }

  _saveSession() {
    try {
      const session = {
        currentFolder: this.workspace.currentFolder,
        openTabs: this.workspace.openTabs,
        activeFile: this.workspace.activeFile,
      };
      localStorage.setItem('nexus-session', JSON.stringify(session));
    } catch (e) {
      // ignore
    }
  }

  _restoreSession() {
    try {
      const raw = localStorage.getItem('nexus-session');
      if (!raw) return;
      const session = JSON.parse(raw);
      this.workspace.currentFolder = session.currentFolder || '/';
      this.workspace.openTabs = session.openTabs || [];
      this.workspace.activeFile = session.activeFile || null;
      // Validate files still exist
      this.workspace.openTabs = this.workspace.openTabs.filter(p => this.vfs.getFile(p));
      if (this.workspace.activeFile && !this.vfs.getFile(this.workspace.activeFile)) {
        this.workspace.activeFile = this.workspace.openTabs[0] || null;
      }
      this.tabManager.render();
      this.vfsTree.render(this.workspace.currentFolder);
      if (this.workspace.activeFile) {
        this._openFile(this.workspace.activeFile);
      }
    } catch (e) {
      console.warn('Failed to restore session:', e);
    }
  }

  _autoSave() {
    if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => {
      this.vfs.saveToDB();
    }, 2000);
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------
  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (ctrl && !shift && e.key === 'z') {
        e.preventDefault();
        this._undo();
      }
      if (ctrl && !shift && e.key === 'y') {
        e.preventDefault();
        this._redo();
      }
      if (ctrl && !shift && e.key === 's') {
        e.preventDefault();
        this._saveCurrentFile();
      }
      if (ctrl && !shift && e.key === 'w') {
        e.preventDefault();
        if (this.workspace.activeFile) {
          this._closeTab(this.workspace.activeFile);
        }
      }
      if (e.key === 'F2' && this.workspace.activeFile) {
        e.preventDefault();
        this._renameFile(this.workspace.activeFile);
      }
      if (e.key === 'Delete' && this.workspace.activeFile) {
        e.preventDefault();
        this._deleteFile(this.workspace.activeFile);
      }
    });
  }

  _undo() {
    const state = this.stateManager.undo();
    if (state) this._restoreState(state);
  }

  _redo() {
    const state = this.stateManager.redo();
    if (state) this._restoreState(state);
  }

  _restoreState(state) {
    this.vfs.deserialize(state.vfs);
    this.workspace.currentFolder = state.currentFolder || '/';
    this.workspace.openTabs = state.openTabs || [];
    this.workspace.activeFile = state.activeFile || null;
    this.tabManager.render();
    this.vfsTree.render(this.workspace.currentFolder);
    if (this.workspace.activeFile) {
      this._openFile(this.workspace.activeFile);
    }
    this._saveSession();
  }

  _saveCurrentFile() {
    if (this.workspace.activeFile) {
      const file = this.vfs.getFile(this.workspace.activeFile);
      if (file) {
        this.inspector.saveCurrentFile();
        this.notifications.show('Saved: ' + file.name, 'success');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  _applySettings(settings) {
    if (settings.theme) {
      this.themeManager.apply(settings.theme);
    }
    localStorage.setItem('nexus-settings', JSON.stringify(settings));
  }

  // ---------------------------------------------------------------------------
  // Error display
  // ---------------------------------------------------------------------------
  showError(message) {
    this.notifications.show(message, 'error', 8000);
  }

  // ---------------------------------------------------------------------------
  // Event binding (stub – actual events are set up elsewhere)
  // ---------------------------------------------------------------------------
  _bindEvents() {
    // No-op – we use the event bus and direct calls
  }
}