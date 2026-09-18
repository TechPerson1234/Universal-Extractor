export const PDFEditorPlugin = {
  type: 'PDF',
  name: 'PDF Editor',
  version: '2.0.0',

  async init(surface, tools, file) {
    if (typeof pdfjsLib === 'undefined') {
      surface.innerHTML = '<div style="padding:20px;color:#ff003c;font-family:monospace;">PDF.js not loaded</div>';
      return { destroy: () => {} };
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    const state = {
      pdf: null,
      currentPage: 1,
      totalPages: 0,
      scale: 1.5,
      rotation: 0,
      annotations: [],
      renderTask: null,
      mode: 'view',
      selectedAnnotation: null,
    };

    surface.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:#0a0a0a;overflow:hidden;">
        <div style="height:36px;background:#0f0f0f;border-bottom:1px solid #222;display:flex;align-items:center;padding:0 10px;gap:8px;flex-shrink:0;">
          <button id="pdf-prev" style="background:transparent;border:none;color:#ccc;cursor:pointer;padding:4px 8px;font-size:12px;"><i class="fas fa-chevron-left"></i></button>
          <input id="pdf-page-input" type="number" min="1" value="1" style="width:50px;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:2px 4px;border-radius:3px;font-size:11px;text-align:center;">
          <span id="pdf-page-total" style="font-size:11px;color:#666;">/ 0</span>
          <button id="pdf-next" style="background:transparent;border:none;color:#ccc;cursor:pointer;padding:4px 8px;font-size:12px;"><i class="fas fa-chevron-right"></i></button>
          <div style="width:1px;height:20px;background:#333;margin:0 4px;"></div>
          <button id="pdf-zoom-out" style="background:transparent;border:none;color:#ccc;cursor:pointer;padding:4px 8px;font-size:12px;"><i class="fas fa-search-minus"></i></button>
          <span id="pdf-zoom-label" style="font-size:11px;color:#666;font-family:monospace;min-width:40px;text-align:center;">150%</span>
          <button id="pdf-zoom-in" style="background:transparent;border:none;color:#ccc;cursor:pointer;padding:4px 8px;font-size:12px;"><i class="fas fa-search-plus"></i></button>
          <div style="width:1px;height:20px;background:#333;margin:0 4px;"></div>
          <button id="pdf-rotate-l" style="background:transparent;border:none;color:#ccc;cursor:pointer;padding:4px 8px;font-size:12px;"><i class="fas fa-undo"></i></button>
          <button id="pdf-rotate-r" style="background:transparent;border:none;color:#ccc;cursor:pointer;padding:4px 8px;font-size:12px;"><i class="fas fa-redo"></i></button>
          <div style="flex:1;"></div>
          <button id="pdf-fit-width" style="background:transparent;border:none;color:#ccc;cursor:pointer;padding:4px 8px;font-size:11px;">Fit Width</button>
        </div>
        <div style="flex:1;display:flex;overflow:hidden;position:relative;">
          <div id="pdf-container" style="flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:20px;background:#0a0a0a;position:relative;">
            <canvas id="pdf-canvas" style="box-shadow:0 4px 24px rgba(0,0,0,0.8);"></canvas>
            <div id="pdf-annotation-layer" style="position:absolute;pointer-events:none;"></div>
          </div>
          <div id="pdf-thumbs" style="width:120px;background:#0f0f0f;border-left:1px solid #222;overflow-y:auto;padding:8px;display:none;"></div>
        </div>
      </div>
    `;

    tools.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button id="pdf-save" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;font-size:12px;">
          <i class="fas fa-save"></i> Save Annotations
        </button>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Annotate</label>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;">
            <button data-mode="view" class="pdf-mode active" style="padding:6px;background:rgba(0,240,255,0.15);color:var(--nexus-cyan);border:1px solid var(--nexus-cyan);border-radius:3px;font-size:10px;cursor:pointer;">View</button>
            <button data-mode="text" class="pdf-mode" style="padding:6px;background:transparent;color:#888;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Text</button>
            <button data-mode="highlight" class="pdf-mode" style="padding:6px;background:transparent;color:#888;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Highlight</button>
            <button data-mode="draw" class="pdf-mode" style="padding:6px;background:transparent;color:#888;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Draw</button>
            <button data-mode="rect" class="pdf-mode" style="padding:6px;background:transparent;color:#888;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Rect</button>
            <button data-mode="erase" class="pdf-mode" style="padding:6px;background:transparent;color:#888;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Erase</button>
          </div>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Color</label>
          <input id="pdf-color" type="color" value="#ffcc00" style="width:100%;height:32px;background:transparent;border:1px solid #333;border-radius:3px;cursor:pointer;">
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <button id="pdf-thumbs-toggle" style="width:100%;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">
            <i class="fas fa-th-list"></i> Toggle Thumbnails
          </button>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <button id="pdf-clear-ann" style="width:100%;padding:5px;background:transparent;color:#ff003c;border:1px solid #ff003c;border-radius:3px;font-size:11px;cursor:pointer;">
            <i class="fas fa-trash"></i> Clear Annotations
          </button>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Export</label>
          <button id="pdf-export-img" style="width:100%;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;margin-bottom:4px;">
            <i class="fas fa-image"></i> Export Page as PNG
          </button>
          <button id="pdf-extract-text" style="width:100%;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">
            <i class="fas fa-file-alt"></i> Extract Text
          </button>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <div id="pdf-meta" style="font-size:10px;color:#666;font-family:monospace;line-height:1.6;"></div>
        </div>
      </div>
    `;

    const container = document.getElementById('pdf-container');
    const canvas = document.getElementById('pdf-canvas');
    const annLayer = document.getElementById('pdf-annotation-layer');
    const ctx = canvas.getContext('2d');

    const url = URL.createObjectURL(file.blob);

    try {
      const loadingTask = pdfjsLib.getDocument({ url, cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/cmaps/', cMapPacked: true });
      state.pdf = await loadingTask.promise;
      state.totalPages = state.pdf.numPages;
      document.getElementById('pdf-page-total').textContent = '/ ' + state.totalPages;
      document.getElementById('pdf-page-input').max = state.totalPages;

      const meta = await state.pdf.getMetadata();
      const m = meta.info || {};
      document.getElementById('pdf-meta').innerHTML = `
        Pages: ${state.totalPages}<br>
        Title: ${m.Title || '—'}<br>
        Author: ${m.Author || '—'}<br>
        Subject: ${m.Subject || '—'}
      `;

      await renderPage(state.currentPage);
      buildThumbnails();
    } catch (e) {
      surface.innerHTML = `<div style="padding:20px;color:#ff003c;font-family:monospace;">PDF load failed: ${e.message}</div>`;
      return { destroy: () => URL.revokeObjectURL(url) };
    }

    async function renderPage(pageNum) {
      if (state.renderTask) {
        try { state.renderTask.cancel(); } catch {}
      }
      const page = await state.pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: state.scale, rotation: state.rotation });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      const renderCtx = canvas.getContext('2d');
      renderCtx.scale(dpr, dpr);
      const task = page.render({ canvasContext: renderCtx, viewport });
      state.renderTask = task;
      try {
        await task.promise;
      } catch (e) {
        if (e.name !== 'RenderingCancelledException') console.error(e);
      }
      state.renderTask = null;

      annLayer.style.left = canvas.offsetLeft + 'px';
      annLayer.style.top = canvas.offsetTop + 'px';
      annLayer.style.width = viewport.width + 'px';
      annLayer.style.height = viewport.height + 'px';
      annLayer.innerHTML = '';
      renderAnnotations(pageNum);
    }

    function renderAnnotations(pageNum) {
      const pageAnns = state.annotations.filter(a => a.page === pageNum);
      for (const a of pageAnns) {
        const el = document.createElement('div');
        el.dataset.id = a.id;
        el.style.cssText = `position:absolute;pointer-events:auto;cursor:pointer;`;
        if (a.type === 'highlight') {
          el.style.left = a.x + 'px';
          el.style.top = a.y + 'px';
          el.style.width = a.w + 'px';
          el.style.height = a.h + 'px';
          el.style.background = a.color + '66';
          el.style.border = `1px solid ${a.color}`;
        } else if (a.type === 'rect') {
          el.style.left = a.x + 'px';
          el.style.top = a.y + 'px';
          el.style.width = a.w + 'px';
          el.style.height = a.h + 'px';
          el.style.border = `2px solid ${a.color}`;
        } else if (a.type === 'text') {
          el.style.left = a.x + 'px';
          el.style.top = a.y + 'px';
          el.style.color = a.color;
          el.style.fontSize = (a.fontSize || 14) + 'px';
          el.style.fontWeight = 'bold';
          el.style.textShadow = '0 0 4px #000';
          el.textContent = a.text || 'Text';
        } else if (a.type === 'path') {
          el.style.left = '0';
          el.style.top = '0';
          el.style.width = '100%';
          el.style.height = '100%';
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.style.width = '100%';
          svg.style.height = '100%';
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', a.path);
          path.setAttribute('stroke', a.color);
          path.setAttribute('stroke-width', a.strokeWidth || 2);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke-linecap', 'round');
          svg.appendChild(path);
          el.appendChild(svg);
        }
        if (state.selectedAnnotation === a.id) {
          el.style.boxShadow = `0 0 0 2px var(--nexus-cyan)`;
        }
        annLayer.appendChild(el);
      }
    }

    let drawing = null;
    container.addEventListener('mousedown', (e) => {
      if (state.mode === 'view') return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const color = document.getElementById('pdf-color').value;

      if (state.mode === 'text') {
        const text = prompt('Enter text:');
        if (!text) return;
        state.annotations.push({
          id: 'ann_' + Date.now(),
          page: state.currentPage,
          type: 'text',
          x, y, text, color, fontSize: 16,
        });
        renderAnnotations(state.currentPage);
        return;
      }

      if (state.mode === 'highlight' || state.mode === 'rect') {
        drawing = { type: state.mode, startX: x, startY: y, color, page: state.currentPage };
      } else if (state.mode === 'draw') {
        drawing = { type: 'path', points: [[x, y]], color, page: state.currentPage, strokeWidth: 2 };
      } else if (state.mode === 'erase') {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const id = target?.dataset?.id;
        if (id) {
          state.annotations = state.annotations.filter(a => a.id !== id);
          renderAnnotations(state.currentPage);
        }
      }
    });

    container.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (drawing.type === 'path') {
        drawing.points.push([x, y]);
        if (state.selectedAnnotation) {
          const existing = state.annotations.find(a => a.id === state.selectedAnnotation);
          if (existing && existing.type === 'path') {
            existing.path = drawing.points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
            renderAnnotations(state.currentPage);
          }
        }
      }
    });

    container.addEventListener('mouseup', (e) => {
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (drawing.type === 'highlight' || drawing.type === 'rect') {
        const w = Math.abs(x - drawing.startX);
        const h = Math.abs(y - drawing.startY);
        const ax = Math.min(x, drawing.startX);
        const ay = Math.min(y, drawing.startY);
        if (w > 5 && h > 5) {
          state.annotations.push({
            id: 'ann_' + Date.now(),
            page: drawing.page,
            type: drawing.type,
            x: ax, y: ay, w, h,
            color: drawing.color,
          });
        }
      } else if (drawing.type === 'path' && drawing.points.length > 1) {
        const path = drawing.points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
        state.annotations.push({
          id: 'ann_' + Date.now(),
          page: drawing.page,
          type: 'path',
          path,
          color: drawing.color,
          strokeWidth: 2,
        });
      }
      drawing = null;
      renderAnnotations(state.currentPage);
    });

    const updateZoomLabel = () => {
      document.getElementById('pdf-zoom-label').textContent = Math.round(state.scale * 100) + '%';
    };
    updateZoomLabel();

    document.getElementById('pdf-prev').addEventListener('click', () => {
      if (state.currentPage > 1) {
        state.currentPage--;
        document.getElementById('pdf-page-input').value = state.currentPage;
        renderPage(state.currentPage);
      }
    });

    document.getElementById('pdf-next').addEventListener('click', () => {
      if (state.currentPage < state.totalPages) {
        state.currentPage++;
        document.getElementById('pdf-page-input').value = state.currentPage;
        renderPage(state.currentPage);
      }
    });

    document.getElementById('pdf-page-input').addEventListener('change', (e) => {
      const p = Math.max(1, Math.min(state.totalPages, parseInt(e.target.value) || 1));
      state.currentPage = p;
      e.target.value = p;
      renderPage(p);
    });

    document.getElementById('pdf-zoom-in').addEventListener('click', () => {
      state.scale = Math.min(5, state.scale + 0.25);
      updateZoomLabel();
      renderPage(state.currentPage);
    });

    document.getElementById('pdf-zoom-out').addEventListener('click', () => {
      state.scale = Math.max(0.25, state.scale - 0.25);
      updateZoomLabel();
      renderPage(state.currentPage);
    });

    document.getElementById('pdf-rotate-l').addEventListener('click', () => {
      state.rotation = (state.rotation - 90) % 360;
      renderPage(state.currentPage);
    });

    document.getElementById('pdf-rotate-r').addEventListener('click', () => {
      state.rotation = (state.rotation + 90) % 360;
      renderPage(state.currentPage);
    });

    document.getElementById('pdf-fit-width').addEventListener('click', async () => {
      const page = await state.pdf.getPage(state.currentPage);
      const vp = page.getViewport({ scale: 1 });
      const containerW = container.clientWidth - 40;
      state.scale = containerW / vp.width;
      updateZoomLabel();
      renderPage(state.currentPage);
    });

    document.querySelectorAll('.pdf-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        state.mode = btn.dataset.mode;
        document.querySelectorAll('.pdf-mode').forEach(b => {
          const active = b.dataset.mode === state.mode;
          b.style.background = active ? 'rgba(0,240,255,0.15)' : 'transparent';
          b.style.borderColor = active ? 'var(--nexus-cyan)' : '#333';
          b.style.color = active ? 'var(--nexus-cyan)' : '#888';
        });
        container.style.cursor = state.mode === 'view' ? 'default' : state.mode === 'erase' ? 'not-allowed' : 'crosshair';
      });
    });

    document.getElementById('pdf-thumbs-toggle').addEventListener('click', () => {
      const t = document.getElementById('pdf-thumbs');
      t.style.display = t.style.display === 'none' ? 'block' : 'none';
    });

    async function buildThumbnails() {
      const thumbs = document.getElementById('pdf-thumbs');
      thumbs.innerHTML = '';
      for (let i = 1; i <= state.totalPages; i++) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom:8px;cursor:pointer;border:2px solid transparent;border-radius:4px;padding:2px;';
        const c = document.createElement('canvas');
        c.style.cssText = 'width:100%;height:auto;display:block;background:#fff;border-radius:2px;';
        const num = document.createElement('div');
        num.textContent = i;
        num.style.cssText = 'text-align:center;font-size:10px;color:#666;margin-top:2px;';
        wrap.appendChild(c);
        wrap.appendChild(num);
        wrap.addEventListener('click', () => {
          state.currentPage = i;
          document.getElementById('pdf-page-input').value = i;
          renderPage(i);
        });
        thumbs.appendChild(wrap);

        try {
          const page = await state.pdf.getPage(i);
          const vp = page.getViewport({ scale: 0.2 });
          c.width = vp.width;
          c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        } catch {}
      }
    }

    document.getElementById('pdf-save').addEventListener('click', () => {
      const app = window.__NEXUS_DI?.app;
      app?.notifications?.show(`Saved ${state.annotations.length} annotation(s) to VFS`, 'success');
      const data = JSON.stringify(state.annotations);
      const blob = new Blob([data], { type: 'application/json' });
      const path = file.path.replace(/\.pdf$/i, '') + '.annotations.json';
      app?.vfs?.addFile(path, blob, 'TEXT');
    });

    document.getElementById('pdf-clear-ann').addEventListener('click', () => {
      if (!confirm('Clear all annotations?')) return;
      state.annotations = [];
      renderAnnotations(state.currentPage);
    });

    document.getElementById('pdf-export-img').addEventListener('click', async () => {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${file.name.replace(/\.pdf$/i, '')}_page_${state.currentPage}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });

    document.getElementById('pdf-extract-text').addEventListener('click', async () => {
      const app = window.__NEXUS_DI?.app;
      let fullText = '';
      for (let i = 1; i <= state.totalPages; i++) {
        const page = await state.pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += `\n\n--- Page ${i} ---\n\n${pageText}`;
      }
      const blob = new Blob([fullText], { type: 'text/plain' });
      const path = file.path.replace(/\.pdf$/i, '') + '.txt';
      await app?.vfs?.addFile(path, blob, 'TEXT');
      app?.notifications?.show('Text extracted', 'success');
    });

    const resizeHandler = () => renderAnnotations(state.currentPage);
    window.addEventListener('resize', resizeHandler);

    return {
      getAnnotations: () => [...state.annotations],
      destroy: () => {
        window.removeEventListener('resize', resizeHandler);
        URL.revokeObjectURL(url);
        if (state.renderTask) {
          try { state.renderTask.cancel(); } catch {}
        }
      },
    };
  },
};
