// =============================================================================
// src/ui/UIManager.js
// =============================================================================
// Layout orchestration – builds the app UI structure, provides containers
// for other components, handles global drop zone, and responsive adjustments.
// =============================================================================

export class UIManager {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.onDrop = options.onDrop || (() => {});

    // UI element references
    this.elements = {
      header: null,
      sidebar: null,
      treeContainer: null,
      tabContainer: null,
      editorSurface: null,
      inspectorContainer: null,
      searchContainer: null,
      dropZone: null,
      settingsContainer: null,
      mainArea: null,
      inspectorContent: null,
    };

    this.isSidebarVisible = true;
    this.isInspectorVisible = true;
  }

  /**
   * Render the full application layout
   */
  renderLayout() {
    const container = this.container;
    container.innerHTML = '';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '100vh';
    container.style.width = '100vw';
    container.style.backgroundColor = 'var(--bg-void)';
    container.style.color = 'var(--text-main)';
    container.style.overflow = 'hidden';

    // --- Header ---
    const header = this._createHeader();
    container.appendChild(header);
    this.elements.header = header;

    // --- Main body (sidebar + main + inspector) ---
    const body = document.createElement('div');
    body.style.display = 'flex';
    body.style.flex = '1';
    body.style.overflow = 'hidden';
    container.appendChild(body);

    // --- Sidebar ---
    const sidebar = this._createSidebar();
    body.appendChild(sidebar);
    this.elements.sidebar = sidebar;

    // --- Main area ---
    const mainArea = this._createMainArea();
    body.appendChild(mainArea);
    this.elements.mainArea = mainArea;

    // --- Inspector ---
    const inspector = this._createInspector();
    body.appendChild(inspector);
    this.elements.inspectorContainer = inspector;

    // --- Drop zone overlay (on the whole body) ---
    this._setupDropZone();

    // --- Global settings container (hidden by default) ---
    const settingsOverlay = this._createSettingsOverlay();
    container.appendChild(settingsOverlay);
    this.elements.settingsContainer = settingsOverlay;
  }

  // ---------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------
  _createHeader() {
    const header = document.createElement('header');
    header.style.height = '56px';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.padding = '0 20px';
    header.style.backgroundColor = 'var(--bg-panel)';
    header.style.borderBottom = '2px solid var(--nexus-cyan)';
    header.style.flexShrink = '0';

    // Left: logo + title
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '12px';

    const icon = document.createElement('i');
    icon.className = 'fas fa-biohazard';
    icon.style.fontSize = '28px';
    icon.style.color = 'var(--nexus-cyan)';
    left.appendChild(icon);

    const title = document.createElement('h1');
    title.textContent = 'NEXUS EXTRACTOR v4.0';
    title.style.fontSize = '20px';
    title.style.fontWeight = '900';
    title.style.letterSpacing = '0.15em';
    title.style.textTransform = 'uppercase';
    title.style.color = 'var(--nexus-cyan)';
    title.style.textShadow = '0 0 10px var(--nexus-cyan)';
    left.appendChild(title);

    header.appendChild(left);

    // Right: search container, ram meter, theme toggle, settings
    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '12px';

    // Search container (will be filled by SearchBar)
    const searchContainer = document.createElement('div');
    searchContainer.id = 'search-container';
    searchContainer.style.width = '220px';
    right.appendChild(searchContainer);
    this.elements.searchContainer = searchContainer;

    // RAM meter
    const ram = document.createElement('div');
    ram.id = 'ram-meter';
    ram.textContent = 'MEM: 0.00 MB';
    ram.style.fontSize = '12px';
    ram.style.fontFamily = 'monospace';
    ram.style.color = 'var(--nexus-cyan)';
    ram.style.backgroundColor = 'var(--bg-void)';
    ram.style.padding = '4px 12px';
    ram.style.border = '1px solid var(--nexus-cyan)';
    ram.style.borderRadius = '4px';
    right.appendChild(ram);

    // Theme toggle
    const themeBtn = document.createElement('button');
    themeBtn.innerHTML = '<i class="fas fa-moon"></i>';
    themeBtn.style.background = 'transparent';
    themeBtn.style.border = 'none';
    themeBtn.style.color = 'var(--text-muted)';
    themeBtn.style.cursor = 'pointer';
    themeBtn.style.fontSize = '18px';
    themeBtn.title = 'Toggle theme';
    themeBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('nexus:toggle-theme'));
    });
    right.appendChild(themeBtn);

    // Settings button
    const settingsBtn = document.createElement('button');
    settingsBtn.innerHTML = '<i class="fas fa-cog"></i>';
    settingsBtn.style.background = 'transparent';
    settingsBtn.style.border = 'none';
    settingsBtn.style.color = 'var(--text-muted)';
    settingsBtn.style.cursor = 'pointer';
    settingsBtn.style.fontSize = '18px';
    settingsBtn.title = 'Settings';
    settingsBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('nexus:open-settings'));
    });
    right.appendChild(settingsBtn);

    header.appendChild(right);
    return header;
  }

  // ---------------------------------------------------------------------------
  // Sidebar
  // ---------------------------------------------------------------------------
  _createSidebar() {
    const sidebar = document.createElement('aside');
    sidebar.style.width = '280px';
    sidebar.style.flexShrink = '0';
    sidebar.style.backgroundColor = 'var(--bg-panel)';
    sidebar.style.borderRight = '1px solid #333';
    sidebar.style.display = 'flex';
    sidebar.style.flexDirection = 'column';
    sidebar.style.overflow = 'hidden';

    // Drop zone area (top)
    const dropZone = document.createElement('div');
    dropZone.id = 'drop-zone';
    dropZone.style.padding = '20px';
    dropZone.style.textAlign = 'center';
    dropZone.style.borderBottom = '1px solid #333';
    dropZone.style.cursor = 'pointer';
    dropZone.style.backgroundColor = 'var(--bg-surface)';
    dropZone.innerHTML = `
      <i class="fas fa-satellite-dish" style="font-size: 32px; color: var(--text-muted); transition: color 0.2s;"></i>
      <h3 style="font-weight: bold; font-size: 14px; margin-top: 8px; color: white;">UPLINK ESTABLISHED</h3>
      <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Drop Target: ZIP, Media, Binaries</p>
    `;
    dropZone.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '*/*';
      input.onchange = (e) => {
        const files = Array.from(e.target.files);
        if (this.onDrop) this.onDrop(files);
      };
      input.click();
    });
    sidebar.appendChild(dropZone);
    this.elements.dropZone = dropZone;

    // VFS tree header
    const treeHeader = document.createElement('div');
    treeHeader.style.display = 'flex';
    treeHeader.style.justifyContent = 'space-between';
    treeHeader.style.alignItems = 'center';
    treeHeader.style.padding = '8px 16px';
    treeHeader.style.fontSize = '12px';
    treeHeader.style.fontWeight = 'bold';
    treeHeader.style.color = 'var(--text-muted)';
    treeHeader.style.textTransform = 'uppercase';
    treeHeader.style.borderBottom = '1px solid #333';
    treeHeader.innerHTML = `
      <span>Virtual File System</span>
      <div>
        <button id="vfs-new-folder" style="background:none;border:none;color:var(--nexus-cyan);cursor:pointer;"><i class="fas fa-folder-plus"></i></button>
        <button id="vfs-refresh" style="background:none;border:none;color:var(--nexus-cyan);cursor:pointer;margin-left:8px;"><i class="fas fa-sync-alt"></i></button>
      </div>
    `;
    sidebar.appendChild(treeHeader);

    // Tree container
    const treeContainer = document.createElement('div');
    treeContainer.id = 'vfs-tree';
    treeContainer.style.flex = '1';
    treeContainer.style.overflowY = 'auto';
    treeContainer.style.padding = '8px';
    treeContainer.style.backgroundColor = 'var(--bg-void)';
    sidebar.appendChild(treeContainer);
    this.elements.treeContainer = treeContainer;

    return sidebar;
  }

  // ---------------------------------------------------------------------------
  // Main area (tab bar + editor)
  // ---------------------------------------------------------------------------
  _createMainArea() {
    const mainArea = document.createElement('main');
    mainArea.style.flex = '1';
    mainArea.style.display = 'flex';
    mainArea.style.flexDirection = 'column';
    mainArea.style.backgroundColor = 'var(--bg-void)';
    mainArea.style.overflow = 'hidden';

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.id = 'tab-bar';
    tabBar.style.display = 'flex';
    tabBar.style.overflowX = 'auto';
    tabBar.style.backgroundColor = '#0a0a0a';
    tabBar.style.borderBottom = '1px solid #333';
    tabBar.style.height = '40px';
    tabBar.style.flexShrink = '0';
    mainArea.appendChild(tabBar);
    this.elements.tabContainer = tabBar;

    // Editor header (shows current file info)
    const editorHeader = document.createElement('div');
    editorHeader.id = 'editor-header';
    editorHeader.style.height = '32px';
    editorHeader.style.backgroundColor = 'var(--bg-surface)';
    editorHeader.style.borderBottom = '1px solid #333';
    editorHeader.style.display = 'flex';
    editorHeader.style.alignItems = 'center';
    editorHeader.style.padding = '0 16px';
    editorHeader.style.fontSize = '13px';
    editorHeader.style.fontFamily = 'monospace';
    editorHeader.style.color = 'var(--text-muted)';
    editorHeader.textContent = 'Awaiting File Selection...';
    mainArea.appendChild(editorHeader);

    // Editor surface (where plugins render)
    const editorSurface = document.createElement('div');
    editorSurface.id = 'editor-surface';
    editorSurface.style.flex = '1';
    editorSurface.style.overflow = 'auto';
    editorSurface.style.position = 'relative';
    editorSurface.style.display = 'flex';
    editorSurface.style.alignItems = 'center';
    editorSurface.style.justifyContent = 'center';
    editorSurface.style.background = 'radial-gradient(ellipse at center, #1a1a1a, #000000)';
    // Placeholder content
    editorSurface.innerHTML = `
      <div style="text-align:center;opacity:0.2;pointer-events:none;">
        <i class="fas fa-skull" style="font-size:80px;color:white;"></i>
        <h2 style="font-size:28px;font-weight:900;letter-spacing:0.2em;color:white;">NEXUS IDLE</h2>
      </div>
    `;
    mainArea.appendChild(editorSurface);
    this.elements.editorSurface = editorSurface;

    return mainArea;
  }

  // ---------------------------------------------------------------------------
  // Inspector
  // ---------------------------------------------------------------------------
  _createInspector() {
    const inspector = document.createElement('aside');
    inspector.style.width = '320px';
    inspector.style.flexShrink = '0';
    inspector.style.backgroundColor = 'var(--bg-panel)';
    inspector.style.borderLeft = '1px solid #333';
    inspector.style.display = 'flex';
    inspector.style.flexDirection = 'column';
    inspector.style.overflow = 'hidden';

    // Header
    const header = document.createElement('div');
    header.style.padding = '10px 16px';
    header.style.borderBottom = '1px solid #333';
    header.style.fontWeight = 'bold';
    header.style.fontSize = '13px';
    header.style.textTransform = 'uppercase';
    header.style.color = 'white';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '8px';
    header.style.backgroundColor = 'rgba(0,0,0,0.4)';
    header.innerHTML = '<i class="fas fa-terminal" style="color:var(--nexus-cyan);"></i> Inspector';
    inspector.appendChild(header);

    // Content (tools)
    const content = document.createElement('div');
    content.id = 'tool-panel';
    content.style.flex = '1';
    content.style.overflowY = 'auto';
    content.style.padding = '16px';
    content.style.backgroundColor = 'var(--bg-void)';
    content.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:12px;font-family:monospace;margin-top:40px;">&gt; NO DATA TARGET &lt;</p>';
    inspector.appendChild(content);
    this.elements.inspectorContent = content;

    return inspector;
  }

  // ---------------------------------------------------------------------------
  // Settings overlay
  // ---------------------------------------------------------------------------
  _createSettingsOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'settings-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.8)';
    overlay.style.zIndex = '10000';
    overlay.style.display = 'none';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';

    const panel = document.createElement('div');
    panel.style.backgroundColor = 'var(--bg-panel)';
    panel.style.border = '1px solid #333';
    panel.style.borderRadius = '8px';
    panel.style.width = '90%';
    panel.style.maxWidth = '800px';
    panel.style.maxHeight = '90vh';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.overflow = 'hidden';

    // Header with close
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.padding = '16px 20px';
    header.style.borderBottom = '1px solid #333';
    header.innerHTML = `
      <h2 style="font-weight:bold;font-size:18px;">Settings</h2>
      <button id="settings-close" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;">&times;</button>
    `;
    panel.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.id = 'settings-content';
    content.style.flex = '1';
    content.style.overflowY = 'auto';
    content.style.padding = '16px 20px';
    panel.appendChild(content);

    overlay.appendChild(panel);
    // Close button event
    header.querySelector('#settings-close').addEventListener('click', () => {
      overlay.style.display = 'none';
    });
    // Click outside closes
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    });

    return overlay;
  }

  // ---------------------------------------------------------------------------
  // Drop zone setup (global drag-and-drop)
  // ---------------------------------------------------------------------------
  _setupDropZone() {
    // Global drag over / drop
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dz = this.elements.dropZone;
      if (dz) dz.style.borderColor = 'var(--nexus-cyan)';
    });
    document.addEventListener('dragleave', (e) => {
      const dz = this.elements.dropZone;
      if (dz) dz.style.borderColor = '#333';
    });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const dz = this.elements.dropZone;
      if (dz) dz.style.borderColor = '#333';
      const files = Array.from(e.dataTransfer.files);
      if (files.length && this.onDrop) {
        this.onDrop(files);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Public accessors
  // ---------------------------------------------------------------------------
  getTreeContainer() {
    return this.elements.treeContainer;
  }

  getTabContainer() {
    return this.elements.tabContainer;
  }

  getSearchContainer() {
    return this.elements.searchContainer;
  }

  getInspectorContainer() {
    return this.elements.inspectorContent;
  }

  getSettingsContainer() {
    return this.elements.settingsContainer;
  }

  getEditorSurface() {
    return this.elements.editorSurface;
  }

  getEditorHeader() {
    return document.getElementById('editor-header');
  }

  // ---------------------------------------------------------------------------
  // UI updates
  // ---------------------------------------------------------------------------
  updateRAMMeter(bytes) {
    const el = document.getElementById('ram-meter');
    if (el) {
      const mb = (bytes / 1024 / 1024).toFixed(2);
      el.textContent = `MEM: ${mb} MB`;
    }
  }

  toggleSidebar() {
    this.isSidebarVisible = !this.isSidebarVisible;
    this.elements.sidebar.style.display = this.isSidebarVisible ? 'flex' : 'none';
  }

  toggleInspector() {
    this.isInspectorVisible = !this.isInspectorVisible;
    this.elements.inspectorContainer.style.display = this.isInspectorVisible ? 'flex' : 'none';
  }

  showSettings() {
    const overlay = this.elements.settingsContainer;
    if (overlay) overlay.style.display = 'flex';
  }

  hideSettings() {
    const overlay = this.elements.settingsContainer;
    if (overlay) overlay.style.display = 'none';
  }

  setEditorContent(html) {
    const surface = this.elements.editorSurface;
    if (surface) surface.innerHTML = html;
  }

  setEditorHeaderText(text) {
    const header = document.getElementById('editor-header');
    if (header) header.textContent = text;
  }

  clearEditor() {
    this.setEditorContent(`
      <div style="text-align:center;opacity:0.2;pointer-events:none;">
        <i class="fas fa-skull" style="font-size:80px;color:white;"></i>
        <h2 style="font-size:28px;font-weight:900;letter-spacing:0.2em;color:white;">NEXUS IDLE</h2>
      </div>
    `);
    this.setEditorHeaderText('Awaiting File Selection...');
  }
}