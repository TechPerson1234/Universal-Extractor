// =============================================================================
// src/core/App.js (CORRECTED - drop handling + VFS bridge)
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

  mount(container) {
    // Initialize UI components
    this.notifications = new Notifications(container);
    this.uiManager = new UIManager(container, {
      onDrop: (files) => this._handleDrop(files),
    });

    this.uiManager.renderLayout();

    const treeContainer = this.uiManager.getTreeContainer();
    this.vfsTree = new VFSTree(treeContainer, {
      vfs: this.vfs,
      onSelect: (path) => this._openFile(path),
      onContextMenu: (path, action) => this._handleContextAction(path, action),
      onCreateFolder: (name) => this._createFolder(name),
    });

    const tabContainer = this.uiManager.getTabContainer();
    this.tabManager = new TabManager(tabContainer, {
      onSwitch: (path) => this._switchTab(path),
      onClose: (path) => this._closeTab(path),
      onCloseAll: () => this._closeAllTabs(),
    });

    const searchContainer = this.uiManager.getSearchContainer();
    this.searchBar = new SearchBar(searchContainer, {
      vfs: this.vfs,
      onSearch: (results) => this.vfsTree.highlightResults(results),
    });

    const inspectorContainer = this.uiManager.getInspectorContainer();
    this.inspector = new Inspector(inspectorContainer, {
      vfs: this.vfs,
      pluginRegistry: this.pluginRegistry,
      onAction: (action, path) => this._handleInspectorAction(action, path),
    });

    this.settingsPanel = new SettingsPanel(this.uiManager.getSettingsContainer(), {
      themeManager: this.themeManager,
      onSettingsChanged: (settings) => this._applySettings(settings),
    });

    // --- Bridge VFS changes to EventBus and UI updates ---
    this.vfs.onChange(() => {
      this.eventBus.emit('vfs:changed');
    });

    // Listen for VFS changes to refresh UI
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
  // Handle file drops (FIXED: async + refresh)
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
    // Force tree refresh and update RAM
    this.vfsTree.render(this.workspace.currentFolder);
    this._updateRAMMeter();
    this.eventBus.emit('vfs:changed');
    this.notifications.show(`Added ${files.length} file(s)`, 'success', 2000);
  }

  // ---------------------------------------------------------------------------
  // Other methods (unchanged but kept for completeness)
  // ---------------------------------------------------------------------------
  _bindEvents() {
    // ... (keep existing)
  }

  _openFile(path) {
    // ... (keep existing)
  }

  _switchTab(path) {
    // ... (keep existing)
  }

  _closeTab(path) {
    // ... (keep existing)
  }

  _closeAllTabs() {
    // ... (keep existing)
  }

  _createFolder(name) {
    // ... (keep existing)
  }

  _handleContextAction(path, action) {
    // ... (keep existing)
  }

  _handleInspectorAction(action, path) {
    // ... (keep existing)
  }

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
    // ... (keep existing)
  }

  _restoreSession() {
    // ... (keep existing)
  }

  _autoSave() {
    // ... (keep existing)
  }

  _setupKeyboardShortcuts() {
    // ... (keep existing)
  }

  _undo() {
    // ... (keep existing)
  }

  _redo() {
    // ... (keep existing)
  }

  _restoreState(state) {
    // ... (keep existing)
  }

  _saveCurrentFile() {
    // ... (keep existing)
  }

  _applySettings(settings) {
    // ... (keep existing)
  }

  showError(message) {
    this.notifications.show(message, 'error', 8000);
  }
}