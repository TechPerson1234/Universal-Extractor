const FILTERS = [
  { id: 'brightness', label: 'Brightness', type: 'range', min: -1, max: 1, step: 0.01, default: 0, group: 'Color' },
  { id: 'contrast', label: 'Contrast', type: 'range', min: -1, max: 1, step: 0.01, default: 0, group: 'Color' },
  { id: 'saturation', label: 'Saturation', type: 'range', min: -1, max: 1, step: 0.01, default: 0, group: 'Color' },
  { id: 'vibrance', label: 'Vibrance', type: 'range', min: -1, max: 1, step: 0.01, default: 0, group: 'Color' },
  { id: 'hueRotation', label: 'Hue', type: 'range', min: -180, max: 180, step: 1, default: 0, group: 'Color' },
  { id: 'gamma', label: 'Gamma', type: 'range', min: 0.1, max: 3, step: 0.05, default: 1, group: 'Color' },
  { id: 'blur', label: 'Blur', type: 'range', min: 0, max: 1, step: 0.01, default: 0, group: 'Blur' },
  { id: 'noise', label: 'Noise', type: 'range', min: 0, max: 500, step: 1, default: 0, group: 'Blur' },
  { id: 'pixelate', label: 'Pixelate', type: 'range', min: 1, max: 40, step: 1, default: 1, group: 'Blur' },
  { id: 'sepia', label: 'Sepia', type: 'toggle', default: false, group: 'Stylize' },
  { id: 'grayscale', label: 'Grayscale', type: 'toggle', default: false, group: 'Stylize' },
  { id: 'invert', label: 'Invert', type: 'toggle', default: false, group: 'Stylize' },
  { id: 'blackWhite', label: 'Black & White', type: 'toggle', default: false, group: 'Stylize' },
  { id: 'blendColor', label: 'Color Wash', type: 'color+range', default: '#00f0ff', defaultAmount: 0.3, group: 'Stylize' },
  { id: 'convolute', label: 'Sharpen', type: 'select', options: ['sharpen', 'emboss', 'edge', 'blur'], default: null, group: 'Convolute' },
];

const CONVOLUTION_KERNELS = {
  sharpen: [0, -1, 0, -1, 5, -1, 0, -1, 0],
  emboss: [1, 1, 1, 1, 0.7, -1, -1, -1, -1],
  edge: [0, 1, 0, 1, -4, 1, 0, 1, 0],
  blur: [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9],
};

export const ImageEditorPlugin = {
  type: 'IMAGE',
  name: 'Image Editor',
  version: '2.0.0',

  async init(surface, tools, file) {
    const self = this;
    const state = {
      canvas: null,
      originalImage: null,
      currentFilterState: {},
      layers: [],
      activeLayer: 0,
      drawingMode: false,
      brushColor: '#00f0ff',
      brushSize: 5,
      history: [],
      historyIndex: -1,
      objectUrl: null,
      cropRect: null,
    };

    surface.innerHTML = `
      <div style="display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;background:#0a0a0a;">
        <div id="ie-tabs" style="display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid #222;background:#0f0f0f;flex-shrink:0;overflow-x:auto;">
          <button data-tab="edit" class="ie-tab active" style="padding:4px 10px;background:rgba(0,240,255,0.15);border:1px solid var(--nexus-cyan);color:var(--nexus-cyan);border-radius:3px;font-size:11px;cursor:pointer;">Edit</button>
          <button data-tab="filters" class="ie-tab" style="padding:4px 10px;background:transparent;border:1px solid #333;color:#888;border-radius:3px;font-size:11px;cursor:pointer;">Filters</button>
          <button data-tab="layers" class="ie-tab" style="padding:4px 10px;background:transparent;border:1px solid #333;color:#888;border-radius:3px;font-size:11px;cursor:pointer;">Layers</button>
          <button data-tab="crop" class="ie-tab" style="padding:4px 10px;background:transparent;border:1px solid #333;color:#888;border-radius:3px;font-size:11px;cursor:pointer;">Crop</button>
          <button data-tab="draw" class="ie-tab" style="padding:4px 10px;background:transparent;border:1px solid #333;color:#888;border-radius:3px;font-size:11px;cursor:pointer;">Draw</button>
        </div>
        <div id="ie-panel-edit" class="ie-panel" style="flex:1;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at center,#1a1a1a,#000);">
          <canvas id="ie-canvas"></canvas>
        </div>
        <div id="ie-panel-filters" class="ie-panel" style="display:none;flex:1;overflow-y:auto;padding:12px;"></div>
        <div id="ie-panel-layers" class="ie-panel" style="display:none;flex:1;overflow-y:auto;padding:12px;"></div>
        <div id="ie-panel-crop" class="ie-panel" style="display:none;flex:1;overflow-y:auto;padding:12px;"></div>
        <div id="ie-panel-draw" class="ie-panel" style="display:none;flex:1;overflow-y:auto;padding:12px;"></div>
      </div>
    `;

    tools.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button id="ie-save" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;width:100%;font-size:12px;">
          <i class="fas fa-save"></i> Save to VFS
        </button>
        <button id="ie-export" style="background:#222;color:#ccc;border:1px solid #555;padding:6px;border-radius:3px;cursor:pointer;width:100%;font-size:12px;">
          <i class="fas fa-download"></i> Export Copy
        </button>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Format</label>
          <select id="ie-format" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;border-radius:3px;font-size:11px;">
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Quality</label>
          <input id="ie-quality" type="range" min="0.5" max="1" step="0.01" value="0.92" style="width:100%;accent-color:var(--nexus-cyan);">
          <span id="ie-quality-val" style="font-size:10px;color:#888;">92%</span>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">History</label>
          <div style="display:flex;gap:4px;">
            <button id="ie-undo" style="flex:1;background:#222;color:#ccc;border:1px solid #555;padding:5px;border-radius:3px;cursor:pointer;font-size:11px;">
              <i class="fas fa-undo"></i> Undo
            </button>
            <button id="ie-redo" style="flex:1;background:#222;color:#ccc;border:1px solid #555;padding:5px;border-radius:3px;cursor:pointer;font-size:11px;">
              <i class="fas fa-redo"></i> Redo
            </button>
          </div>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Info</label>
          <div id="ie-info" style="font-size:10px;color:#666;font-family:monospace;line-height:1.5;"></div>
        </div>
      </div>
    `;

    const url = URL.createObjectURL(file.blob);
    state.objectUrl = url;
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const initFabric = () => {
      const canvasEl = document.getElementById('ie-canvas');
      const c = new fabric.Canvas(canvasEl, {
        backgroundColor: '#0a0a0a',
        preserveObjectStacking: true,
        selection: true,
        enableRetinaScaling: true,
      });
      state.canvas = c;
      const wrapper = document.getElementById('ie-panel-edit');
      const maxW = wrapper.clientWidth - 40;
      const maxH = wrapper.clientHeight - 40;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const displayW = img.width * scale;
      const displayH = img.height * scale;
      c.setDimensions({ width: displayW, height: displayH });
      const fImg = new fabric.Image(img, {
        left: 0,
        top: 0,
        scaleX: scale,
        scaleY: scale,
        selectable: true,
        hasControls: true,
        hasBorders: true,
      });
      state.originalImage = fImg;
      c.add(fImg);
      c.setActiveObject(fImg);
      state.layers = [{ id: 'layer-1', name: 'Background', object: fImg, visible: true, opacity: 1, blendMode: 'source-over' }];
      c.renderAll();
      saveHistory();
      updateInfo();
      renderLayersPanel();
    };

    img.onload = () => {
      if (typeof fabric !== 'undefined') {
        initFabric();
      } else {
        fallbackCanvas(img);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      surface.innerHTML = '<div style="padding:20px;color:#ff003c;font-family:monospace;">Failed to load image</div>';
      URL.revokeObjectURL(url);
    };
    img.src = url;

    const fallbackCanvas = (img) => {
      const wrapper = document.getElementById('ie-panel-edit');
      wrapper.innerHTML = `<canvas id="ie-fallback" width="${img.width}" height="${img.height}" style="max-width:100%;max-height:100%;"></canvas>`;
      const c = document.getElementById('ie-fallback');
      c.getContext('2d').drawImage(img, 0, 0);
    };

    const updateInfo = () => {
      const info = document.getElementById('ie-info');
      if (!info || !img) return;
      info.innerHTML = `
        Size: ${img.width} × ${img.height}<br>
        Ratio: ${(img.width / img.height).toFixed(2)}<br>
        Zoom: ${(state.canvas ? state.canvas.getZoom() * 100 : 100).toFixed(0)}%
      `;
    };

    const saveHistory = () => {
      if (!state.canvas) return;
      const json = JSON.stringify(state.canvas.toJSON(['selectable', 'hasControls']));
      state.history = state.history.slice(0, state.historyIndex + 1);
      state.history.push(json);
      state.historyIndex = state.history.length - 1;
      if (state.history.length > 30) {
        state.history.shift();
        state.historyIndex--;
      }
    };

    const loadHistory = (json) => {
      if (!state.canvas) return;
      state.canvas.loadFromJSON(json, () => {
        state.canvas.renderAll();
        updateInfo();
      });
    };

    document.getElementById('ie-undo').addEventListener('click', () => {
      if (state.historyIndex > 0) {
        state.historyIndex--;
        loadHistory(state.history[state.historyIndex]);
      }
    });

    document.getElementById('ie-redo').addEventListener('click', () => {
      if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        loadHistory(state.history[state.historyIndex]);
      }
    });

    const tabs = surface.querySelectorAll('.ie-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        tabs.forEach(t => {
          t.classList.remove('active');
          t.style.background = 'transparent';
          t.style.borderColor = '#333';
          t.style.color = '#888';
        });
        tab.classList.add('active');
        tab.style.background = 'rgba(0,240,255,0.15)';
        tab.style.borderColor = 'var(--nexus-cyan)';
        tab.style.color = 'var(--nexus-cyan)';
        document.querySelectorAll('.ie-panel').forEach(p => p.style.display = 'none');
        const panel = document.getElementById(`ie-panel-${target}`);
        if (panel) panel.style.display = target === 'edit' ? 'flex' : 'block';
      });
    });

    const renderFiltersPanel = () => {
      const panel = document.getElementById('ie-panel-filters');
      panel.innerHTML = '';
      const groups = {};
      for (const f of FILTERS) {
        if (!groups[f.group]) groups[f.group] = [];
        groups[f.group].push(f);
      }
      for (const [groupName, filters] of Object.entries(groups)) {
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom:16px;border-bottom:1px solid #1a1a1a;padding-bottom:12px;';
        const h = document.createElement('div');
        h.textContent = groupName;
        h.style.cssText = 'font-size:10px;font-weight:bold;color:var(--nexus-cyan);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;';
        section.appendChild(h);

        for (const f of filters) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;';
          const label = document.createElement('span');
          label.textContent = f.label;
          label.style.cssText = 'font-size:12px;color:#ccc;flex:1;';
          row.appendChild(label);

          if (f.type === 'range') {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;';
            const inp = document.createElement('input');
            inp.type = 'range';
            inp.min = f.min;
            inp.max = f.max;
            inp.step = f.step;
            inp.value = state.currentFilterState[f.id] ?? f.default;
            inp.dataset.filter = f.id;
            inp.style.cssText = 'flex:1;accent-color:var(--nexus-cyan);';
            const val = document.createElement('span');
            val.textContent = inp.value;
            val.style.cssText = 'font-size:10px;color:#666;font-family:monospace;min-width:36px;text-align:right;';
            inp.addEventListener('input', () => {
              state.currentFilterState[f.id] = parseFloat(inp.value);
              val.textContent = inp.value;
              applyFilters();
            });
            wrap.appendChild(inp);
            wrap.appendChild(val);
            row.appendChild(wrap);
          } else if (f.type === 'toggle') {
            const btn = document.createElement('button');
            const on = state.currentFilterState[f.id] ?? f.default;
            btn.textContent = on ? 'ON' : 'OFF';
            btn.style.cssText = `padding:3px 10px;background:${on ? 'rgba(0,240,255,0.2)' : '#1a1a1a'};color:${on ? 'var(--nexus-cyan)' : '#666'};border:1px solid ${on ? 'var(--nexus-cyan)' : '#333'};border-radius:3px;font-size:10px;cursor:pointer;font-weight:bold;`;
            btn.addEventListener('click', () => {
              const nv = !(state.currentFilterState[f.id] ?? f.default);
              state.currentFilterState[f.id] = nv;
              btn.textContent = nv ? 'ON' : 'OFF';
              btn.style.background = nv ? 'rgba(0,240,255,0.2)' : '#1a1a1a';
              btn.style.color = nv ? 'var(--nexus-cyan)' : '#666';
              btn.style.borderColor = nv ? 'var(--nexus-cyan)' : '#333';
              applyFilters();
            });
            row.appendChild(btn);
          } else if (f.type === 'color+range') {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;gap:6px;align-items:center;';
            const color = document.createElement('input');
            color.type = 'color';
            color.value = state.currentFilterState[f.id + 'Color'] ?? f.default;
            color.dataset.filterColor = f.id;
            color.style.cssText = 'width:32px;height:24px;background:transparent;border:1px solid #333;border-radius:3px;cursor:pointer;';
            color.addEventListener('input', () => {
              state.currentFilterState[f.id + 'Color'] = color.value;
              applyFilters();
            });
            const amt = document.createElement('input');
            amt.type = 'range';
            amt.min = 0;
            amt.max = 1;
            amt.step = 0.01;
            amt.value = state.currentFilterState[f.id + 'Amount'] ?? f.defaultAmount;
            amt.dataset.filterAmount = f.id;
            amt.style.cssText = 'width:80px;accent-color:var(--nexus-cyan);';
            amt.addEventListener('input', () => {
              state.currentFilterState[f.id + 'Amount'] = parseFloat(amt.value);
              applyFilters();
            });
            wrap.appendChild(color);
            wrap.appendChild(amt);
            row.appendChild(wrap);
          } else if (f.type === 'select') {
            const sel = document.createElement('select');
            sel.style.cssText = 'background:#0a0a0a;color:#ccc;border:1px solid #333;padding:3px 6px;border-radius:3px;font-size:11px;';
            const none = document.createElement('option');
            none.value = '';
            none.textContent = 'None';
            sel.appendChild(none);
            for (const opt of f.options) {
              const o = document.createElement('option');
              o.value = opt;
              o.textContent = opt;
              if (state.currentFilterState[f.id] === opt) o.selected = true;
              sel.appendChild(o);
            }
            sel.addEventListener('change', () => {
              state.currentFilterState[f.id] = sel.value || null;
              applyFilters();
            });
            row.appendChild(sel);
          }

          section.appendChild(row);
        }
        panel.appendChild(section);
      }

      const resetBtn = document.createElement('button');
      resetBtn.textContent = 'Reset All Filters';
      resetBtn.style.cssText = 'width:100%;padding:8px;background:transparent;color:#ff003c;border:1px solid #ff003c;border-radius:4px;font-size:11px;cursor:pointer;margin-top:8px;';
      resetBtn.addEventListener('click', () => {
        state.currentFilterState = {};
        renderFiltersPanel();
        applyFilters();
      });
      panel.appendChild(resetBtn);
    };

    const applyFilters = () => {
      const c = state.canvas;
      const baseImg = state.originalImage;
      if (!c || !baseImg) return;

      const filters = [];
      const fs = state.currentFilterState;

      if (fs.brightness != null && fs.brightness !== 0) filters.push(new fabric.Image.filters.Brightness({ brightness: fs.brightness }));
      if (fs.contrast != null && fs.contrast !== 0) filters.push(new fabric.Image.filters.Contrast({ contrast: fs.contrast }));
      if (fs.saturation != null && fs.saturation !== 0) filters.push(new fabric.Image.filters.Saturation({ saturation: fs.saturation }));
      if (fs.vibrance != null && fs.vibrance !== 0) filters.push(new fabric.Image.filters.Vibrance({ vibrance: fs.vibrance }));
      if (fs.hueRotation != null && fs.hueRotation !== 0) filters.push(new fabric.Image.filters.HueRotation({ rotation: fs.hueRotation / 180 * Math.PI }));
      if (fs.gamma != null && fs.gamma !== 1) filters.push(new fabric.Image.filters.Gamma({ gamma: [fs.gamma, fs.gamma, fs.gamma] }));
      if (fs.blur != null && fs.blur > 0) filters.push(new fabric.Image.filters.Blur({ blur: fs.blur }));
      if (fs.noise != null && fs.noise > 0) filters.push(new fabric.Image.filters.Noise({ noise: fs.noise }));
      if (fs.pixelate != null && fs.pixelate > 1) filters.push(new fabric.Image.filters.Pixelate({ blocksize: fs.pixelate }));
      if (fs.sepia) filters.push(new fabric.Image.filters.Sepia());
      if (fs.grayscale) filters.push(new fabric.Image.filters.Grayscale());
      if (fs.invert) filters.push(new fabric.Image.filters.Invert());
      if (fs.blackWhite) filters.push(new fabric.Image.filters.BlackWhite());
      if (fs.blendColorColor && fs.blendColorAmount > 0) {
        filters.push(new fabric.Image.filters.BlendColor({
          color: fs.blendColorColor,
          mode: 'tint',
          alpha: fs.blendColorAmount,
        }));
      }
      if (fs.convolute && CONVOLUTION_KERNELS[fs.convolute]) {
        filters.push(new fabric.Image.filters.Convolute({ matrix: CONVOLUTION_KERNELS[fs.convolute] }));
      }

      baseImg.filters = filters;
      baseImg.applyFilters();
      c.renderAll();
      saveHistory();
    };

    const renderLayersPanel = () => {
      const panel = document.getElementById('ie-panel-layers');
      panel.innerHTML = '';
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
      header.innerHTML = '<span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Layers</span>';
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Add Layer';
      addBtn.style.cssText = 'background:rgba(0,240,255,0.15);color:var(--nexus-cyan);border:1px solid var(--nexus-cyan);padding:3px 8px;border-radius:3px;font-size:10px;cursor:pointer;';
      addBtn.addEventListener('click', () => {
        const c = state.canvas;
        if (!c) return;
        const rect = new fabric.Rect({
          left: 50, top: 50, width: 100, height: 100,
          fill: 'rgba(138,43,226,0.3)',
          stroke: '#8a2be2',
          strokeWidth: 2,
        });
        c.add(rect);
        state.layers.unshift({
          id: 'layer-' + Date.now(),
          name: 'Shape ' + state.layers.length,
          object: rect,
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
        });
        state.activeLayer = 0;
        renderLayersPanel();
        saveHistory();
      });
      header.appendChild(addBtn);
      panel.appendChild(header);

      state.layers.forEach((layer, i) => {
        const row = document.createElement('div');
        const isActive = i === state.activeLayer;
        row.style.cssText = `display:flex;align-items:center;gap:6px;padding:6px;background:${isActive ? 'rgba(0,240,255,0.08)' : '#0f0f0f'};border:1px solid ${isActive ? 'var(--nexus-cyan)' : '#1a1a1a'};border-radius:4px;margin-bottom:4px;cursor:pointer;`;
        row.addEventListener('click', () => {
          state.activeLayer = i;
          if (state.canvas && layer.object) state.canvas.setActiveObject(layer.object);
          renderLayersPanel();
        });

        const vis = document.createElement('button');
        vis.innerHTML = layer.visible ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
        vis.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:11px;padding:2px;';
        vis.addEventListener('click', (e) => {
          e.stopPropagation();
          layer.visible = !layer.visible;
          if (layer.object) layer.object.visible = layer.visible;
          if (state.canvas) state.canvas.renderAll();
          renderLayersPanel();
        });
        row.appendChild(vis);

        const name = document.createElement('span');
        name.textContent = layer.name;
        name.style.cssText = 'flex:1;font-size:11px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        row.appendChild(name);

        if (i !== state.layers.length - 1) {
          const del = document.createElement('button');
          del.innerHTML = '<i class="fas fa-trash"></i>';
          del.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:11px;padding:2px;';
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            if (layer.object && state.canvas) state.canvas.remove(layer.object);
            state.layers.splice(i, 1);
            if (state.activeLayer >= state.layers.length) state.activeLayer = state.layers.length - 1;
            renderLayersPanel();
            saveHistory();
          });
          row.appendChild(del);
        }

        panel.appendChild(row);
      });

      const blendSec = document.createElement('div');
      blendSec.style.cssText = 'margin-top:12px;border-top:1px solid #1a1a1a;padding-top:10px;';
      blendSec.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Blend Mode</div>';
      const blendSel = document.createElement('select');
      blendSel.style.cssText = 'width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;border-radius:3px;font-size:11px;';
      const blends = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion'];
      for (const b of blends) {
        const o = document.createElement('option');
        o.value = b;
        o.textContent = b;
        blendSel.appendChild(o);
      }
      blendSel.addEventListener('change', () => {
        const l = state.layers[state.activeLayer];
        if (l && l.object) {
          l.blendMode = blendSel.value;
          l.object.globalCompositeOperation = blendSel.value;
          if (state.canvas) state.canvas.renderAll();
        }
      });
      blendSec.appendChild(blendSel);
      panel.appendChild(blendSec);

      const opSec = document.createElement('div');
      opSec.style.cssText = 'margin-top:8px;';
      opSec.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Opacity</div>';
      const opInp = document.createElement('input');
      opInp.type = 'range';
      opInp.min = 0;
      opInp.max = 1;
      opInp.step = 0.01;
      opInp.value = state.layers[state.activeLayer]?.opacity ?? 1;
      opInp.style.cssText = 'width:100%;accent-color:var(--nexus-cyan);';
      opInp.addEventListener('input', () => {
        const l = state.layers[state.activeLayer];
        if (l && l.object) {
          l.opacity = parseFloat(opInp.value);
          l.object.set('opacity', l.opacity);
          if (state.canvas) state.canvas.renderAll();
        }
      });
      opSec.appendChild(opInp);
      panel.appendChild(opSec);
    };

    const renderCropPanel = () => {
      const panel = document.getElementById('ie-panel-crop');
      panel.innerHTML = `
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">Crop the current image. Choose a preset or enter custom dimensions.</div>
      `;
      const presets = [
        { label: 'Free', value: null },
        { label: '1:1', ratio: 1 },
        { label: '4:3', ratio: 4 / 3 },
        { label: '16:9', ratio: 16 / 9 },
        { label: '3:2', ratio: 3 / 2 },
        { label: '9:16', ratio: 9 / 16 },
      ];
      const presetGrid = document.createElement('div');
      presetGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px;';
      for (const p of presets) {
        const b = document.createElement('button');
        b.textContent = p.label;
        b.style.cssText = 'padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;';
        b.addEventListener('click', () => startCrop(p.ratio));
        presetGrid.appendChild(b);
      }
      panel.appendChild(presetGrid);

      const dims = document.createElement('div');
      dims.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;';
      const wInp = document.createElement('input');
      wInp.type = 'number';
      wInp.placeholder = 'Width';
      wInp.style.cssText = 'background:#0a0a0a;color:#ccc;border:1px solid #333;padding:6px;border-radius:3px;font-size:11px;';
      const hInp = document.createElement('input');
      hInp.type = 'number';
      hInp.placeholder = 'Height';
      hInp.style.cssText = wInp.style.cssText;
      dims.appendChild(wInp);
      dims.appendChild(hInp);
      panel.appendChild(dims);

      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Apply Crop';
      applyBtn.style.cssText = 'width:100%;padding:8px;background:var(--nexus-cyan);color:#000;border:none;border-radius:4px;font-weight:bold;cursor:pointer;font-size:12px;';
      applyBtn.addEventListener('click', () => {
        const w = parseInt(wInp.value);
        const h = parseInt(hInp.value);
        if (!w || !h) return;
        cropToSize(w, h);
      });
      panel.appendChild(applyBtn);

      const rotateSec = document.createElement('div');
      rotateSec.style.cssText = 'margin-top:16px;border-top:1px solid #1a1a1a;padding-top:12px;';
      rotateSec.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;">Rotate</div>';
      const rotBtns = document.createElement('div');
      rotBtns.style.cssText = 'display:flex;gap:6px;';
      const rotL = document.createElement('button');
      rotL.innerHTML = '<i class="fas fa-undo"></i> -90°';
      rotL.style.cssText = 'flex:1;padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;';
      rotL.addEventListener('click', () => rotateImage(-90));
      const rotR = document.createElement('button');
      rotR.innerHTML = '<i class="fas fa-redo"></i> +90°';
      rotR.style.cssText = rotL.style.cssText;
      rotR.addEventListener('click', () => rotateImage(90));
      rotBtns.appendChild(rotL);
      rotBtns.appendChild(rotR);
      rotateSec.appendChild(rotBtns);

      const flipBtns = document.createElement('div');
      flipBtns.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
      const flipH = document.createElement('button');
      flipH.innerHTML = '<i class="fas fa-arrows-alt-h"></i> Flip H';
      flipH.style.cssText = rotL.style.cssText;
      flipH.addEventListener('click', () => flipImage('x'));
      const flipV = document.createElement('button');
      flipV.innerHTML = '<i class="fas fa-arrows-alt-v"></i> Flip V';
      flipV.style.cssText = rotL.style.cssText;
      flipV.addEventListener('click', () => flipImage('y'));
      flipBtns.appendChild(flipH);
      flipBtns.appendChild(flipV);
      rotateSec.appendChild(flipBtns);
      panel.appendChild(rotateSec);

      const resizeSec = document.createElement('div');
      resizeSec.style.cssText = 'margin-top:16px;border-top:1px solid #1a1a1a;padding-top:12px;';
      resizeSec.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;">Resize</div>';
      const scaleInp = document.createElement('input');
      scaleInp.type = 'range';
      scaleInp.min = 10;
      scaleInp.max = 200;
      scaleInp.value = 100;
      scaleInp.style.cssText = 'width:100%;accent-color:var(--nexus-cyan);';
      const scaleLabel = document.createElement('span');
      scaleLabel.textContent = '100%';
      scaleLabel.style.cssText = 'font-size:10px;color:#888;display:block;text-align:center;margin-top:4px;';
      scaleInp.addEventListener('input', () => {
        scaleLabel.textContent = scaleInp.value + '%';
        const s = parseInt(scaleInp.value) / 100;
        if (state.canvas && state.originalImage) {
          const baseScale = state.originalImage.initialScale || 1;
          state.originalImage.set({ scaleX: baseScale * s, scaleY: baseScale * s });
          state.canvas.renderAll();
        }
      });
      resizeSec.appendChild(scaleInp);
      resizeSec.appendChild(scaleLabel);
      panel.appendChild(resizeSec);
    };

    const startCrop = (ratio) => {
      if (!state.canvas) return;
      const c = state.canvas;
      if (state.cropRect) c.remove(state.cropRect);
      const w = c.width * 0.6;
      const h = ratio ? w / ratio : c.height * 0.6;
      const rect = new fabric.Rect({
        left: (c.width - w) / 2,
        top: (c.height - h) / 2,
        width: w,
        height: h,
        fill: 'rgba(0,240,255,0.1)',
        stroke: 'var(--nexus-cyan)',
        strokeWidth: 2,
        strokeDashArray: [5, 3],
        cornerColor: '#00f0ff',
        cornerSize: 10,
        transparentCorners: false,
        hasRotatingPoint: false,
      });
      state.cropRect = rect;
      c.add(rect);
      c.setActiveObject(rect);
      c.renderAll();
    };

    const cropToSize = (w, h) => {
      if (!state.canvas || !state.originalImage) return;
      const c = state.canvas;
      const img = state.originalImage;
      const zoom = c.getZoom();
      const totalScale = img.scaleX * zoom;
      const sourceW = img.width;
      const sourceH = img.height;
      const newW = Math.min(w / totalScale, sourceW);
      const newH = Math.min(h / totalScale, sourceH);
      const clipPath = new fabric.Rect({
        left: img.left || 0,
        top: img.top || 0,
        width: newW * img.scaleX,
        height: newH * img.scaleY,
        absolutePositioned: true,
      });
      img.clipPath = clipPath;
      c.renderAll();
      saveHistory();
    };

    const rotateImage = (deg) => {
      if (!state.canvas || !state.originalImage) return;
      const img = state.originalImage;
      img.rotate((img.angle || 0) + deg);
      state.canvas.renderAll();
      saveHistory();
    };

    const flipImage = (axis) => {
      if (!state.canvas || !state.originalImage) return;
      const img = state.originalImage;
      if (axis === 'x') img.set('flipX', !img.flipX);
      else img.set('flipY', !img.flipY);
      state.canvas.renderAll();
      saveHistory();
    };

    const renderDrawPanel = () => {
      const panel = document.getElementById('ie-panel-draw');
      panel.innerHTML = `
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">Draw on the canvas. Toggle drawing mode and configure brush.</div>
      `;

      const drawBtn = document.createElement('button');
      drawBtn.textContent = state.drawingMode ? '✓ Drawing Mode ON' : 'Enable Drawing';
      drawBtn.style.cssText = `width:100%;padding:8px;background:${state.drawingMode ? 'rgba(0,240,255,0.2)' : '#1a1a1a'};color:${state.drawingMode ? 'var(--nexus-cyan)' : '#ccc'};border:1px solid ${state.drawingMode ? 'var(--nexus-cyan)' : '#333'};border-radius:4px;cursor:pointer;font-size:12px;margin-bottom:12px;`;
      drawBtn.addEventListener('click', () => {
        if (!state.canvas) return;
        state.drawingMode = !state.drawingMode;
        state.canvas.isDrawingMode = state.drawingMode;
        if (state.drawingMode && state.canvas.freeDrawingBrush) {
          state.canvas.freeDrawingBrush.color = state.brushColor;
          state.canvas.freeDrawingBrush.width = state.brushSize;
        }
        renderDrawPanel();
      });
      panel.appendChild(drawBtn);

      const colorSec = document.createElement('div');
      colorSec.style.cssText = 'margin-bottom:12px;';
      colorSec.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Brush Color</div>';
      const colorInp = document.createElement('input');
      colorInp.type = 'color';
      colorInp.value = state.brushColor;
      colorInp.style.cssText = 'width:100%;height:36px;background:transparent;border:1px solid #333;border-radius:4px;cursor:pointer;';
      colorInp.addEventListener('input', () => {
        state.brushColor = colorInp.value;
        if (state.canvas && state.canvas.freeDrawingBrush) {
          state.canvas.freeDrawingBrush.color = state.brushColor;
        }
      });
      colorSec.appendChild(colorInp);
      panel.appendChild(colorSec);

      const swatches = ['#00f0ff', '#8a2be2', '#ff003c', '#00ff41', '#ffcc00', '#ffffff', '#000000'];
      const swatchWrap = document.createElement('div');
      swatchWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;';
      for (const s of swatches) {
        const sw = document.createElement('div');
        sw.style.cssText = `width:26px;height:26px;background:${s};border-radius:4px;cursor:pointer;border:1px solid #333;`;
        sw.addEventListener('click', () => {
          state.brushColor = s;
          colorInp.value = s;
          if (state.canvas && state.canvas.freeDrawingBrush) {
            state.canvas.freeDrawingBrush.color = s;
          }
        });
        swatchWrap.appendChild(sw);
      }
      panel.appendChild(swatchWrap);

      const sizeSec = document.createElement('div');
      sizeSec.style.cssText = 'margin-bottom:12px;';
      sizeSec.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Brush Size</div>';
      const sizeInp = document.createElement('input');
      sizeInp.type = 'range';
      sizeInp.min = 1;
      sizeInp.max = 80;
      sizeInp.value = state.brushSize;
      sizeInp.style.cssText = 'width:100%;accent-color:var(--nexus-cyan);';
      const sizeLabel = document.createElement('span');
      sizeLabel.textContent = state.brushSize + 'px';
      sizeLabel.style.cssText = 'font-size:10px;color:#888;';
      sizeInp.addEventListener('input', () => {
        state.brushSize = parseInt(sizeInp.value);
        sizeLabel.textContent = state.brushSize + 'px';
        if (state.canvas && state.canvas.freeDrawingBrush) {
          state.canvas.freeDrawingBrush.width = state.brushSize;
        }
      });
      sizeSec.appendChild(sizeInp);
      sizeSec.appendChild(sizeLabel);
      panel.appendChild(sizeSec);

      const clearDraw = document.createElement('button');
      clearDraw.textContent = 'Clear All Drawings';
      clearDraw.style.cssText = 'width:100%;padding:6px;background:transparent;color:#ff003c;border:1px solid #ff003c;border-radius:4px;font-size:11px;cursor:pointer;';
      clearDraw.addEventListener('click', () => {
        if (!state.canvas) return;
        const objs = state.canvas.getObjects().filter(o => o.type === 'path');
        objs.forEach(o => state.canvas.remove(o));
        state.canvas.renderAll();
        saveHistory();
      });
      panel.appendChild(clearDraw);
    };

    document.getElementById('ie-format').addEventListener('change', () => {});
    document.getElementById('ie-quality').addEventListener('input', (e) => {
      document.getElementById('ie-quality-val').textContent = Math.round(e.target.value * 100) + '%';
    });

    const getExportBlob = async () => {
      const format = document.getElementById('ie-format').value;
      const quality = parseFloat(document.getElementById('ie-quality').value);
      if (state.canvas) {
        const dataUrl = state.canvas.toDataURL({ format, quality });
        const res = await fetch(dataUrl);
        return res.blob();
      }
      const fb = document.getElementById('ie-fallback');
      if (fb) {
        const dataUrl = fb.toDataURL('image/' + format, quality);
        const res = await fetch(dataUrl);
        return res.blob();
      }
      return null;
    };

    document.getElementById('ie-save').addEventListener('click', async () => {
      try {
        const blob = await getExportBlob();
        if (!blob) return;
        const app = window.__NEXUS_DI?.app;
        if (app && app.vfs) {
          await app.vfs.updateFile(file.path, blob);
          app.eventBus.emit('vfs:changed');
          app.notifications.show('Image saved', 'success');
        }
      } catch (e) {
        console.error(e);
      }
    });

    document.getElementById('ie-export').addEventListener('click', async () => {
      const blob = await getExportBlob();
      if (!blob) return;
      const format = document.getElementById('ie-format').value;
      const name = file.name.replace(/\.[^.]+$/, '') + '_export.' + format;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });

    renderFiltersPanel();
    renderLayersPanel();
    renderCropPanel();
    renderDrawPanel();

    return {
      save: async () => {
        document.getElementById('ie-save').click();
      },
      destroy: () => {
        if (state.canvas) {
          try { state.canvas.dispose(); } catch {}
        }
        if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      },
    };
  },
};
