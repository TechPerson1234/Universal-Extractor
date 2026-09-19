const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024;
const CHUNK_PREVIEW = 512 * 1024;

export const TextEditorPlugin = {
  type: 'TEXT',
  name: 'Text Editor',
  version: '2.0.1',

  async init(surface, tools, file) {
    const state = {
      content: '',
      originalContent: '',
      dirty: false,
      wrapped: false,
      showLines: true,
      largeFile: file.size > LARGE_FILE_THRESHOLD,
      loadedBytes: 0,
      totalBytes: file.size,
      encoding: 'utf-8',
      history: [],
      historyIndex: -1,
      destroyed: false,
    };

    surface.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:#0a0a0a;overflow:hidden;">
        <div style="height:32px;background:#0f0f0f;border-bottom:1px solid #222;display:flex;align-items:center;padding:0 10px;gap:6px;flex-shrink:0;">
          <input id="txt-search" type="text" placeholder="Find..." style="flex:1;max-width:280px;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:3px 8px;border-radius:3px;font-size:11px;font-family:monospace;">
          <button id="txt-find" style="background:#1a1a1a;color:#ccc;border:1px solid #333;padding:3px 10px;border-radius:3px;font-size:11px;cursor:pointer;">Find</button>
          <button id="txt-find-prev" style="background:#1a1a1a;color:#ccc;border:1px solid #333;padding:3px 8px;border-radius:3px;font-size:11px;cursor:pointer;">↑</button>
          <button id="txt-find-next" style="background:#1a1a1a;color:#ccc;border:1px solid #333;padding:3px 8px;border-radius:3px;font-size:11px;cursor:pointer;">↓</button>
          <input id="txt-replace" type="text" placeholder="Replace..." style="width:180px;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:3px 8px;border-radius:3px;font-size:11px;font-family:monospace;">
          <button id="txt-replace-one" style="background:#1a1a1a;color:#ccc;border:1px solid #333;padding:3px 10px;border-radius:3px;font-size:11px;cursor:pointer;">Replace</button>
          <button id="txt-replace-all" style="background:#1a1a1a;color:#ccc;border:1px solid #333;padding:3px 10px;border-radius:3px;font-size:11px;cursor:pointer;">All</button>
          <div style="flex:1;"></div>
          <span id="txt-info" style="font-size:10px;color:#666;font-family:monospace;"></span>
        </div>
        <div style="flex:1;position:relative;display:flex;overflow:hidden;">
          <div id="txt-lines" style="width:50px;background:#050505;border-right:1px solid #1a1a1a;overflow:hidden;font-family:monospace;font-size:13px;line-height:1.5;padding:12px 4px;color:#444;text-align:right;user-select:none;flex-shrink:0;"></div>
          <textarea id="txt-editor" style="flex:1;background:#0a0a0a;color:#ccc;font-family:monospace;font-size:13px;line-height:1.5;padding:12px;border:none;outline:none;resize:none;white-space:pre;overflow:auto;tab-size:2;"></textarea>
          <div id="txt-large-overlay" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.7);align-items:center;justify-content:center;flex-direction:column;gap:12px;color:#ccc;font-family:monospace;font-size:12px;"></div>
        </div>
      </div>
    `;

    tools.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button id="txt-save" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;font-size:12px;">
          <i class="fas fa-save"></i> Save
        </button>
        <button id="txt-save-as" style="background:#222;color:#ccc;border:1px solid #555;padding:6px;border-radius:3px;cursor:pointer;font-size:12px;">
          <i class="fas fa-download"></i> Save As
        </button>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Format</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <button id="txt-format-json" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">JSON</button>
            <button id="txt-minify-json" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Minify</button>
            <button id="txt-trim" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Trim</button>
            <button id="txt-dedupe" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Dedupe</button>
          </div>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Case</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <button id="txt-upper" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">UPPER</button>
            <button id="txt-lower" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">lower</button>
          </div>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">View</label>
          <button id="txt-wrap" style="width:100%;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;margin-bottom:4px;">
            <i class="fas fa-wrap"></i> Toggle Wrap
          </button>
          <button id="txt-lines-toggle" style="width:100%;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">
            <i class="fas fa-list-ol"></i> Toggle Line Numbers
          </button>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <div id="txt-stats" style="font-size:10px;color:#666;font-family:monospace;line-height:1.7;"></div>
        </div>
      </div>
    `;

    const editor = document.getElementById('txt-editor');
    const linesEl = document.getElementById('txt-lines');
    const infoEl = document.getElementById('txt-info');
    const statsEl = document.getElementById('txt-stats');
    const largeOverlay = document.getElementById('txt-large-overlay');

    const isAlive = () => !state.destroyed && editor && editor.isConnected;

    const updateLines = () => {
      if (!isAlive() || !linesEl) return;
      if (!state.showLines) {
        linesEl.style.display = 'none';
        return;
      }
      linesEl.style.display = 'block';
      const lineCount = editor.value.split('\n').length;
      const scrollTop = editor.scrollTop;
      const lineHeight = 19.5;
      const visibleLines = Math.ceil(editor.clientHeight / lineHeight) + 2;
      const startLine = Math.floor(scrollTop / lineHeight);
      let html = '';
      for (let i = 0; i < visibleLines; i++) {
        const lineNum = startLine + i + 1;
        if (lineNum > lineCount) break;
        html += lineNum + '\n';
      }
      linesEl.textContent = html;
      linesEl.scrollTop = scrollTop;
    };

    const updateStats = () => {
      if (!isAlive()) return;
      const content = editor.value;
      const lines = content.split('\n').length;
      const chars = content.length;
      const words = content.trim() ? content.trim().split(/\s+/).length : 0;
      if (infoEl && infoEl.isConnected) {
        infoEl.textContent = `${lines} lines · ${chars.toLocaleString()} chars`;
      }
      if (statsEl && statsEl.isConnected) {
        statsEl.innerHTML = `
          Lines: ${lines.toLocaleString()}<br>
          Chars: ${chars.toLocaleString()}<br>
          Words: ${words.toLocaleString()}<br>
          Bytes: ${new Blob([content]).size.toLocaleString()}<br>
          Encoding: ${state.encoding}<br>
          ${state.largeFile ? '<span style="color:#ffcc00;">Large file mode</span>' : ''}
        `;
      }
    };

    const loadContent = async () => {
      if (state.largeFile) {
        largeOverlay.style.display = 'flex';
        largeOverlay.innerHTML = `
          <div>Large file detected (${(file.size / 1024 / 1024).toFixed(1)} MB)</div>
          <div style="font-size:11px;color:#888;">Loading first ${(CHUNK_PREVIEW / 1024).toFixed(0)} KB for preview</div>
          <button id="txt-load-full" style="padding:8px 16px;background:var(--nexus-cyan);color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;">Load Entire File</button>
          <div style="font-size:10px;color:#666;">Warning: may freeze the browser for very large files</div>
        `;
        const partial = file.blob.slice(0, CHUNK_PREVIEW);
        const text = await partial.text();
        editor.value = text;
        state.loadedBytes = CHUNK_PREVIEW;
        largeOverlay.querySelector('#txt-load-full').addEventListener('click', async () => {
          largeOverlay.innerHTML = '<div>Loading...</div>';
          const full = await file.blob.text();
          editor.value = full;
          state.loadedBytes = file.size;
          largeOverlay.style.display = 'none';
          state.originalContent = full;
          updateLines();
          updateStats();
        });
      } else {
        const text = await file.blob.text();
        editor.value = text;
        state.originalContent = text;
        state.loadedBytes = file.size;
      }
      updateLines();
      updateStats();
    };

    editor.addEventListener('input', () => {
      if (!isAlive()) return;
      state.dirty = editor.value !== state.originalContent;
      updateLines();
      updateStats();
    });

    editor.addEventListener('scroll', () => {
      if (!isAlive() || !linesEl) return;
      linesEl.scrollTop = editor.scrollTop;
    });

    editor.addEventListener('keydown', (e) => {
      if (!isAlive()) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
        state.dirty = true;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
    });

    const saveFile = async () => {
      if (!isAlive()) return;
      const app = window.__NEXUS_DI?.app;
      if (!app?.vfs) return;
      const blob = new Blob([editor.value], { type: file.mimeType || 'text/plain' });
      await app.vfs.updateFile(file.path, blob);
      state.originalContent = editor.value;
      state.dirty = false;
      app.eventBus.emit('vfs:changed');
      app.notifications?.show('File saved', 'success');
    };

    const bindIfAlive = (id, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', handler);
    };

    bindIfAlive('txt-save', saveFile);

    bindIfAlive('txt-save-as', () => {
      if (!isAlive()) return;
      const blob = new Blob([editor.value], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });

    bindIfAlive('txt-format-json', () => {
      if (!isAlive()) return;
      try {
        const parsed = JSON.parse(editor.value);
        editor.value = JSON.stringify(parsed, null, 2);
        state.dirty = true;
        updateLines();
        updateStats();
      } catch (e) {
        window.__NEXUS_DI?.app?.notifications?.show('Invalid JSON: ' + e.message, 'error');
      }
    });

    bindIfAlive('txt-minify-json', () => {
      if (!isAlive()) return;
      try {
        const parsed = JSON.parse(editor.value);
        editor.value = JSON.stringify(parsed);
        state.dirty = true;
        updateLines();
        updateStats();
      } catch (e) {
        window.__NEXUS_DI?.app?.notifications?.show('Invalid JSON', 'error');
      }
    });

    bindIfAlive('txt-trim', () => {
      if (!isAlive()) return;
      editor.value = editor.value.split('\n').map(l => l.replace(/\s+$/, '')).join('\n');
      state.dirty = true;
      updateLines();
      updateStats();
    });

    bindIfAlive('txt-dedupe', () => {
      if (!isAlive()) return;
      const lines = editor.value.split('\n');
      const seen = new Set();
      const unique = lines.filter(l => {
        if (seen.has(l)) return false;
        seen.add(l);
        return true;
      });
      editor.value = unique.join('\n');
      state.dirty = true;
      updateLines();
      updateStats();
    });

    bindIfAlive('txt-upper', () => {
      if (!isAlive()) return;
      editor.value = editor.value.toUpperCase();
      state.dirty = true;
    });

    bindIfAlive('txt-lower', () => {
      if (!isAlive()) return;
      editor.value = editor.value.toLowerCase();
      state.dirty = true;
    });

    bindIfAlive('txt-wrap', () => {
      if (!isAlive()) return;
      state.wrapped = !state.wrapped;
      editor.style.whiteSpace = state.wrapped ? 'pre-wrap' : 'pre';
      const btn = document.getElementById('txt-wrap');
      if (btn) {
        btn.style.background = state.wrapped ? 'rgba(0,240,255,0.15)' : '#1a1a1a';
        btn.style.color = state.wrapped ? 'var(--nexus-cyan)' : '#ccc';
      }
    });

    bindIfAlive('txt-lines-toggle', () => {
      if (!isAlive()) return;
      state.showLines = !state.showLines;
      updateLines();
    });

    let searchMatches = [];
    let searchIndex = -1;

    const performFind = () => {
      if (!isAlive()) return;
      const searchInput = document.getElementById('txt-search');
      if (!searchInput) return;
      const query = searchInput.value;
      if (!query) return;
      const content = editor.value;
      searchMatches = [];
      let idx = 0;
      const lowerContent = content.toLowerCase();
      const lowerQuery = query.toLowerCase();
      while ((idx = lowerContent.indexOf(lowerQuery, idx)) !== -1) {
        searchMatches.push(idx);
        idx += query.length;
      }
      if (searchMatches.length > 0) {
        searchIndex = 0;
        highlightMatch();
        window.__NEXUS_DI?.app?.notifications?.show(`${searchMatches.length} matches`, 'info', 1500);
      } else {
        window.__NEXUS_DI?.app?.notifications?.show('No matches', 'warning', 1500);
      }
    };

    const highlightMatch = () => {
      if (!isAlive()) return;
      if (searchIndex < 0 || searchIndex >= searchMatches.length) return;
      const searchInput = document.getElementById('txt-search');
      if (!searchInput) return;
      const start = searchMatches[searchIndex];
      const len = searchInput.value.length;
      editor.focus();
      editor.setSelectionRange(start, start + len);
      const lineHeight = 19.5;
      const lineNum = editor.value.substring(0, start).split('\n').length - 1;
      editor.scrollTop = Math.max(0, lineNum * lineHeight - editor.clientHeight / 2);
      if (linesEl) linesEl.scrollTop = editor.scrollTop;
    };

    bindIfAlive('txt-find', performFind);

    const searchInputEl = document.getElementById('txt-search');
    if (searchInputEl) {
      searchInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); performFind(); }
      });
    }

    bindIfAlive('txt-find-next', () => {
      if (searchMatches.length === 0) return performFind();
      searchIndex = (searchIndex + 1) % searchMatches.length;
      highlightMatch();
    });

    bindIfAlive('txt-find-prev', () => {
      if (searchMatches.length === 0) return performFind();
      searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length;
      highlightMatch();
    });

    bindIfAlive('txt-replace-one', () => {
      if (!isAlive()) return;
      const searchInput = document.getElementById('txt-search');
      const replaceInput = document.getElementById('txt-replace');
      if (!searchInput || !replaceInput) return;
      const query = searchInput.value;
      const replace = replaceInput.value;
      if (!query) return;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      if (editor.value.substring(start, end).toLowerCase() === query.toLowerCase()) {
        editor.value = editor.value.substring(0, start) + replace + editor.value.substring(end);
        state.dirty = true;
        editor.selectionStart = editor.selectionEnd = start + replace.length;
      } else {
        performFind();
      }
      updateLines();
      updateStats();
    });

    bindIfAlive('txt-replace-all', () => {
      if (!isAlive()) return;
      const searchInput = document.getElementById('txt-search');
      const replaceInput = document.getElementById('txt-replace');
      if (!searchInput || !replaceInput) return;
      const query = searchInput.value;
      const replace = replaceInput.value;
      if (!query) return;
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const count = (editor.value.match(regex) || []).length;
      editor.value = editor.value.replace(regex, replace);
      state.dirty = true;
      updateLines();
      updateStats();
      window.__NEXUS_DI?.app?.notifications?.show(`Replaced ${count} occurrences`, 'success');
    });

    await loadContent();

    const app = window.__NEXUS_DI?.app;
    if (app) {
      editor.addEventListener('input', () => {
        if (!isAlive()) return;
        if (state.dirty) app.tabManager?.setDirty(file.path, true);
        else app.tabManager?.setDirty(file.path, false);
      });
    }

    return {
      getContent: () => editor.value,
      isDirty: () => state.dirty,
      save: saveFile,
      destroy: () => {
        state.destroyed = true;
      },
    };
  },
};
