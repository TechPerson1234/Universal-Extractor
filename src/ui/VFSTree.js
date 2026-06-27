// =============================================================================
// src/ui/VFSTree.js
// =============================================================================
// Virtualized file tree with drag-drop, context menu, selection, sorting,
// and lazy loading of visible items.
// =============================================================================

export class VFSTree {
  constructor(container, options = {}) {
    this.container = container;
    this.vfs = options.vfs;
    this.onSelect = options.onSelect || (() => {});
    this.onContextMenu = options.onContextMenu || (() => {});
    this.onCreateFolder = options.onCreateFolder || (() => {});

    this.currentPath = '/';
    this.items = []; // array of { type, name, path, size, ... }
    this.selectedPath = null;
    this.contextMenu = null;
    this.isDragging = false;
    this.dragData = null;

    // Virtualization
    this.visibleRange = { start: 0, end: 50 };
    this.itemHeight = 32; // approximate height per row
    this.renderCache = new Map(); // path -> DOM element (for reuse)

    this._setupContextMenu();
    this._setupDragDrop();
    this._bindEvents();
  }

  /**
   * Render the tree for a given folder path
   */
  render(path = this.currentPath) {
    this.currentPath = path || '/';
    this.items = this.vfs.listFolder(this.currentPath);
    // Sort: folders first, then files, alphabetically
    this.items.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });
    this.selectedPath = null;
    this._renderVisible();
  }

  /**
   * Render only visible items (virtualized)
   */
  _renderVisible() {
    const container = this.container;
    // Determine visible range based on scroll
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;
    const totalItems = this.items.length;
    const start = Math.floor(scrollTop / this.itemHeight);
    const end = Math.min(start + Math.ceil(clientHeight / this.itemHeight) + 5, totalItems);

    // Clear container
    container.innerHTML = '';

    // Add spacer for top
    if (start > 0) {
      const spacer = document.createElement('div');
      spacer.style.height = (start * this.itemHeight) + 'px';
      container.appendChild(spacer);
    }

    // Render visible items
    for (let i = start; i < end; i++) {
      const item = this.items[i];
      const el = this._createItemElement(item, i);
      container.appendChild(el);
    }

    // Spacer for bottom
    if (end < totalItems) {
      const spacer = document.createElement('div');
      spacer.style.height = ((totalItems - end) * this.itemHeight) + 'px';
      container.appendChild(spacer);
    }

    // Update scroll listener for virtualization
    this._attachScrollListener();
  }

  _createItemElement(item, index) {
    const el = document.createElement('div');
    el.className = 'vfs-item';
    el.dataset.path = item.path;
    el.dataset.type = item.type;
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'space-between';
    el.style.padding = '4px 12px';
    el.style.height = this.itemHeight + 'px';
    el.style.cursor = 'pointer';
    el.style.borderRadius = '4px';
    el.style.transition = 'background 0.15s';
    el.style.color = '#ccc';
    el.style.fontSize = '14px';

    // Left: icon + name
    const left = document.createElement('span');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '8px';
    left.style.overflow = 'hidden';
    left.style.whiteSpace = 'nowrap';
    left.style.textOverflow = 'ellipsis';

    // Icon
    const icon = document.createElement('i');
    if (item.type === 'folder') {
      icon.className = 'fas fa-folder';
      icon.style.color = '#fbbf24';
    } else {
      // Determine icon based on file type
      const typeMap = {
        'IMAGE': 'fa-image',
        'VIDEO': 'fa-film',
        'AUDIO': 'fa-wave-square',
        'MODEL': 'fa-cube',
        'PDF': 'fa-file-pdf',
        'TEXT': 'fa-code',
        'ARCHIVE': 'fa-file-archive',
      };
      const iconClass = typeMap[item.type] || 'fa-file';
      icon.className = `fas ${iconClass}`;
      icon.style.color = item.type === 'IMAGE' ? '#8a2be2' :
                         item.type === 'VIDEO' ? '#ff003c' :
                         item.type === 'AUDIO' ? '#00f0ff' :
                         item.type === 'MODEL' ? '#ff8800' :
                         item.type === 'PDF' ? '#ff003c' :
                         item.type === 'TEXT' ? '#00ff41' :
                         '#666';
    }
    icon.style.width = '18px';
    icon.style.textAlign = 'center';
    left.appendChild(icon);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = item.name;
    nameSpan.style.overflow = 'hidden';
    nameSpan.style.textOverflow = 'ellipsis';
    left.appendChild(nameSpan);

    el.appendChild(left);

    // Right: size (for files)
    if (item.type !== 'folder') {
      const sizeSpan = document.createElement('span');
      sizeSpan.textContent = this._formatBytes(item.size);
      sizeSpan.style.fontSize = '10px';
      sizeSpan.style.color = '#555';
      el.appendChild(sizeSpan);
    } else {
      // For folder, add a small chevron
      const chevron = document.createElement('i');
      chevron.className = 'fas fa-chevron-right';
      chevron.style.fontSize = '10px';
      chevron.style.color = '#555';
      el.appendChild(chevron);
    }

    // Events
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.type === 'folder') {
        this.render(item.path);
        this.onSelect(item.path);
      } else {
        this.selectedPath = item.path;
        this._highlightItem(el);
        this.onSelect(item.path);
      }
    });

    // Context menu
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selectedPath = item.path;
      this._highlightItem(el);
      this.showContextMenu(item.path, e.clientX, e.clientY);
    });

    // Drag events (if file)
    if (item.type !== 'folder') {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        this.isDragging = true;
        this.dragData = { path: item.path, name: item.name };
        e.dataTransfer.setData('text/plain', item.path);
        el.style.opacity = '0.5';
      });
      el.addEventListener('dragend', () => {
        this.isDragging = false;
        el.style.opacity = '1';
      });
    }

    // Drop target for folders
    if (item.type === 'folder') {
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.style.backgroundColor = 'rgba(0,240,255,0.1)';
      });
      el.addEventListener('dragleave', () => {
        el.style.backgroundColor = '';
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.style.backgroundColor = '';
        const srcPath = e.dataTransfer.getData('text/plain');
        if (srcPath) {
          const destPath = item.path;
          // Move file to folder
          const fileName = srcPath.split('/').pop();
          const newPath = destPath === '/' ? '/' + fileName : destPath + '/' + fileName;
          this.vfs.moveFile(srcPath, newPath);
          this.render(this.currentPath);
        }
      });
    }

    // Hover
    el.addEventListener('mouseenter', () => {
      if (!el.classList.contains('selected')) {
        el.style.backgroundColor = 'rgba(255,255,255,0.05)';
      }
    });
    el.addEventListener('mouseleave', () => {
      if (!el.classList.contains('selected')) {
        el.style.backgroundColor = '';
      }
    });

    return el;
  }

  _highlightItem(el) {
    // Clear all highlights
    this.container.querySelectorAll('.vfs-item').forEach(e => {
      e.classList.remove('selected');
      e.style.backgroundColor = '';
    });
    if (el) {
      el.classList.add('selected');
      el.style.backgroundColor = 'rgba(0,240,255,0.15)';
    }
  }

  _attachScrollListener() {
    // Use a debounced scroll handler
    if (this._scrollHandler) {
      this.container.removeEventListener('scroll', this._scrollHandler);
    }
    this._scrollHandler = this._debounce(() => this._renderVisible(), 50);
    this.container.addEventListener('scroll', this._scrollHandler);
  }

  _debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  _formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // ---------------------------------------------------------------------------
  // Context Menu
  // ---------------------------------------------------------------------------
  _setupContextMenu() {
    // Use a single context menu instance
    this.contextMenu = document.createElement('div');
    this.contextMenu.style.position = 'fixed';
    this.contextMenu.style.backgroundColor = 'var(--bg-panel)';
    this.contextMenu.style.border = '1px solid #333';
    this.contextMenu.style.borderRadius = '4px';
    this.contextMenu.style.padding = '4px 0';
    this.contextMenu.style.minWidth = '160px';
    this.contextMenu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.8)';
    this.contextMenu.style.zIndex = '9999';
    this.contextMenu.style.display = 'none';
    document.body.appendChild(this.contextMenu);

    // Close on click outside
    document.addEventListener('click', () => {
      this.contextMenu.style.display = 'none';
    });
  }

  showContextMenu(path, x, y) {
    const menu = this.contextMenu;
    menu.innerHTML = '';
    menu.style.display = 'block';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const actions = [
      { label: 'Rename', icon: 'fa-edit', action: 'rename' },
      { label: 'Delete', icon: 'fa-trash', action: 'delete' },
      { label: 'Duplicate', icon: 'fa-copy', action: 'duplicate' },
      { label: 'Export', icon: 'fa-download', action: 'export' },
      { label: 'Checksum', icon: 'fa-shield-alt', action: 'checksum' },
      { label: 'Properties', icon: 'fa-info-circle', action: 'info' },
    ];

    for (const act of actions) {
      const item = document.createElement('div');
      item.style.padding = '6px 16px';
      item.style.cursor = 'pointer';
      item.style.fontSize = '13px';
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.gap = '8px';
      item.innerHTML = `<i class="fas ${act.icon}" style="width:16px;"></i> ${act.label}`;
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = 'rgba(0,240,255,0.1)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = '';
      });
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = 'none';
        // Emit action to parent
        this.onContextMenu(path, act.action);
      });
      menu.appendChild(item);
    }
  }

  // ---------------------------------------------------------------------------
  // Drag-drop setup (global)
  // ---------------------------------------------------------------------------
  _setupDragDrop() {
    // Nothing else needed; per-item events handle it.
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------
  refresh() {
    this.render(this.currentPath);
  }

  selectItem(path) {
    this.selectedPath = path;
    // Highlight the item
    const items = this.container.querySelectorAll('.vfs-item');
    for (const el of items) {
      if (el.dataset.path === path) {
        this._highlightItem(el);
        // Scroll to it
        el.scrollIntoView({ block: 'nearest' });
        break;
      }
    }
  }

  highlightResults(results) {
    // Clear previous highlights
    this.container.querySelectorAll('.vfs-item').forEach(el => {
      el.style.backgroundColor = '';
    });
    // Highlight matching items
    if (results.length) {
      results.forEach(file => {
        const items = this.container.querySelectorAll('.vfs-item');
        for (const el of items) {
          if (el.dataset.path === file.path) {
            el.style.backgroundColor = 'rgba(255,255,0,0.15)';
            break;
          }
        }
      });
    }
  }

  // Cleanup
  destroy() {
    this.container.innerHTML = '';
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
    if (this._scrollHandler) {
      this.container.removeEventListener('scroll', this._scrollHandler);
    }
  }

  _bindEvents() {
    // New folder button
    const newFolderBtn = document.getElementById('vfs-new-folder');
    if (newFolderBtn) {
      newFolderBtn.addEventListener('click', () => {
        const name = prompt('Enter folder name:');
        if (name && name.trim()) {
          this.onCreateFolder(name.trim());
        }
      });
    }
    // Refresh button
    const refreshBtn = document.getElementById('vfs-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refresh());
    }
  }
}