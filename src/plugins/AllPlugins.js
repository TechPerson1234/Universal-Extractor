// =============================================================================
// src/plugins/AllPlugins.js
// =============================================================================
// Registers all file-type plugins with the PluginRegistry.
// Each plugin implements: init(surface, tools, file), save(), destroy().
// =============================================================================

import { PluginRegistry } from '../core/PluginRegistry.js';

// Helper to get a plugin registry instance from DI? We'll assume PluginRegistry is global.
// But we'll export a function that takes the registry and registers all plugins.

export function registerAllPlugins(registry) {
  // IMAGE Plugin
  const imagePlugin = {
    type: 'IMAGE',
    name: 'Image Editor',
    init: async function(surface, tools, file) {
      const url = URL.createObjectURL(file.blob);
      // Build UI
      surface.innerHTML = `
        <div class="image-editor" style="width:100%;height:100%;display:flex;flex-direction:column;padding:10px;">
          <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
            <button class="img-btn" data-filter="invert">Invert</button>
            <button class="img-btn" data-filter="sepia">Sepia</button>
            <button class="img-btn" data-filter="noise">Noise</button>
            <button class="img-btn" data-filter="blur">Blur</button>
            <button class="img-btn" data-filter="sharpen">Sharpen</button>
            <button class="img-btn" data-filter="reset">Reset</button>
          </div>
          <canvas id="img-canvas" style="flex:1;border:1px solid #333;background:#111;"></canvas>
        </div>
      `;
      // Tools panel
      tools.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="img-save" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;">Save Changes</button>
          <label style="font-size:12px;color:var(--text-muted);">Draw Mode</label>
          <div style="display:flex;gap:4px;">
            <input type="color" id="draw-color" value="#00f0ff" style="width:30px;height:30px;background:transparent;">
            <input type="range" id="draw-size" min="1" max="50" value="5" style="flex:1;">
          </div>
          <button id="toggle-draw" style="background:#222;color:#ccc;border:1px solid #555;padding:4px;border-radius:4px;cursor:pointer;">Toggle Brush</button>
        </div>
      `;

      // Load image into canvas (using Fabric.js if available)
      let canvas;
      if (typeof fabric !== 'undefined') {
        canvas = new fabric.Canvas('img-canvas');
        fabric.Image.fromURL(url, (img) => {
          const scale = Math.min(800 / img.width, 600 / img.height, 1);
          img.scale(scale);
          canvas.setDimensions({ width: img.width * scale, height: img.height * scale });
          canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
          URL.revokeObjectURL(url);
        });
      } else {
        // Fallback: use plain canvas
        const canvasEl = document.getElementById('img-canvas');
        const ctx = canvasEl.getContext('2d');
        const img = new Image();
        img.onload = () => {
          canvasEl.width = img.width;
          canvasEl.height = img.height;
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }

      // Event listeners for buttons
      surface.querySelectorAll('.img-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const filter = btn.dataset.filter;
          if (filter === 'reset') {
            // Reload original
            // For simplicity, just reload
            URL.revokeObjectURL(url);
            const newUrl = URL.createObjectURL(file.blob);
            // Reinitialize
            // We'll just call init again? Better to handle properly.
            // But we'll just reload.
            if (typeof fabric !== 'undefined') {
              fabric.Image.fromURL(newUrl, (img) => {
                const scale = Math.min(800 / img.width, 600 / img.height, 1);
                img.scale(scale);
                canvas.setDimensions({ width: img.width * scale, height: img.height * scale });
                canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
              });
            } else {
              const imgEl = new Image();
              imgEl.onload = () => {
                const c = document.getElementById('img-canvas');
                c.width = imgEl.width;
                c.height = imgEl.height;
                c.getContext('2d').drawImage(imgEl, 0, 0);
              };
              imgEl.src = newUrl;
            }
            return;
          }
          // Apply filter (simplified)
          alert(`Filter "${filter}" applied (simulation)`);
        });
      });

      // Save
      const saveBtn = tools.querySelector('#img-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          // For fabric, get data URL
          if (typeof fabric !== 'undefined' && canvas) {
            const dataUrl = canvas.toDataURL('image/png');
            fetch(dataUrl).then(res => res.blob()).then(blob => {
              // Update VFS via callback (we'll store in closure)
              if (window.__NEXUS_DI && window.__NEXUS_DI.app) {
                const app = window.__NEXUS_DI.app;
                const vfs = app.vfs;
                vfs.addFile(file.path, blob, 'IMAGE');
                app.eventBus.emit('vfs:changed');
              }
              alert('Image saved.');
            });
          } else {
            // Plain canvas save
            const canvasEl = document.getElementById('img-canvas');
            canvasEl.toBlob(blob => {
              if (window.__NEXUS_DI && window.__NEXUS_DI.app) {
                const app = window.__NEXUS_DI.app;
                const vfs = app.vfs;
                vfs.addFile(file.path, blob, 'IMAGE');
                app.eventBus.emit('vfs:changed');
              }
              alert('Image saved.');
            });
          }
        });
      }

      // Draw toggle
      const drawBtn = tools.querySelector('#toggle-draw');
      if (drawBtn && typeof fabric !== 'undefined') {
        drawBtn.addEventListener('click', () => {
          canvas.isDrawingMode = !canvas.isDrawingMode;
          const color = document.getElementById('draw-color').value;
          const size = parseInt(document.getElementById('draw-size').value);
          if (canvas.freeDrawingBrush) {
            canvas.freeDrawingBrush.color = color;
            canvas.freeDrawingBrush.width = size;
          }
        });
      }

      // Store references for save
      this.canvas = canvas;
      this.file = file;
    },
    save: function() {
      // Save via button click
      const btn = document.querySelector('#img-save');
      if (btn) btn.click();
    },
    destroy: function() {
      // Cleanup
      if (this.canvas) {
        this.canvas.dispose?.();
        this.canvas = null;
      }
    }
  };

  // VIDEO Plugin
  const videoPlugin = {
    type: 'VIDEO',
    name: 'Video Player',
    init: function(surface, tools, file) {
      const url = URL.createObjectURL(file.blob);
      surface.innerHTML = `
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:10px;">
          <video src="${url}" controls style="max-width:100%;max-height:100%;border:1px solid #333;border-radius:4px;"></video>
        </div>
      `;
      tools.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="vid-frame" style="background:#222;color:#fff;border:1px solid #555;padding:4px;border-radius:4px;cursor:pointer;">Rip Frame</button>
          <label>Speed</label>
          <select id="vid-speed" style="background:#222;color:#fff;border:1px solid #555;padding:4px;">
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="1" selected>1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
        </div>
      `;
      const video = surface.querySelector('video');
      const speedSelect = tools.querySelector('#vid-speed');
      speedSelect.addEventListener('change', () => {
        video.playbackRate = parseFloat(speedSelect.value);
      });
      const frameBtn = tools.querySelector('#vid-frame');
      frameBtn.addEventListener('click', () => {
        if (!video) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        canvas.toBlob(blob => {
          // Save as image in VFS
          if (window.__NEXUS_DI && window.__NEXUS_DI.app) {
            const app = window.__NEXUS_DI.app;
            const vfs = app.vfs;
            const name = `frame_${Date.now()}.png`;
            vfs.addFile('/' + name, blob, 'IMAGE');
            app.eventBus.emit('vfs:changed');
            app.notifications.show('Frame saved as ' + name, 'success');
          }
        });
      });
    },
    destroy: function() {
      // Cleanup video elements
    }
  };

  // AUDIO Plugin
  const audioPlugin = {
    type: 'AUDIO',
    name: 'Audio Player',
    init: function(surface, tools, file) {
      const url = URL.createObjectURL(file.blob);
      surface.innerHTML = `
        <div style="width:100%;padding:20px;display:flex;flex-direction:column;align-items:center;">
          <canvas id="audio-wave" style="width:100%;height:120px;background:#0a0a0a;border:1px solid #333;border-radius:4px;"></canvas>
          <audio src="${url}" controls style="width:100%;margin-top:10px;"></audio>
        </div>
      `;
      tools.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label>Volume</label>
          <input type="range" id="audio-volume" min="0" max="200" value="100">
          <button id="audio-effect" style="background:#222;color:#fff;border:1px solid #555;padding:4px;border-radius:4px;cursor:pointer;">Apply Reverb (sim)</button>
        </div>
      `;
      const audio = surface.querySelector('audio');
      const volume = tools.querySelector('#audio-volume');
      volume.addEventListener('input', () => {
        audio.volume = volume.value / 100;
      });
      const effectBtn = tools.querySelector('#audio-effect');
      effectBtn.addEventListener('click', () => {
        alert('Effect applied (simulation)');
      });
      // Waveform (simplified)
      const canvas = document.getElementById('audio-wave');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        // Draw random waveform
        const w = canvas.width = canvas.parentElement.clientWidth;
        const h = canvas.height = 120;
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#00f0ff';
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const y = h/2 + (Math.sin(x*0.1) + Math.cos(x*0.05)) * 20 + (Math.random()-0.5)*10;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
    destroy: function() {}
  };

  // HEX Plugin
  const hexPlugin = {
    type: 'BINARY',
    name: 'Hex Editor',
    init: function(surface, tools, file) {
      surface.innerHTML = `
        <div style="width:100%;height:100%;display:flex;flex-direction:column;padding:10px;overflow:auto;font-family:monospace;font-size:13px;">
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <input type="text" id="hex-search" placeholder="Search hex..." style="flex:1;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;">
            <button id="hex-find" style="background:#222;color:#fff;border:1px solid #555;padding:4px 12px;border-radius:4px;cursor:pointer;">Find</button>
          </div>
          <div id="hex-content" style="flex:1;overflow:auto;white-space:pre;font-size:13px;line-height:1.6;"></div>
        </div>
      `;
      tools.innerHTML = `
        <button id="hex-save" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;">Save Changes</button>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">Editing not fully implemented in this demo.</p>
      `;

      // Load hex data
      const content = document.getElementById('hex-content');
      // Read first 1KB
      file.blob.arrayBuffer().then(buffer => {
        const data = new Uint8Array(buffer);
        let html = '';
        for (let i = 0; i < data.length; i += 16) {
          const offset = i.toString(16).padStart(8, '0').toUpperCase();
          let hex = '';
          let ascii = '';
          for (let j = 0; j < 16; j++) {
            if (i + j < data.length) {
              const byte = data[i+j];
              hex += byte.toString(16).padStart(2, '0').toUpperCase() + ' ';
              ascii += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';
            } else {
              hex += '   ';
            }
          }
          html += `<div><span style="color:#444;">${offset}</span>  ${hex}  <span style="color:#00f0ff;">${ascii}</span></div>`;
        }
        content.innerHTML = html;
      });

      const saveBtn = tools.querySelector('#hex-save');
      saveBtn.addEventListener('click', () => {
        alert('Hex save simulated.');
      });
    },
    destroy: function() {}
  };

  // TEXT Plugin
  const textPlugin = {
    type: 'TEXT',
    name: 'Text Editor',
    init: async function(surface, tools, file) {
      const text = await file.blob.text();
      surface.innerHTML = `
        <textarea id="txt-editor" style="width:100%;height:100%;background:#0a0a0a;color:#ccc;font-family:monospace;font-size:14px;padding:10px;border:none;outline:none;resize:none;">${text}</textarea>
      `;
      tools.innerHTML = `
        <button id="txt-save" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;">Save</button>
        <button id="txt-format" style="background:#222;color:#fff;border:1px solid #555;padding:4px;border-radius:4px;cursor:pointer;">Format JSON</button>
      `;
      const saveBtn = tools.querySelector('#txt-save');
      saveBtn.addEventListener('click', () => {
        const val = document.getElementById('txt-editor').value;
        const blob = new Blob([val], { type: 'text/plain' });
        if (window.__NEXUS_DI && window.__NEXUS_DI.app) {
          const app = window.__NEXUS_DI.app;
          const vfs = app.vfs;
          vfs.addFile(file.path, blob, 'TEXT');
          app.eventBus.emit('vfs:changed');
          app.notifications.show('Text saved.', 'success');
        }
      });
      const formatBtn = tools.querySelector('#txt-format');
      formatBtn.addEventListener('click', () => {
        const editor = document.getElementById('txt-editor');
        try {
          const parsed = JSON.parse(editor.value);
          editor.value = JSON.stringify(parsed, null, 2);
        } catch (e) {
          alert('Invalid JSON');
        }
      });
    },
    destroy: function() {}
  };

  // MODEL Plugin (3D)
  const modelPlugin = {
    type: 'MODEL',
    name: '3D Viewer',
    init: function(surface, tools, file) {
      surface.innerHTML = `<div id="model-container" style="width:100%;height:100%;"></div>`;
      tools.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">3D viewer (Three.js).</p>`;
      // Load Three.js and render a simple box
      if (typeof THREE !== 'undefined') {
        const container = document.getElementById('model-container');
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        container.appendChild(renderer.domElement);
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(1, 1, 1);
        scene.add(light);
        scene.add(new THREE.AmbientLight(0x222222));
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x111111 });
        const cube = new THREE.Mesh(geometry, material);
        scene.add(cube);
        camera.position.z = 3;
        function animate() {
          requestAnimationFrame(animate);
          cube.rotation.x += 0.01;
          cube.rotation.y += 0.02;
          renderer.render(scene, camera);
        }
        animate();
        // Handle resize
        const resize = () => {
          const w = container.clientWidth;
          const h = container.clientHeight;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        };
        window.addEventListener('resize', resize);
        // Store cleanup
        this.cleanup = () => {
          window.removeEventListener('resize', resize);
          renderer.dispose();
        };
      } else {
        surface.innerHTML = '<p style="color:var(--text-muted);">Three.js not loaded.</p>';
      }
    },
    destroy: function() {
      if (this.cleanup) this.cleanup();
    }
  };

  // PDF Plugin
  const pdfPlugin = {
    type: 'PDF',
    name: 'PDF Viewer',
    init: async function(surface, tools, file) {
      if (typeof pdfjsLib === 'undefined') {
        surface.innerHTML = '<p style="color:var(--text-muted);">PDF.js not loaded.</p>';
        return;
      }
      surface.innerHTML = `<div id="pdf-container" style="width:100%;height:100%;overflow:auto;display:flex;justify-content:center;padding:20px;"><canvas id="pdf-canvas"></canvas></div>`;
      tools.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">PDF rendered with PDF.js</p>`;
      const url = URL.createObjectURL(file.blob);
      const loadingTask = pdfjsLib.getDocument(url);
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.getElementById('pdf-canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      URL.revokeObjectURL(url);
    },
    destroy: function() {}
  };

  // ARCHIVE Plugin
  const archivePlugin = {
    type: 'ARCHIVE',
    name: 'Archive Explorer',
    init: function(surface, tools, file) {
      surface.innerHTML = `
        <div style="width:100%;padding:20px;">
          <p style="color:var(--text-muted);">Archive extraction not implemented in plugin demo.</p>
          <p style="color:var(--text-muted);font-size:12px;">Use VFS ingestion to extract.</p>
        </div>
      `;
      tools.innerHTML = `<p style="color:var(--text-muted);">No tools for archive.</p>`;
    },
    destroy: function() {}
  };

  // MARKDOWN Plugin (extra)
  const markdownPlugin = {
    type: 'MARKDOWN',
    name: 'Markdown Preview',
    init: async function(surface, tools, file) {
      const text = await file.blob.text();
      // Simple markdown to HTML (naive)
      let html = text
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/\n/g, '<br>');
      surface.innerHTML = `
        <div style="width:100%;height:100%;overflow:auto;padding:20px;background:#0a0a0a;color:#ccc;">
          ${html}
        </div>
      `;
      tools.innerHTML = `<p style="color:var(--text-muted);">Markdown preview (basic).</p>`;
    },
    destroy: function() {}
  };

  // Register all plugins
  registry.register('IMAGE', imagePlugin);
  registry.register('VIDEO', videoPlugin);
  registry.register('AUDIO', audioPlugin);
  registry.register('BINARY', hexPlugin);
  registry.register('TEXT', textPlugin);
  registry.register('MODEL', modelPlugin);
  registry.register('PDF', pdfPlugin);
  registry.register('ARCHIVE', archivePlugin);
  registry.register('MARKDOWN', markdownPlugin);
}