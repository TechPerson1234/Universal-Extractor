const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

export class UIManager {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.onDrop = options.onDrop || (() => {});
    this.onResize = options.onResize || (() => {});
    this.elements = {
      header: null,
      body: null,
      sidebar: null,
      sidebarOverlay: null,
      treeContainer: null,
      dropZone: null,
      mainArea: null,
      tabContainer: null,
      editorHeader: null,
      editorSurface: null,
      inspector: null,
      inspectorOverlay: null,
      inspectorContent: null,
      searchContainer: null,
      settingsOverlay: null,
      settingsContent: null,
      statusBar: null,
      mobileNav: null,
      ramMeter: null,
    };
    this.isSidebarVisible = true;
    this.isInspectorVisible = true;
    this.isMobile = false;
    this.isTablet = false;
    this._boundResize = this._handleResize.bind(this);
    this._dropTargets = new Set();
    this._gestureHandlers = new Map();
  }

  renderLayout() {
    const container = this.container;
    container.innerHTML = '';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '100vh';
    container.style.height = '100dvh';
    container.style.width = '100vw';
    container.style.backgroundColor = 'var(--bg-void)';
    container.style.color = 'var(--text-main)';
    container.style.overflow = 'hidden';
    container.style.position = 'relative';

    this._detectDevice();
    this._injectResponsiveStyles();

    const header = this._createHeader();
    container.appendChild(header);
    this.elements.header = header;

    const body = document.createElement('div');
    body.style.display = 'flex';
    body.style.flex = '1';
    body.style.overflow = 'hidden';
    body.style.position = 'relative';
    body.style.minHeight = '0';
    container.appendChild(body);
    this.elements.body = body;

    const sidebar = this._createSidebar();
    body.appendChild(sidebar);
    this.elements.sidebar = sidebar;

    const mainArea = this._createMainArea();
    body.appendChild(mainArea);
    this.elements.mainArea = mainArea;

    const inspector = this._createInspector();
    body.appendChild(inspector);
    this.elements.inspector = inspector;

    const statusBar = this._createStatusBar();
    container.appendChild(statusBar);
    this.elements.statusBar = statusBar;

    const mobileNav = this._createMobileNav();
    container.appendChild(mobileNav);
    this.elements.mobileNav = mobileNav;

    const sidebarOverlay = this._createOverlay('sidebar-overlay');
    body.appendChild(sidebarOverlay);
    this.elements.sidebarOverlay = sidebarOverlay;

    const inspectorOverlay = this._createOverlay('inspector-overlay');
    body.appendChild(inspectorOverlay);
    this.elements.inspectorOverlay = inspectorOverlay;

    const settingsOverlay = this._createSettingsOverlay();
    container.appendChild(settingsOverlay);
    this.elements.settingsOverlay = settingsOverlay;

    this._setupDropZone(body);
    this._setupResponsive();
    this._applyMobileState();
  }

  _detectDevice() {
    const w = window.innerWidth;
    this.isMobile = w < MOBILE_BREAKPOINT;
    this.isTablet = w >= MOBILE_BREAKPOINT && w < TABLET_BREAKPOINT;
  }

  _injectResponsiveStyles() {
    if (document.getElementById('nexus-responsive-styles')) return;
    const style = document.createElement('style');
    style.id = 'nexus-responsive-styles';
    style.textContent = `
      .nexus-drawer { transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
      .nexus-drawer.mobile-open { transform: translateX(0) !important; }
      .nexus-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); opacity: 0; pointer-events: none; transition: opacity 0.25s; z-index: 50; }
      .nexus-overlay.visible { opacity: 1; pointer-events: auto; }
      @media (max-width: 767px) {
        .nexus-desktop-only { display: none !important; }
        .nexus-mobile-nav { display: flex !important; }
      }
      @media (min-width: 768px) {
        .nexus-mobile-nav { display: none !important; }
        .nexus-mobile-only { display: none !important; }
      }
      .nexus-touch { touch-action: manipulation; -webkit-tap-highlight-color: transparent; user-select: none; }
      .nexus-scroll { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
      .nexus-safe-top { padding-top: env(safe-area-inset-top); }
      .nexus-safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
    `;
    document.head.appendChild(style);
  }

  _createHeader() {
    const header = document.createElement('header');
    header.style.cssText = 'height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:var(--bg-panel);border-bottom:2px solid var(--nexus-cyan);flex-shrink:0;z-index:100;position:relative;';

    const left = document.createElement('div');
    left.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:0;flex:1;';

    const menuBtn = document.createElement('button');
    menuBtn.className = 'nexus-mobile-only nexus-touch';
    menuBtn.innerHTML = '<i class="fas fa-bars"></i>';
    menuBtn.style.cssText = 'background:none;border:none;color:var(--nexus-cyan);cursor:pointer;font-size:20px;padding:8px;display:none;';
    menuBtn.addEventListener('click', () => this.toggleSidebar());
    left.appendChild(menuBtn);

    const icon = document.createElement('i');
    icon.className = 'fas fa-biohazard';
    icon.style.cssText = 'font-size:26px;color:var(--nexus-cyan);flex-shrink:0;';
    left.appendChild(icon);

    const title = document.createElement('h1');
    title.textContent = 'NEXUS EXTRACTOR';
    title.style.cssText = 'font-size:16px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:var(--nexus-cyan);text-shadow:0 0 10px var(--nexus-cyan);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    left.appendChild(title);

    const version = document.createElement('span');
    version.textContent = 'v5.0';
    version.style.cssText = 'font-size:10px;color:var(--text-muted);font-family:monospace;padding:2px 6px;border:1px solid #333;border-radius:3px;';
    version.className = 'nexus-desktop-only';
    left.appendChild(version);

    header.appendChild(left);

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

    const searchContainer = document.createElement('div');
    searchContainer.id = 'search-container';
    searchContainer.className = 'nexus-desktop-only';
    searchContainer.style.cssText = 'width:220px;';
    right.appendChild(searchContainer);
    this.elements.searchContainer = searchContainer;

    const ram = document.createElement('div');
    ram.id = 'ram-meter';
    ram.textContent = 'MEM: 0 MB';
    ram.className = 'nexus-desktop-only';
    ram.style.cssText = 'font-size:11px;font-family:monospace;color:var(--nexus-cyan);background:var(--bg-void);padding:4px 10px;border:1px solid var(--nexus-cyan);border-radius:4px;white-space:nowrap;';
    right.appendChild(ram);
    this.elements.ramMeter = ram;

    const themeBtn = document.createElement('button');
    themeBtn.innerHTML = '<i class="fas fa-moon"></i>';
    themeBtn.className = 'nexus-touch';
    themeBtn.style.cssText = 'background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:6px;';
    themeBtn.title = 'Toggle theme';
    themeBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('nexus:toggle-theme'));
    });
    right.appendChild(themeBtn);

    const settingsBtn = document.createElement('button');
    settingsBtn.innerHTML = '<i class="fas fa-cog"></i>';
    settingsBtn.className = 'nexus-touch';
    settingsBtn.style.cssText = 'background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:6px;';
    settingsBtn.title = 'Settings';
    settingsBtn.addEventListener('click', () => this.showSettings());
    right.appendChild(settingsBtn);

    const inspectorBtn = document.createElement('button');
    inspectorBtn.innerHTML = '<i class="fas fa-sliders-h"></i>';
    inspectorBtn.className = 'nexus-mobile-only nexus-touch';
    inspectorBtn.style.cssText = 'background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:6px;display:none;';
    inspectorBtn.addEventListener('click', () => this.toggleInspector());
    right.appendChild(inspectorBtn);

    header.appendChild(right);
    return header;
  }

  _createSidebar() {
    const sidebar = document.createElement('aside');
    sidebar.id = 'sidebar';
    sidebar.className = 'nexus-drawer nexus-scroll';
    sidebar.style.cssText = 'width:280px;flex-shrink:0;background:var(--bg-panel);border-right:1px solid #333;display:flex;flex-direction:column;overflow:hidden;';

    const dropZone = document.createElement('div');
    dropZone.id = 'drop-zone';
    dropZone.className = 'nexus-touch';
    dropZone.style.cssText = 'padding:16px;text-align:center;border-bottom:1px solid #333;cursor:pointer;background:var(--bg-surface);transition:background 0.15s;';
    dropZone.innerHTML = `
      <i class="fas fa-satellite-dish" style="font-size:28px;color:var(--text-muted);transition:color 0.2s;"></i>
      <h3 style="font-weight:bold;font-size:13px;margin-top:6px;color:white;">DROP TARGET</h3>
      <p style="font-size:11px;color:var(--text-muted);margin-top:2px;">ZIP, Media, Binaries</p>
    `;
    dropZone.addEventListener('click', () => this._triggerFilePicker());
    dropZone.addEventListener('mouseenter', () => {
      dropZone.style.background = 'rgba(0,240,255,0.05)';
    });
    dropZone.addEventListener('mouseleave', () => {
      dropZone.style.background = 'var(--bg-surface)';
    });
    sidebar.appendChild(dropZone);
    this.elements.dropZone = dropZone;

    const treeHeader = document.createElement('div');
    treeHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;font-size:11px;font-weight:bold;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid #333;letter-spacing:0.05em;';
    treeHeader.innerHTML = `
      <span>Virtual File System</span>
      <div style="display:flex;gap:6px;">
        <button id="vfs-new-folder" title="New folder" class="nexus-touch" style="background:none;border:none;color:var(--nexus-cyan);cursor:pointer;font-size:14px;padding:2px;"><i class="fas fa-folder-plus"></i></button>
        <button id="vfs-refresh" title="Refresh" class="nexus-touch" style="background:none;border:none;color:var(--nexus-cyan);cursor:pointer;font-size:14px;padding:2px;"><i class="fas fa-sync-alt"></i></button>
      </div>
    `;
    sidebar.appendChild(treeHeader);

    const treeContainer = document.createElement('div');
    treeContainer.id = 'vfs-tree';
    treeContainer.className = 'nexus-scroll';
    treeContainer.style.cssText = 'flex:1;overflow-y:auto;padding:4px;background:var(--bg-void);';
    sidebar.appendChild(treeContainer);
    this.elements.treeContainer = treeContainer;

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:8px 12px;border-top:1px solid #333;font-size:10px;color:var(--text-muted);font-family:monospace;display:flex;justify-content:space-between;align-items:center;';
    footer.innerHTML = `
      <span id="vfs-stats">0 files</span>
      <span id="vfs-quota" style="color:var(--nexus-cyan);">—</span>
    `;
    sidebar.appendChild(footer);

    return sidebar;
  }

  _createMainArea() {
    const mainArea = document.createElement('main');
    mainArea.style.cssText = 'flex:1;display:flex;flex-direction:column;background:var(--bg-void);overflow:hidden;min-width:0;';

    const tabBar = document.createElement('div');
    tabBar.id = 'tab-bar';
    tabBar.className = 'nexus-scroll';
    tabBar.style.cssText = 'display:flex;overflow-x:auto;background:#0a0a0a;border-bottom:1px solid #333;min-height:40px;flex-shrink:0;';
    mainArea.appendChild(tabBar);
    this.elements.tabContainer = tabBar;

    const editorHeader = document.createElement('div');
    editorHeader.id = 'editor-header';
    editorHeader.style.cssText = 'min-height:32px;background:var(--bg-surface);border-bottom:1px solid #333;display:flex;align-items:center;padding:0 16px;font-size:12px;font-family:monospace;color:var(--text-muted);flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    editorHeader.textContent = 'Awaiting File Selection...';
    mainArea.appendChild(editorHeader);
    this.elements.editorHeader = editorHeader;

    const editorSurface = document.createElement('div');
    editorSurface.id = 'editor-surface';
    editorSurface.className = 'nexus-scroll';
    editorSurface.style.cssText = 'flex:1;overflow:auto;position:relative;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center, #1a1a1a, #000000);';
    editorSurface.innerHTML = `
      <div style="text-align:center;opacity:0.2;pointer-events:none;padding:20px;">
        <i class="fas fa-skull" style="font-size:80px;color:white;"></i>
        <h2 style="font-size:28px;font-weight:900;letter-spacing:0.2em;color:white;margin-top:8px;">NEXUS IDLE</h2>
      </div>
    `;
    mainArea.appendChild(editorSurface);
    this.elements.editorSurface = editorSurface;

    return mainArea;
  }

  _createInspector() {
    const inspector = document.createElement('aside');
    inspector.id = 'inspector';
    inspector.className = 'nexus-drawer nexus-scroll';
    inspector.style.cssText = 'width:320px;flex-shrink:0;background:var(--bg-panel);border-left:1px solid #333;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'padding:10px 16px;border-bottom:1px solid #333;font-weight:bold;font-size:12px;text-transform:uppercase;color:white;display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.4);letter-spacing:0.05em;';
    header.innerHTML = `
      <span style="display:flex;align-items:center;gap:8px;"><i class="fas fa-terminal" style="color:var(--nexus-cyan);"></i> Inspector</span>
      <button id="inspector-close" class="nexus-mobile-only nexus-touch" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;display:none;">&times;</button>
    `;
    inspector.appendChild(header);

    const content = document.createElement('div');
    content.id = 'tool-panel';
    content.className = 'nexus-scroll';
    content.style.cssText = 'flex:1;overflow-y:auto;padding:12px;background:var(--bg-void);';
    content.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:12px;font-family:monospace;margin-top:40px;">&gt; NO DATA TARGET &lt;</p>';
    inspector.appendChild(content);
    this.elements.inspectorContent = content;

    const closeBtn = header.querySelector('#inspector-close');
    closeBtn.addEventListener('click', () => this.toggleInspector());

    return inspector;
  }

  _createStatusBar() {
    const bar = document.createElement('div');
    bar.id = 'status-bar';
    bar.style.cssText = 'height:24px;background:var(--bg-panel);border-top:1px solid #333;display:flex;align-items:center;padding:0 12px;font-size:11px;font-family:monospace;color:var(--text-muted);gap:16px;flex-shrink:0;overflow:hidden;';
    bar.innerHTML = `
      <span id="status-ready" style="color:#00ff41;">● READY</span>
      <span id="status-activity" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
      <span id="status-progress-wrap" style="display:none;width:120px;height:4px;background:#1a1a1a;border-radius:2px;overflow:hidden;">
        <span id="status-progress-bar" style="display:block;height:100%;width:0%;background:var(--nexus-cyan);transition:width 0.2s;"></span>
      </span>
      <span id="status-workers">W:0</span>
      <span id="status-queue">Q:0</span>
      <span id="status-online" style="color:#00ff41;">⬤ ONLINE</span>
    `;
    return bar;
  }

  _createMobileNav() {
    const nav = document.createElement('nav');
    nav.className = 'nexus-mobile-nav';
    nav.style.cssText = 'display:none;height:52px;background:var(--bg-panel);border-top:1px solid #333;align-items:center;justify-content:space-around;flex-shrink:0;padding-bottom:env(safe-area-inset-bottom);z-index:100;';

    const items = [
      { icon: 'fa-folder', label: 'Files', action: () => this.toggleSidebar() },
      { icon: 'fa-search', label: 'Search', action: () => this._openMobileSearch() },
      { icon: 'fa-upload', label: 'Upload', action: () => this._triggerFilePicker() },
      { icon: 'fa-sliders-h', label: 'Tools', action: () => this.toggleInspector() },
      { icon: 'fa-cog', label: 'Settings', action: () => this.showSettings() },
    ];

    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'nexus-touch';
      btn.style.cssText = 'background:none;border:none;color:var(--text-muted);display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 12px;cursor:pointer;font-size:9px;';
      btn.innerHTML = `<i class="fas ${item.icon}" style="font-size:18px;"></i><span>${item.label}</span>`;
      btn.addEventListener('click', item.action);
      nav.appendChild(btn);
    }

    return nav;
  }

  _openMobileSearch() {
    const query = prompt('Search files:');
    if (query) {
      document.dispatchEvent(new CustomEvent('nexus:search', { detail: { query } }));
    }
  }

  _createOverlay(id) {
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'nexus-overlay';
    overlay.addEventListener('click', () => {
      if (id === 'sidebar-overlay') this._closeSidebarMobile();
      if (id === 'inspector-overlay') this._closeInspectorMobile();
    });
    return overlay;
  }

  _createSettingsOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'settings-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:none;justify-content:center;align-items:center;padding:16px;backdrop-filter:blur(4px);';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:var(--bg-panel);border:1px solid #333;border-radius:8px;width:100%;max-width:800px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #333;';
    header.innerHTML = `
      <h2 style="font-weight:bold;font-size:16px;color:white;">Settings</h2>
      <button id="settings-close" class="nexus-touch" style="background:none;border:none;color:var(--text-muted);font-size:22px;cursor:pointer;line-height:1;">&times;</button>
    `;
    panel.appendChild(header);

    const content = document.createElement('div');
    content.id = 'settings-content';
    content.className = 'nexus-scroll';
    content.style.cssText = 'flex:1;overflow-y:auto;padding:16px 18px;';
    panel.appendChild(content);

    overlay.appendChild(panel);

    header.querySelector('#settings-close').addEventListener('click', () => this.hideSettings());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.hideSettings();
    });

    this.elements.settingsContent = content;
    return overlay;
  }

  _setupDropZone(body) {
    let dragCounter = 0;
    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      const dz = this.elements.dropZone;
      if (dz) {
        dz.style.background = 'rgba(0,240,255,0.15)';
        dz.style.borderColor = 'var(--nexus-cyan)';
      }
    });
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        const dz = this.elements.dropZone;
        if (dz) dz.style.background = 'var(--bg-surface)';
      }
    });
    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      const dz = this.elements.dropZone;
      if (dz) dz.style.background = 'var(--bg-surface)';

      const items = e.dataTransfer?.items;
      if (items && items.length && items[0].webkitGetAsEntry) {
        const collected = [];
        for (const item of items) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            const tree = await this._readEntry(entry);
            if (tree) collected.push(tree);
          }
        }
        if (collected.length) {
          this.onDrop(collected);
          return;
        }
      }
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) this.onDrop(files);
    });
  }

  async _readEntry(entry, path = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      return file;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise((resolve) => {
        const all = [];
        const readBatch = () => {
          reader.readEntries((batch) => {
            if (!batch.length) resolve(all);
            else {
              all.push(...batch);
              readBatch();
            }
          }, () => resolve(all));
        };
        readBatch();
      });
      const children = [];
      for (const child of entries) {
        const item = await this._readEntry(child, path + '/' + entry.name);
        if (item) children.push(item);
      }
      return {
        __kind: 'directory',
        name: entry.name,
        children,
        path: path + '/' + entry.name,
      };
    }
    return null;
  }

  _triggerFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '*/*';
    input.onchange = (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length) this.onDrop(files);
    };
    input.click();
  }

  _setupResponsive() {
    window.addEventListener('resize', this._boundResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this._handleResize(), 100);
    });
  }

  _handleResize() {
    const wasMobile = this.isMobile;
    this._detectDevice();
    this._applyMobileState();
    if (wasMobile !== this.isMobile && !this.isMobile) {
      this._closeSidebarMobile();
      this._closeInspectorMobile();
    }
    this.onResize({ isMobile: this.isMobile, isTablet: this.isTablet });
  }

  _applyMobileState() {
    const sidebar = this.elements.sidebar;
    const inspector = this.elements.inspector;
    const menuBtn = this.elements.header?.querySelector('.nexus-mobile-only');
    const inspectorBtn = this.elements.header?.querySelectorAll('.nexus-mobile-only')[1];
    const inspectorClose = this.elements.inspector?.querySelector('#inspector-close');

    if (this.isMobile) {
      if (sidebar) {
        sidebar.style.position = 'absolute';
        sidebar.style.top = '0';
        sidebar.style.bottom = '0';
        sidebar.style.left = '0';
        sidebar.style.zIndex = '60';
        sidebar.style.width = '82vw';
        sidebar.style.maxWidth = '320px';
        if (!sidebar.classList.contains('mobile-open')) {
          sidebar.style.transform = 'translateX(-100%)';
        }
      }
      if (inspector) {
        inspector.style.position = 'absolute';
        inspector.style.top = '0';
        inspector.style.bottom = '0';
        inspector.style.right = '0';
        inspector.style.zIndex = '60';
        inspector.style.width = '86vw';
        inspector.style.maxWidth = '360px';
        if (!inspector.classList.contains('mobile-open')) {
          inspector.style.transform = 'translateX(100%)';
        }
      }
      if (menuBtn) menuBtn.style.display = 'block';
      if (inspectorBtn) inspectorBtn.style.display = 'block';
      if (inspectorClose) inspectorClose.style.display = 'block';
    } else {
      if (sidebar) {
        sidebar.style.position = 'relative';
        sidebar.style.transform = 'none';
        sidebar.style.width = '280px';
        sidebar.style.zIndex = '1';
        sidebar.style.display = this.isSidebarVisible ? 'flex' : 'none';
      }
      if (inspector) {
        inspector.style.position = 'relative';
        inspector.style.transform = 'none';
        inspector.style.width = '320px';
        inspector.style.zIndex = '1';
        inspector.style.display = this.isInspectorVisible ? 'flex' : 'none';
      }
      if (menuBtn) menuBtn.style.display = 'none';
      if (inspectorBtn) inspectorBtn.style.display = 'none';
      if (inspectorClose) inspectorClose.style.display = 'none';
      this._closeSidebarMobile();
      this._closeInspectorMobile();
    }
  }

  toggleSidebar() {
    if (this.isMobile) {
      const sidebar = this.elements.sidebar;
      const overlay = this.elements.sidebarOverlay;
      const isOpen = sidebar.classList.contains('mobile-open');
      if (isOpen) this._closeSidebarMobile();
      else {
        sidebar.classList.add('mobile-open');
        if (overlay) overlay.classList.add('visible');
      }
    } else {
      this.isSidebarVisible = !this.isSidebarVisible;
      if (this.elements.sidebar) {
        this.elements.sidebar.style.display = this.isSidebarVisible ? 'flex' : 'none';
      }
    }
  }

  _closeSidebarMobile() {
    const sidebar = this.elements.sidebar;
    const overlay = this.elements.sidebarOverlay;
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('visible');
  }

  toggleInspector() {
    if (this.isMobile) {
      const inspector = this.elements.inspector;
      const overlay = this.elements.inspectorOverlay;
      const isOpen = inspector.classList.contains('mobile-open');
      if (isOpen) this._closeInspectorMobile();
      else {
        inspector.classList.add('mobile-open');
        if (overlay) overlay.classList.add('visible');
      }
    } else {
      this.isInspectorVisible = !this.isInspectorVisible;
      if (this.elements.inspector) {
        this.elements.inspector.style.display = this.isInspectorVisible ? 'flex' : 'none';
      }
    }
  }

  _closeInspectorMobile() {
    const inspector = this.elements.inspector;
    const overlay = this.elements.inspectorOverlay;
    if (inspector) inspector.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('visible');
  }

  showSettings() {
    if (this.elements.settingsOverlay) this.elements.settingsOverlay.style.display = 'flex';
  }

  hideSettings() {
    if (this.elements.settingsOverlay) this.elements.settingsOverlay.style.display = 'none';
  }

  updateRAMMeter(bytes) {
    if (this.elements.ramMeter) {
      const mb = (bytes / 1024 / 1024).toFixed(1);
      this.elements.ramMeter.textContent = `MEM: ${mb} MB`;
    }
  }

  updateStatus(key, value) {
    const el = document.getElementById(`status-${key}`);
    if (el) el.textContent = value;
  }

  setActivity(text) {
    const el = document.getElementById('status-activity');
    if (el) el.textContent = text;
  }

  showProgress(percent) {
    const wrap = document.getElementById('status-progress-wrap');
    const bar = document.getElementById('status-progress-bar');
    if (wrap && bar) {
      wrap.style.display = 'block';
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
  }

  hideProgress() {
    const wrap = document.getElementById('status-progress-wrap');
    if (wrap) wrap.style.display = 'none';
  }

  setOnline(online) {
    const el = document.getElementById('status-online');
    if (el) {
      el.textContent = online ? '⬤ ONLINE' : '⬤ OFFLINE';
      el.style.color = online ? '#00ff41' : '#ff003c';
    }
  }

  setEditorContent(html) {
    if (this.elements.editorSurface) this.elements.editorSurface.innerHTML = html;
  }

  setEditorHeaderText(text) {
    if (this.elements.editorHeader) this.elements.editorHeader.textContent = text;
  }

  clearEditor() {
    this.setEditorContent(`
      <div style="text-align:center;opacity:0.2;pointer-events:none;padding:20px;">
        <i class="fas fa-skull" style="font-size:80px;color:white;"></i>
        <h2 style="font-size:28px;font-weight:900;letter-spacing:0.2em;color:white;margin-top:8px;">NEXUS IDLE</h2>
      </div>
    `);
    this.setEditorHeaderText('Awaiting File Selection...');
  }

  updateVFSStats(text, quota) {
    const stats = document.getElementById('vfs-stats');
    const quotaEl = document.getElementById('vfs-quota');
    if (stats) stats.textContent = text;
    if (quotaEl && quota) quotaEl.textContent = quota;
  }

  getTreeContainer() { return this.elements.treeContainer; }
  getTabContainer() { return this.elements.tabContainer; }
  getSearchContainer() { return this.elements.searchContainer; }
  getInspectorContainer() { return this.elements.inspectorContent; }
  getSettingsContainer() { return this.elements.settingsContent; }
  getEditorSurface() { return this.elements.editorSurface; }
  getEditorHeader() { return this.elements.editorHeader; }
  getStatusBar() { return this.elements.statusBar; }

  destroy() {
    window.removeEventListener('resize', this._boundResize);
    this.container.innerHTML = '';
  }
}
