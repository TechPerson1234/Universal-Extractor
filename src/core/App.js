// =============================================================================
// src/core/App.js
// =============================================================================
// Main application orchestrator – manages lifecycle, workspace, UI coordination,
// and high-level event routing.
// =============================================================================

import { UIManager } from '../ui/UIManager.js';
import { VFSTree } from '../ui/VFSTree.js';
import { TabManager } from '../ui/TabManager.js';
import { SearchBar } from '../ui/SearchBar.js';
import { Inspector } from '../ui/Inspector.js';
import { Notifications } from '../ui/Notifications.js';
import { SettingsPanel } from '../ui/SettingsPanel.js';

export class App {
  constructor(deps) {
    this.eventBus = deps.eventBus;
    this.stateManager = deps.stateManager;
    this.vfs = deps.vfs;
    this.themeManager = deps.themeManager;
    this.pluginRegistry = deps.pluginRegistry;

    // UI components
    this.uiManager = null;
    this.vfsTree = null;
    this.tabManager = null;
    this.searchBar = null;
    this.inspector = null;
    this.notifications = null;
    this.settingsPanel = null;

    // State
    this.workspace = {
      currentFolder: '/',
      activeFile: null,
      openTabs: [],
    };

    // Bind events
    this._bindEvents();
  }

  /**
   * Mount the application to a DOM container
   * @param {HTMLElement} container
   */
  mount(container) {
    // Initialize UI components
    this.notifications = new Notifications(container);
    this.uiManager = new UIManager(container, {
      onDrop: (files) => this._handleDrop(files),
    });

    // Create the main layout: header, sidebar, main, inspector
    this.uiManager.renderLayout();

    // Initialize VFS tree
    const treeContainer = this.uiManager.getTreeContainer();
    this.vfsTree = new VFSTree(treeContainer, {
      vfs: this.vfs,
      onSelect: (path) => this._openFile(path),
      onContextMenu: (path, x, y) => this._showContextMenu(path, x, y),
      onCreateFolder: (name) => this._createFolder(name),
    });

    // Initialize tabs
    const tabContainer = this.uiManager.getTabContainer();
    this.tabManager = new TabManager(tabContainer, {
      onSwitch: (path) => this._switchTab(path),
      onClose: (path) => this._closeTab(path),
      onCloseAll: () => this._closeAllTabs(),
    });

    // Initialize search
    const searchContainer = this.uiManager.getSearchContainer();
    this.searchBar = new SearchBar(searchContainer, {
      vfs: this.vfs,
      onSearch: (results) => this.vfsTree.highlightResults(results),
    });

    // Initialize inspector
    const inspectorContainer = this.uiManager.getInspectorContainer();
    this.inspector = new Inspector(inspectorContainer, {
      vfs: this.vfs,
      onAction: (action, path) => this._handleInspectorAction(action, path),
    });

    // Initialize settings panel
    this.settingsPanel = new SettingsPanel(this.uiManager.getSettingsContainer(), {
      themeManager: this.themeManager,
      onSettingsChanged: (settings) => this._applySettings(settings),
    });

    // Restore session
    this._restoreSession();

    // Initial render
    this.vfsTree.render('/');
    this.tabManager.render();

    // Set up keyboard shortcuts
    this._setupKeyboardShortcuts();

    // Notify ready
    this.eventBus.emit('app:ready');
  }

  // ---------------------------------------------------------------------------
  // Event binding
  // ---------------------------------------------------------------------------
  _bindEvents() {
    // Listen for VFS changes
    this.eventBus.on('vfs:changed', () => {
      this.vfsTree.render(this.workspace.currentFolder);
      this.stateManager.pushState(this._captureState());
      this._autoSave();
    });

    // Listen for file open requests
    this.eventBus.on('file:open', (path) => this._openFile(path));

    // Listen for theme changes
    this.eventBus.on('theme:changed', (theme) => {
      this.themeManager.apply(theme);
    });

    // Listen for notification requests
    this.eventBus.on('notification:show', (data) => {
      this.notifications.show(data.message, data.type || 'info', data.duration);
    });
  }

  // ---------------------------------------------------------------------------
  // File handling
  // ---------------------------------------------------------------------------
  _handleDrop(files) {
    files.forEach(file => {
      this.vfs.ingest(file); // ingest is a method we'll add to VFS
    });
  }

  _openFile(path) {
    const file = this.vfs.getFile(path);
    if (!file) {
      this.notifications.show('File not found: ' + path, 'error');
      return;
    }

    // Add to open tabs if not already
    if (!this.workspace.openTabs.includes(path)) {
      this.workspace.openTabs.push(path);
    }

    this.workspace.activeFile = path;
    this.tabManager.setActiveTab(path);
    this.vfsTree.selectItem(path);

    // Load the file into the editor (inspector handles the actual plugin rendering)
    this.inspector.loadFile(file);

    // Update state
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
  // Context menu
  // ---------------------------------------------------------------------------
  _showContextMenu(path, x, y) {
    // Delegate to VFSTree which has its own context menu rendering
    this.vfsTree.showContextMenu(path, x, y);
  }

  // ---------------------------------------------------------------------------
  // Inspector actions
  // ---------------------------------------------------------------------------
  _handleInspectorAction(action, path) {
    switch (action) {
      case 'export':
        this._exportFile(path);
        break;
      case 'delete':
        this._deleteFile(path);
        break;
      case 'rename':
        this._renameFile(path);
        break;
      case 'duplicate':
        this._duplicateFile(path);
        break;
      case 'checksum':
        this._calculateChecksum(path);
        break;
      default:
        console.warn('Unknown inspector action:', action);
    }
  }

  _exportFile(path) {
    const file = this.vfs.getFile(path);
    if (!file) return;
    // Use FileSaver (global)
    saveAs(file.blob, file.name);
    this.notifications.show('Exported: ' + file.name, 'success');
  }

  _deleteFile(path) {
    if (confirm(`Delete "${path}"?`)) {
      this.vfs.removeFile(path);
      this.notifications.show('Deleted: ' + path, 'info');
      if (this.workspace.activeFile === path) {
        this._closeTab(path);
      }
    }
  }

  _renameFile(path) {
    const newName = prompt('Enter new name:', path.split('/').pop());
    if (newName) {
      const newPath = path.substring(0, path.lastIndexOf('/') + 1) + newName;
      this.vfs.moveFile(path, newPath);
      // Update tabs
      const idx = this.workspace.openTabs.indexOf(path);
      if (idx !== -1) {
        this.workspace.openTabs[idx] = newPath;
      }
      if (this.workspace.activeFile === path) {
        this.workspace.activeFile = newPath;
      }
      this.tabManager.render();
      this.vfsTree.render(this.workspace.currentFolder);
      this.notifications.show('Renamed to: ' + newName, 'success');
    }
  }

  _duplicateFile(path) {
    const file = this.vfs.getFile(path);
    if (!file) return;
    const newPath = path.replace(/(\.[^.]+)$/, '_copy$1');
    this.vfs.addFile(newPath, file.blob.slice(0, file.blob.size, file.blob.type), file.type);
    this.notifications.show('Duplicated: ' + path, 'success');
  }

  async _calculateChecksum(path) {
    const file = this.vfs.getFile(path);
    if (!file) return;
    const hash = await file.calculateChecksum();
    this.notifications.show(`Checksum (SHA-256): ${hash}`, 'info', 5000);
  }

  // ---------------------------------------------------------------------------
  // State persistence
  // ---------------------------------------------------------------------------
  _captureState() {
    return {
      vfs: this.vfs.serialize(),
      currentFolder: this.workspace.currentFolder,
      activeFile: this.workspace.activeFile,
      openTabs: [...this.workspace.openTabs],
    };
  }

  _saveSession() {
    const session = {
      currentFolder: this.workspace.currentFolder,
      openTabs: this.workspace.openTabs,
      activeFile: this.workspace.activeFile,
    };
    localStorage.setItem('nexus-session', JSON.stringify(session));
  }

  _restoreSession() {
    try {
      const raw = localStorage.getItem('nexus-session');
      if (!raw) return;
      const session = JSON.parse(raw);
      this.workspace.currentFolder = session.currentFolder || '/';
      this.workspace.openTabs = session.openTabs || [];
      this.workspace.activeFile = session.activeFile || null;
      // Verify files still exist
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
    // Debounced auto-save (could be called frequently)
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

      // Ctrl+Z -> undo
      if (ctrl && !shift && e.key === 'z') {
        e.preventDefault();
        this._undo();
      }
      // Ctrl+Y -> redo
      if (ctrl && !shift && e.key === 'y') {
        e.preventDefault();
        this._redo();
      }
      // Ctrl+S -> save current file
      if (ctrl && !shift && e.key === 's') {
        e.preventDefault();
        this._saveCurrentFile();
      }
      // Ctrl+W -> close current tab
      if (ctrl && !shift && e.key === 'w') {
        e.preventDefault();
        if (this.workspace.activeFile) {
          this._closeTab(this.workspace.activeFile);
        }
      }
      // F2 -> rename current file
      if (e.key === 'F2' && this.workspace.activeFile) {
        e.preventDefault();
        this._renameFile(this.workspace.activeFile);
      }
      // Delete -> delete current file
      if (e.key === 'Delete' && this.workspace.activeFile) {
        e.preventDefault();
        this._deleteFile(this.workspace.activeFile);
      }
    });
  }

  _undo() {
    const state = this.stateManager.undo();
    if (state) {
      this._restoreState(state);
    }
  }

  _redo() {
    const state = this.stateManager.redo();
    if (state) {
      this._restoreState(state);
    }
  }

  _restoreState(state) {
    // Restore VFS from serialized data
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
        // Delegate to the plugin via inspector
        this.inspector.saveCurrentFile();
        this.notifications.show('Saved: ' + file.name, 'success');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  _applySettings(settings) {
    // Apply theme if changed
    if (settings.theme) {
      this.themeManager.apply(settings.theme);
    }
    // Other settings can be stored and applied as needed
    localStorage.setItem('nexus-settings', JSON.stringify(settings));
  }

  // ---------------------------------------------------------------------------
  // Error display
  // ---------------------------------------------------------------------------
  showError(message) {
    this.notifications.show(message, 'error', 8000);
  }
}