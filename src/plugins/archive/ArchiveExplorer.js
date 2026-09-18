export const ArchiveExplorerPlugin = {
  type: 'ARCHIVE',
  name: 'Archive Explorer',
  version: '2.0.0',

  async init(surface, tools, file) {
    const zipLib = window.zip;
    if (!zipLib) {
      surface.innerHTML = '<div style="padding:20px;color:#ff003c;font-family:monospace;">zip.js not loaded</div>';
      return { destroy: () => {} };
    }

    const state = {
      reader: null,
      entries: [],
      selectedEntries: new Set(),
      currentPath: '/',
      extractTarget: '/',
    };

    surface.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:#0a0a0a;overflow:hidden;">
        <div style="height:36px;background:#0f0f0f;border-bottom:1px solid #222;display:flex;align-items:center;padding:0 10px;gap:8px;flex-shrink:0;">
          <i class="fas fa-file-archive" style="color:#ffcc00;font-size:14px;"></i>
          <span style="font-size:12px;color:#ccc;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${file.name}</span>
          <div style="flex:1;"></div>
          <input id="ar-search" type="text" placeholder="Filter..." style="width:180px;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:3px 8px;border-radius:3px;font-size:11px;">
          <span id="ar-count" style="font-size:11px;color:#666;font-family:monospace;"></span>
        </div>
        <div id="ar-list" style="flex:1;overflow-y:auto;padding:8px;font-family:monospace;font-size:12px;"></div>
        <div style="height:44px;background:#0f0f0f;border-top:1px solid #222;display:flex;align-items:center;padding:0 10px;gap:8px;flex-shrink:0;">
          <button id="ar-select-all" style="padding:5px 10px;background:transparent;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">Select All</button>
          <button id="ar-select-none" style="padding:5px 10px;background:transparent;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">Clear</button>
          <div style="flex:1;"></div>
          <button id="ar-extract-sel" style="padding:6px 14px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">
            <i class="fas fa-file-export"></i> Extract Selected
          </button>
          <button id="ar-extract-all" style="padding:6px 14px;background:var(--nexus-cyan);color:#000;border:none;border-radius:3px;font-size:11px;font-weight:bold;cursor:pointer;">
            <i class="fas fa-folder-open"></i> Extract All
          </button>
        </div>
      </div>
    `;

    tools.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="border-bottom:1px solid #333;padding-bottom:8px;">
          <div id="ar-meta" style="font-size:10px;color:#666;font-family:monospace;line-height:1.7;">Loading...</div>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Extract To</label>
          <select id="ar-target" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;border-radius:3px;font-size:11px;">
            <option value="/">Root (/)</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Password (if needed)</label>
          <input id="ar-password" type="password" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;border-radius:3px;font-size:11px;">
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <div id="ar-progress-wrap" style="display:none;">
            <div style="height:4px;background:#1a1a1a;border-radius:2px;overflow:hidden;margin-bottom:6px;">
              <div id="ar-progress-bar" style="height:100%;width:0%;background:var(--nexus-cyan);transition:width 0.15s;"></div>
            </div>
            <div id="ar-progress-text" style="font-size:10px;color:#666;font-family:monospace;text-align:center;"></div>
          </div>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <button id="ar-export-json" style="width:100%;padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">
            <i class="fas fa-file-code"></i> Export File List (JSON)
          </button>
        </div>
      </div>
    `;

    const listEl = document.getElementById('ar-list');

    const formatBytes = (b) => {
      if (!b) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(b) / Math.log(k));
      return (b / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
    };

    const updateMeta = () => {
      const totalSize = state.entries.reduce((s, e) => s + (e.uncompressedSize || 0), 0);
      const totalCompressed = state.entries.reduce((s, e) => s + (e.compressedSize || 0), 0);
      const ratio = totalSize > 0 ? ((1 - totalCompressed / totalSize) * 100).toFixed(1) : 0;
      const files = state.entries.filter(e => !e.directory).length;
      const dirs = state.entries.length - files;
      document.getElementById('ar-meta').innerHTML = `
        Files: ${files}<br>
        Folders: ${dirs}<br>
        Total: ${formatBytes(totalSize)}<br>
        Compressed: ${formatBytes(totalCompressed)}<br>
        Ratio: ${ratio}%<br>
        Entries: ${state.entries.length}
      `;
      document.getElementById('ar-count').textContent = `${state.entries.length} entries`;
    };

    const renderEntries = (filter = '') => {
      listEl.innerHTML = '';
      const filtered = filter
        ? state.entries.filter(e => e.filename.toLowerCase().includes(filter.toLowerCase()))
        : state.entries;

      const groups = new Map();
      for (const entry of filtered) {
        const dir = entry.filename.includes('/')
          ? entry.filename.substring(0, entry.filename.lastIndexOf('/')) || '/'
          : '/';
        if (!groups.has(dir)) groups.set(dir, []);
        groups.get(dir).push(entry);
      }

      for (const [dir, entries] of groups) {
        if (dir !== '/') {
          const dirRow = document.createElement('div');
          dirRow.style.cssText = 'padding:4px 8px;color:#fbbf24;font-weight:bold;font-size:11px;margin-top:4px;';
          dirRow.innerHTML = `<i class="fas fa-folder"></i> ${dir}/`;
          listEl.appendChild(dirRow);
        }
        for (const entry of entries) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;padding:4px 8px 4px 20px;cursor:pointer;border-radius:3px;gap:8px;';
          row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.03)');
          row.addEventListener('mouseleave', () => row.style.background = '');

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = state.selectedEntries.has(entry.filename);
          cb.style.cssText = 'accent-color:var(--nexus-cyan);';
          cb.addEventListener('change', () => {
            if (cb.checked) state.selectedEntries.add(entry.filename);
            else state.selectedEntries.delete(entry.filename);
            updateMeta();
          });
          row.appendChild(cb);

          const icon = document.createElement('i');
          const name = entry.filename.split('/').pop();
          if (entry.directory) {
            icon.className = 'fas fa-folder';
            icon.style.color = '#fbbf24';
          } else {
            const ext = name.split('.').pop().toLowerCase();
            if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) icon.className = 'fas fa-image';
            else if (['mp4', 'webm', 'mov'].includes(ext)) icon.className = 'fas fa-film';
            else if (['mp3', 'wav', 'ogg'].includes(ext)) icon.className = 'fas fa-wave-square';
            else if (['txt', 'json', 'js', 'html', 'css', 'md'].includes(ext)) icon.className = 'fas fa-code';
            else if (['pdf'].includes(ext)) icon.className = 'fas fa-file-pdf';
            else icon.className = 'fas fa-file';
            icon.style.color = '#666';
          }
          icon.style.cssText = `width:14px;text-align:center;color:${icon.style.color};font-size:11px;`;
          row.appendChild(icon);

          const nameEl = document.createElement('span');
          nameEl.textContent = name;
          nameEl.style.cssText = 'flex:1;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;';
          row.appendChild(nameEl);

          if (!entry.directory) {
            const sizeEl = document.createElement('span');
            sizeEl.textContent = formatBytes(entry.uncompressedSize);
            sizeEl.style.cssText = 'color:#555;font-size:10px;font-family:monospace;';
            row.appendChild(sizeEl);
          }

          listEl.appendChild(row);
        }
      }

      document.getElementById('ar-count').textContent = `${filtered.length} entries`;
    };

    try {
      state.reader = new zipLib.ZipReader(new zipLib.BlobReader(file.blob), {
        password: undefined,
      });
      state.entries = await state.reader.getEntries();
      state.entries.sort((a, b) => {
        if (a.directory && !b.directory) return -1;
        if (!a.directory && b.directory) return 1;
        return a.filename.localeCompare(b.filename);
      });
      updateMeta();
      renderEntries();

      const app = window.__NEXUS_DI?.app;
      if (app?.vfs) {
        const folders = app.vfs.listAllFolders();
        const target = document.getElementById('ar-target');
        target.innerHTML = '';
        for (const f of ['/'].concat(folders)) {
          const opt = document.createElement('option');
          opt.value = f;
          opt.textContent = f;
          target.appendChild(opt);
        }
      }
    } catch (e) {
      surface.innerHTML = `<div style="padding:20px;color:#ff003c;font-family:monospace;">Failed to read archive: ${e.message}</div>`;
      return { destroy: () => {} };
    }

    const getPassword = () => document.getElementById('ar-password').value || undefined;

    const extractEntries = async (entriesToExtract, targetPath) => {
      const app = window.__NEXUS_DI?.app;
      if (!app?.vfs) return;

      const progressWrap = document.getElementById('ar-progress-wrap');
      const progressBar = document.getElementById('ar-progress-bar');
      const progressText = document.getElementById('ar-progress-text');
      progressWrap.style.display = 'block';

      let completed = 0;
      const total = entriesToExtract.length;
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const basePath = targetPath === '/' ? '/' + baseName : targetPath + '/' + baseName;

      await app.vfs.createFolder(basePath);

      for (const entry of entriesToExtract) {
        try {
          if (entry.directory) {
            const dirPath = basePath + '/' + entry.filename.replace(/\/$/, '');
            await app.vfs.createFolder(dirPath);
          } else {
            const blob = await entry.getData(
              new zipLib.BlobWriter(),
              { password: getPassword() }
            );
            const filePath = basePath + '/' + entry.filename;
            const fileName = entry.filename.split('/').pop();
            const ext = fileName.split('.').pop().toLowerCase();
            let type = 'BINARY';
            if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) type = 'IMAGE';
            else if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) type = 'VIDEO';
            else if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) type = 'AUDIO';
            else if (['txt', 'json', 'js', 'html', 'css', 'md', 'py', 'rs', 'go', 'java', 'c', 'cpp'].includes(ext)) type = 'TEXT';
            else if (ext === 'pdf') type = 'PDF';
            else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) type = 'ARCHIVE';
            else if (['obj', 'stl', 'gltf', 'glb', 'fbx'].includes(ext)) type = 'MODEL';
            await app.vfs.addFile(filePath, blob, type);
          }
        } catch (err) {
          console.error('Extract failed:', entry.filename, err);
        }
        completed++;
        progressBar.style.width = (completed / total * 100) + '%';
        progressText.textContent = `${completed} / ${total} — ${entry.filename}`;
      }

      app.eventBus.emit('vfs:changed');
      app.notifications?.show(`Extracted ${completed} entries`, 'success');
      setTimeout(() => { progressWrap.style.display = 'none'; }, 2000);
    };

    document.getElementById('ar-search').addEventListener('input', (e) => {
      renderEntries(e.target.value);
    });

    document.getElementById('ar-select-all').addEventListener('click', () => {
      for (const e of state.entries) state.selectedEntries.add(e.filename);
      renderEntries(document.getElementById('ar-search').value);
      updateMeta();
    });

    document.getElementById('ar-select-none').addEventListener('click', () => {
      state.selectedEntries.clear();
      renderEntries(document.getElementById('ar-search').value);
      updateMeta();
    });

    document.getElementById('ar-extract-sel').addEventListener('click', async () => {
      if (state.selectedEntries.size === 0) {
        window.__NEXUS_DI?.app?.notifications?.show('No entries selected', 'warning');
        return;
      }
      const targetPath = document.getElementById('ar-target').value || '/';
      const toExtract = state.entries.filter(e => state.selectedEntries.has(e.filename));
      await extractEntries(toExtract, targetPath);
    });

    document.getElementById('ar-extract-all').addEventListener('click', async () => {
      const targetPath = document.getElementById('ar-target').value || '/';
      await extractEntries(state.entries, targetPath);
    });

    document.getElementById('ar-export-json').addEventListener('click', () => {
      const data = state.entries.map(e => ({
        filename: e.filename,
        directory: !!e.directory,
        compressedSize: e.compressedSize,
        uncompressedSize: e.uncompressedSize,
        lastModDate: e.lastModDate ? e.lastModDate.toISOString() : null,
      }));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name.replace(/\.[^.]+$/, '') + '_contents.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });

    return {
      getEntries: () => [...state.entries],
      destroy: async () => {
        if (state.reader) {
          try { await state.reader.close(); } catch {}
        }
      },
    };
  },
};
