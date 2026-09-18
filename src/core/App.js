import { UIManager } from '../ui/UIManager.js';
import { VFSTree } from '../ui/VFSTree.js';
import { TabManager } from '../ui/TabManager.js';
import { SearchBar } from '../ui/SearchBar.js';
import { Inspector } from '../ui/Inspector.js';
import { Notifications } from '../ui/Notifications.js';
import { SettingsPanel } from '../ui/SettingsPanel.js';
import { registerAllPlugins } from '../plugins/AllPlugins.js';

const SESSION_KEY = 'nexus-session-v5';
const SETTINGS_KEY = 'nexus-settings-v5';
const AUTOSAVE_DEBOUNCE = 2500;

export class App {
  constructor(deps = {}) {
    this.eventBus = deps.eventBus;
    this.stateManager = deps.stateManager;
    this.vfs = deps.vfs;
    this.themeManager = deps.themeManager;
    this.pluginRegistry = deps.pluginRegistry;
    this.workerManager = deps.workerManager;

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
      dirtyTabs: new Set(),
    };

    this.settings = this._loadSettings();
    this._autoSaveTimer = null;
    this._mounted = false;
    this._unsubscribers = [];
    this._pendingFiles = [];
  }

  async mount(container) {
    if (this._mounted) return;
    this._mounted = true;

    registerAllPlugins(this.pluginRegistry);

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
      onPin: (path, pinned) => this._pinTab(path, pinned),
    });

    const searchContainer = this.uiManager.getSearchContainer();
    if (searchContainer) {
      this.searchBar = new SearchBar(searchContainer, {
        vfs: this.vfs,
        onSearch: (results) => {
          if (this.vfsTree) this.vfsTree.highlightResults(results);
        },
      });
    }

    const inspectorContainer = this.uiManager.getInspectorContainer();
    this.inspector = new Inspector(inspectorContainer, {
      vfs: this.vfs,
      pluginRegistry: this.pluginRegistry,
      editorSurface: this.uiManager.getEditorSurface(),
      onAction: (action, path) => this._handleInspectorAction(action, path),
    });

    const settingsContainer = this.uiManager.getSettingsContainer();
    if (settingsContainer) {
      this.settingsPanel = new SettingsPanel(settingsContainer, {
        themeManager: this.themeManager,
        onSettingsChanged: (s) => this._applySettings(s),
      });
    }

    this._wireVFS();
    this._wireUIManager();
    this._wireEventBus();
    this._setupKeyboardShortcuts();
    this._setupGlobalEvents();
    this._setupPWAEvents();
    this._setupFileSystemAccess();

    this._applySettings(this.settings);
    await this._restoreSession();
    this._initialRender();
    this._startRAMLoop();

    this.eventBus.emit('app:ready');
    return this;
  }

  _wireVFS() {
    const off = this.vfs.onChange((evt) => {
      if (evt.type === 'ingest' || evt.type === 'add' || evt.type === 'update') {
        this.stateManager.pushState(this._captureState(), evt.type);
      }
      this.eventBus.emit('vfs:changed', evt);
    });
    this._unsubscribers.push(off);
  }

  _wireUIManager() {
    document.addEventListener('nexus:toggle-theme', () => {
      const next = this.themeManager.toggle();
      this.notifications.show(`Theme: ${next}`, 'info', 1500);
    });
    document.addEventListener('nexus:open-settings', () => {
      this.uiManager.showSettings();
    });
  }

  _wireEventBus() {
    this.eventBus.on('vfs:changed', () => {
      if (this.vfsTree) this.vfsTree.render(this.workspace.currentFolder);
      this._updateRAMMeter();
      this._scheduleAutoSave();
    });
    this.eventBus.on('file:opened', (path) => {
      this._saveSession();
    });
    this.eventBus.on('error', (err) => {
      this.notifications.show(err.message || String(err), 'error', 6000);
    });
  }

  async _handleDrop(files) {
    if (!files || !files.length) return;
    const arr = Array.from(files);
    this.notifications.show(`Ingesting ${arr.length} file(s)...`, 'info', 2000);
    let ok = 0;
    let fail = 0;
    for (const file of arr) {
      try {
        if (file.__kind === 'directory' && file.children) {
          await this._ingestDirectory(file);
        } else {
          const path = '/' + file.name;
          await this.vfs.ingest(file, path);
        }
        ok++;
      } catch (err) {
        console.error('Ingest failed:', err);
        fail++;
      }
    }
    this.notifications.show(
      `Ingested ${ok} file(s)${fail ? `, ${fail} failed` : ''}`,
      fail ? 'warning' : 'success',
      3000
    );
    this.vfsTree.render(this.workspace.currentFolder);
  }

  async _ingestDirectory(dir, parentPath = '') {
    const basePath = parentPath + '/' + dir.name;
    await this.vfs.createFolder(basePath);
    for (const child of dir.children || []) {
      if (child.__kind === 'directory') {
        await this._ingestDirectory(child, basePath);
      } else {
        await this.vfs.ingest(child, basePath + '/' + child.name);
      }
    }
  }

  async _openFile(path) {
    const file = await this.vfs.getFile(path);
    if (!file) {
      this.notifications.show('File not found: ' + path, 'error', 3000);
      return;
    }
    if (!this.workspace.openTabs.includes(path)) {
      this.workspace.openTabs.push(path);
    }
    this.workspace.activeFile = path;
    this.tabManager.setActiveTab(path);
    this.vfsTree.selectItem(path);

    const header = this.uiManager.getEditorHeader();
    if (header) {
      header.textContent = `${file.name}  •  ${this._formatBytes(file.size)}  •  ${file.type}`;
    }

    try {
      await this.inspector.loadFile(file);
    } catch (err) {
      console.error('Inspector load failed:', err);
      this.notifications.show('Failed to load preview: ' + err.message, 'error', 4000);
    }

    this.eventBus.emit('file:opened', path);
  }

  _switchTab(path) {
    if (this.workspace.activeFile !== path) this._openFile(path);
  }

  _closeTab(path) {
    const idx = this.workspace.openTabs.indexOf(path);
    if (idx === -1) return;
    this.workspace.openTabs.splice(idx, 1);
    this.workspace.dirtyTabs.delete(path);
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
  }

  _closeAllTabs() {
    this.workspace.openTabs = [];
    this.workspace.activeFile = null;
    this.workspace.dirtyTabs.clear();
    this.inspector.clear();
    this.uiManager.clearEditor();
    this.tabManager.render();
    this._saveSession();
  }

  _pinTab(path, pinned) {
    this.notifications.show(`${pinned ? 'Pinned' : 'Unpinned'}: ${path.split('/').pop()}`, 'info', 1200);
    this._saveSession();
  }

  async _createFolder(name) {
    const base = this.workspace.currentFolder;
    const path = base === '/' ? '/' + name : base + '/' + name;
    const created = await this.vfs.createFolder(path);
    if (created) {
      this.notifications.show('Folder created: ' + name, 'success', 1500);
      this.vfsTree.render(this.workspace.currentFolder);
    }
  }

  async _handleContextAction(path, action) {
    const file = await this.vfs.getFile(path);
    if (!file && action !== 'delete-folder') {
      this.notifications.show('Not found: ' + path, 'error', 2500);
      return;
    }
    switch (action) {
      case 'rename': return this._renameFile(path);
      case 'delete': return this._deleteFile(path);
      case 'duplicate': return this._duplicateFile(path);
      case 'export': return this._exportFile(path);
      case 'export-as': return this._exportFileAs(path);
      case 'checksum': return this._calculateChecksum(path);
      case 'info': return this._showFileInfo(path);
      case 'copy': return this._copyPathToClipboard(path);
      case 'share': return this._shareFile(path);
      case 'open-system': return this._openWithSystem(path);
      case 'add-tag': return this._promptAddTag(path);
      case 'verify': return this._verifyFile(path);
      default:
        this.notifications.show('Unknown action: ' + action, 'warning', 2000);
    }
  }

  _handleInspectorAction(action, path) {
    return this._handleContextAction(path, action);
  }

  async _renameFile(path) {
    const oldName = path.split('/').pop();
    const newName = prompt('Rename file:', oldName);
    if (!newName || newName.trim() === '' || newName === oldName) return;
    const dir = path.slice(0, path.lastIndexOf('/'));
    const newPath = (dir === '' ? '' : dir) + '/' + newName.trim();
    const ok = await this.vfs.moveFile(path, newPath);
    if (!ok) {
      this.notifications.show('Rename failed', 'error', 2500);
      return;
    }
    const idx = this.workspace.openTabs.indexOf(path);
    if (idx !== -1) this.workspace.openTabs[idx] = newPath;
    if (this.workspace.activeFile === path) this.workspace.activeFile = newPath;
    this.tabManager.render();
    this.vfsTree.render(this.workspace.currentFolder);
    this.notifications.show('Renamed to: ' + newName.trim(), 'success', 2000);
  }

  async _deleteFile(path) {
    const confirmDelete = this.settings.confirmDelete !== false;
    if (confirmDelete && !confirm(`Delete "${path}"?`)) return;
    const ok = await this.vfs.deleteFile(path);
    if (ok) {
      this.notifications.show('Deleted: ' + path.split('/').pop(), 'info', 2000);
      if (this.workspace.activeFile === path) this._closeTab(path);
      this.vfsTree.render(this.workspace.currentFolder);
    }
  }

  async _duplicateFile(path) {
    const file = await this.vfs.getFile(path);
    if (!file) return;
    const dot = file.name.lastIndexOf('.');
    const base = dot === -1 ? file.name : file.name.slice(0, dot);
    const ext = dot === -1 ? '' : file.name.slice(dot);
    const dir = path.slice(0, path.lastIndexOf('/'));
    let newName = `${base}_copy${ext}`;
    let newPath = `${dir}/${newName}`;
    let counter = 1;
    while (await this.vfs.exists(newPath)) {
      newName = `${base}_copy_${counter}${ext}`;
      newPath = `${dir}/${newName}`;
      counter++;
    }
    const created = await this.vfs.copyFile(path, newPath);
    if (created) {
      this.notifications.show('Duplicated: ' + newName, 'success', 2000);
      this.vfsTree.render(this.workspace.currentFolder);
    }
  }

  async _exportFile(path) {
    const file = await this.vfs.getFile(path);
    if (!file) return;
    const blob = await this.vfs.readAsBlob(path);
    this._downloadBlob(blob, file.name);
    this.notifications.show('Exported: ' + file.name, 'success', 2000);
  }

  async _exportFileAs(path) {
    const file = await this.vfs.getFile(path);
    if (!file) return;
    const targetExt = prompt('Export as (extension):', file.name.split('.').pop() || 'bin');
    if (!targetExt) return;
    const blob = await this.vfs.readAsBlob(path);
    let outBlob = blob;
    if (blob.type.startsWith('image/') && !targetExt.match(/^(png|jpg|jpeg|webp)$/i)) {
      this.notifications.show('Unsupported export format', 'warning', 2500);
      return;
    }
    const newName = file.name.replace(/\.[^.]+$/, '') + '.' + targetExt;
    this._downloadBlob(outBlob, newName);
    this.notifications.show('Exported as: ' + newName, 'success', 2000);
  }

  _downloadBlob(blob, filename) {
    if (typeof saveAs !== 'undefined') {
      saveAs(blob, filename);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async _calculateChecksum(path) {
    try {
      const hash = await this.vfs.calculateChecksum(path);
      if (!hash) {
        this.notifications.show('Checksum failed', 'error', 2500);
        return;
      }
      const short = hash.slice(0, 16) + '...';
      this.notifications.show(`SHA-256: ${short}`, 'info', 6000, [
        { label: 'Copy', callback: () => navigator.clipboard.writeText(hash) },
        { label: 'Full', callback: () => alert(hash) },
      ]);
    } catch (e) {
      this.notifications.show('Checksum error', 'error', 3000);
    }
  }

  async _verifyFile(path) {
    const result = await this.vfs.verifyFile(path);
    if (result.ok) {
      this.notifications.show('File integrity verified', 'success', 2500);
    } else {
      this.notifications.show(`Integrity issue: ${result.failures.length} chunk(s)`, 'error', 5000);
    }
  }

  async _showFileInfo(path) {
    const file = await this.vfs.getFile(path);
    if (!file) return;
    const info = [
      `Name: ${file.name}`,
      `Path: ${file.path}`,
      `Type: ${file.type}`,
      `MIME: ${file.mimeType}`,
      `Size: ${this._formatBytes(file.size)}`,
      `Chunks: ${file.chunkCount}`,
      `Checksum: ${file.checksum || '(not computed)'}`,
      `Created: ${new Date(file.created).toLocaleString()}`,
      `Modified: ${new Date(file.modified).toLocaleString()}`,
      `Tags: ${(file.tags || []).join(', ') || '(none)'}`,
    ].join('\n');
    alert(info);
  }

  async _copyPathToClipboard(path) {
    try {
      await navigator.clipboard.writeText(path);
      this.notifications.show('Path copied', 'success', 1500);
    } catch {
      this.notifications.show('Copy failed', 'error', 2000);
    }
  }

  async _shareFile(path) {
    const file = await this.vfs.getFile(path);
    if (!file) return;
    const blob = await this.vfs.readAsBlob(path);
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], file.name, { type: file.mimeType })] })) {
      try {
        await navigator.share({
          files: [new File([blob], file.name, { type: file.mimeType })],
          title: file.name,
          text: 'Shared from NEXUS EXTRACTOR',
        });
        this.notifications.show('Shared', 'success', 1500);
      } catch (err) {
        if (err.name !== 'AbortError') {
          this.notifications.show('Share failed', 'error', 2000);
        }
      }
    } else {
      this.notifications.show('Sharing not supported', 'warning', 2000);
    }
  }

  async _openWithSystem(path) {
    if (!('showOpenFilePicker' in window)) {
      this.notifications.show('Not supported', 'warning', 2000);
      return;
    }
    this.notifications.show('Use Export instead', 'info', 2000);
  }

  async _promptAddTag(path) {
    const tag = prompt('Tag name:');
    if (!tag) return;
    this.vfs.addTag(path, tag.trim());
    this.notifications.show('Tag added: ' + tag, 'success', 1500);
  }

  async _openFileStreaming(path) {
    return this._openFile(path);
  }

  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const key = e.key.toLowerCase();

      if (ctrl && !shift && key === 'z') { e.preventDefault(); this._undo(); return; }
      if ((ctrl && key === 'y') || (ctrl && shift && key === 'z')) { e.preventDefault(); this._redo(); return; }
      if (ctrl && !shift && key === 's') { e.preventDefault(); this._saveCurrentFile(); return; }
      if (ctrl && shift && key === 's') { e.preventDefault(); this._saveAll(); return; }
      if (ctrl && !shift && key === 'w') { e.preventDefault(); if (this.workspace.activeFile) this._closeTab(this.workspace.activeFile); return; }
      if (ctrl && shift && key === 'w') { e.preventDefault(); this._closeAllTabs(); return; }
      if (ctrl && !shift && key === 'o') { e.preventDefault(); this._triggerOpenDialog(); return; }
      if (ctrl && !shift && key === 'f') { e.preventDefault(); if (this.searchBar) this.searchBar.setQuery(''); return; }
      if (ctrl && !shift && key === 'n') { e.preventDefault(); this._createFolder(prompt('Folder name:') || 'New Folder'); return; }
      if (ctrl && !shift && key === 'b') { e.preventDefault(); this.uiManager.toggleSidebar(); return; }
      if (ctrl && !shift && key === 'i') { e.preventDefault(); this.uiManager.toggleInspector(); return; }
      if (ctrl && !shift && key === ',') { e.preventDefault(); this.uiManager.showSettings(); return; }
      if (e.key === 'F2' && this.workspace.activeFile) { e.preventDefault(); this._renameFile(this.workspace.activeFile); return; }
      if (e.key === 'Delete' && this.workspace.activeFile) { e.preventDefault(); this._deleteFile(this.workspace.activeFile); return; }
      if (e.key === 'Escape') {
        if (this.uiManager) this.uiManager.hideSettings();
      }
      if (key === '?' && !ctrl && !shift) {
        this._showShortcutsHelp();
      }
    });
  }

  _showShortcutsHelp() {
    const shortcuts = [
      'Ctrl+Z: Undo', 'Ctrl+Y: Redo', 'Ctrl+S: Save', 'Ctrl+W: Close tab',
      'Ctrl+O: Open', 'Ctrl+F: Search', 'Ctrl+B: Toggle sidebar',
      'Ctrl+I: Toggle inspector', 'F2: Rename', 'Delete: Delete',
      'Ctrl+,: Settings', '?: This help',
    ];
    alert(shortcuts.join('\n'));
  }

  _triggerOpenDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (e) => this._handleDrop(Array.from(e.target.files));
    input.click();
  }

  _saveCurrentFile() {
    if (!this.workspace.activeFile) return;
    this.inspector.saveCurrentFile();
    this.notifications.show('Saved', 'success', 1500);
  }

  _saveAll() {
    this.notifications.show('Saving workspace...', 'info', 1500);
    this.vfs.saveToDB().then(() => {
      this.notifications.show('Workspace saved', 'success', 1500);
    });
  }

  _undo() {
    const state = this.stateManager.undo();
    if (state) {
      this._restoreState(state);
      this.notifications.show('Undo', 'info', 1000);
    }
  }

  _redo() {
    const state = this.stateManager.redo();
    if (state) {
      this._restoreState(state);
      this.notifications.show('Redo', 'info', 1000);
    }
  }

  _captureState() {
    return {
      vfs: this.vfs.serialize(),
      currentFolder: this.workspace.currentFolder,
      activeFile: this.workspace.activeFile,
      openTabs: [...this.workspace.openTabs],
      settings: this.settings,
    };
  }

  _restoreState(state) {
    if (!state) return;
    if (state.currentFolder) this.workspace.currentFolder = state.currentFolder;
    if (state.openTabs) {
      this.workspace.openTabs = state.openTabs.filter(p => this.vfs.files.has(p));
    }
    this.workspace.activeFile = state.activeFile || null;
    this.tabManager.render();
    this.vfsTree.render(this.workspace.currentFolder);
    if (this.workspace.activeFile) this._openFile(this.workspace.activeFile);
  }

  _saveSession() {
    try {
      const data = {
        currentFolder: this.workspace.currentFolder,
        openTabs: this.workspace.openTabs,
        activeFile: this.workspace.activeFile,
        savedAt: Date.now(),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  async _restoreSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) {
        this.workspace.currentFolder = '/';
        return;
      }
      const data = JSON.parse(raw);
      this.workspace.currentFolder = data.currentFolder || '/';
      const valid = (data.openTabs || []).filter(p => this.vfs.files.has(p));
      this.workspace.openTabs = valid;
      this.workspace.activeFile = valid.includes(data.activeFile) ? data.activeFile : null;
      if (this.workspace.activeFile) {
        await this._openFile(this.workspace.activeFile);
      }
    } catch (e) {
      console.warn('Session restore failed', e);
    }
  }

  _initialRender() {
    if (this.vfsTree) this.vfsTree.render(this.workspace.currentFolder);
    if (this.tabManager) this.tabManager.render();
    if (this.inspector && !this.workspace.activeFile) this.inspector.clear();
    this._updateRAMMeter();
  }

  _scheduleAutoSave() {
    if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
    const interval = (this.settings.autoSaveInterval || 5) * 1000;
    const wait = Math.max(AUTOSAVE_DEBOUNCE, interval);
    this._autoSaveTimer = setTimeout(() => {
      this.vfs.saveToDB().catch(() => {});
    }, wait);
  }

  _startRAMLoop() {
    this._ramTimer = setInterval(() => this._updateRAMMeter(), 3000);
  }

  _updateRAMMeter() {
    if (performance && performance.memory) {
      const used = performance.memory.usedJSHeapSize;
      if (this.uiManager && this.uiManager.updateRAMMeter) {
        this.uiManager.updateRAMMeter(used);
      }
      return;
    }
    const total = this.vfs.getTotalSize();
    if (this.uiManager && this.uiManager.updateRAMMeter) {
      this.uiManager.updateRAMMeter(total);
    }
  }

  _applySettings(settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.settings.theme && this.themeManager) {
      this.themeManager.apply(this.settings.theme);
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  _loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      theme: 'cyberpunk',
      confirmDelete: true,
      autoSaveInterval: 5,
      animations: true,
    };
  }

  _setupGlobalEvents() {
    window.addEventListener('beforeunload', (e) => {
      this._saveSession();
      try { this.vfs.saveToDB(); } catch (_) {}
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._saveSession();
    });
    window.addEventListener('online', () => {
      this.notifications.show('Back online', 'success', 2000);
    });
    window.addEventListener('offline', () => {
      this.notifications.show('Offline mode', 'warning', 2000);
    });
    window.addEventListener('unhandledrejection', (e) => {
      console.error('Unhandled rejection:', e.reason);
    });
    document.addEventListener('paste', (e) => this._handleClipboardPaste(e));
  }

  _setupPWAEvents() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data;
        if (data && data.type === 'file-shared') {
          this._handleSharedFile(data.file);
        }
      });
    }
    if (typeof window.LaunchQueue !== 'undefined') {
      window.launchQueue.setConsumer(async (params) => {
        if (!params.files) return;
        for (const handle of params.files) {
          try {
            const file = await handle.getFile();
            await this.vfs.ingest(file, '/' + file.name);
          } catch (e) {}
        }
      });
    }
  }

  _setupFileSystemAccess() {
    this._fsSupported = 'showOpenFilePicker' in window;
  }

  async _handleSharedFile(file) {
    if (!file) return;
    try {
      await this.vfs.ingest(file, '/' + file.name);
      this.notifications.show('Shared file ingested', 'success', 2000);
    } catch (e) {
      this.notifications.show('Share ingest failed', 'error', 2500);
    }
  }

  async _handleClipboardPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          try {
            await this.vfs.ingest(file, '/' + file.name);
            this.notifications.show('Pasted: ' + file.name, 'success', 2000);
          } catch (err) {}
        }
      }
    }
  }

  async importFromUrl(url, name) {
    try {
      this.notifications.show('Downloading: ' + url, 'info', 2000);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const finalName = name || (url.split('/').pop() || 'download');
      await this.vfs.addFile('/' + finalName, blob);
      this.notifications.show('Imported: ' + finalName, 'success', 2500);
    } catch (err) {
      this.notifications.show('Import failed: ' + err.message, 'error', 3000);
    }
  }

  async openSystemFile() {
    if (!this._fsSupported) {
      this._triggerOpenDialog();
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({ multiple: true });
      for (const handle of handles) {
        const file = await handle.getFile();
        await this.vfs.ingest(file, '/' + file.name);
      }
      this.notifications.show('Files opened', 'success', 2000);
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.notifications.show('Open failed', 'error', 2500);
      }
    }
  }

  async saveToSystem(path) {
    if (!('showSaveFilePicker' in window)) {
      this._exportFile(path);
      return;
    }
    const file = await this.vfs.getFile(path);
    if (!file) return;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: file.name,
      });
      const writable = await handle.createWritable();
      const stream = await this.vfs.readAsStream(path);
      await stream.pipeTo(writable);
      this.notifications.show('Saved to disk', 'success', 2000);
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.notifications.show('Save failed', 'error', 2500);
      }
    }
  }

  _formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  showError(message) {
    if (this.notifications) {
      this.notifications.show(String(message), 'error', 6000);
    } else {
      console.error(message);
    }
  }

  notify(message, type = 'info', duration = 2500) {
    if (this.notifications) this.notifications.show(message, type, duration);
  }

  async destroy() {
    if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
    if (this._ramTimer) clearInterval(this._ramTimer);
    for (const off of this._unsubscribers) {
      try { off(); } catch (e) {}
    }
    await this.vfs.destroy();
    this._mounted = false;
  }
}
