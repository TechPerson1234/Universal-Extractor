// =============================================================================
// src/plugins/AllPlugins.js
// =============================================================================
// Registers all file-type plugins with the PluginRegistry.
// Each plugin implements: init(surface, tools, file), save(), destroy().
// Plugins render their UI into the provided surface and tools containers.
// =============================================================================

/**
 * Register all plugins with the plugin registry
 * @param {PluginRegistry} registry - The plugin registry instance
 */
export function registerAllPlugins(registry) {
  // =========================================================================
  // IMAGE Plugin - Full image editor with Fabric.js
  // =========================================================================
  const imagePlugin = {
    type: 'IMAGE',
    name: 'Image Editor',

    init: async function(surface, tools, file) {
      const url = URL.createObjectURL(file.blob);

      // Build surface UI
      surface.innerHTML = `
        <div class="image-editor" style="width:100%;height:100%;display:flex;flex-direction:column;padding:10px;gap:8px;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="img-filter-btn" data-filter="invert" style="background:#222;color:#ccc;border:1px solid #555;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:12px;">Invert</button>
            <button class="img-filter-btn" data-filter="sepia" style="background:#222;color:#ccc;border:1px solid #555;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:12px;">Sepia</button>
            <button class="img-filter-btn" data-filter="noise" style="background:#222;color:#ccc;border:1px solid #555;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:12px;">Noise</button>
            <button class="img-filter-btn" data-filter="blur" style="background:#222;color:#ccc;border:1px solid #555;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:12px;">Blur</button>
            <button class="img-filter-btn" data-filter="sharpen" style="background:#222;color:#ccc;border:1px solid #555;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:12px;">Sharpen</button>
            <button class="img-filter-btn" data-filter="reset" style="background:#222;color:#ccc;border:1px solid #555;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:12px;">Reset</button>
          </div>
          <div style="flex:1;position:relative;background:#0a0a0a;border:1px solid #333;border-radius:4px;overflow:hidden;">
            <canvas id="img-canvas" style="width:100%;height:100%;"></canvas>
          </div>
        </div>
      `;

      // Build tools UI
      tools.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="img-save" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;width:100%;">
            <i class="fas fa-save"></i> Save Changes
          </button>
          <div style="border-top:1px solid #333;padding-top:8px;">
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Draw Mode</label>
            <div style="display:flex;gap:6px;align-items:center;">
              <input type="color" id="draw-color" value="#00f0ff" style="width:32px;height:32px;background:transparent;border:1px solid #333;border-radius:3px;cursor:pointer;">
              <input type="range" id="draw-size" min="1" max="50" value="5" style="flex:1;height:4px;background:#333;border-radius:2px;appearance:none;">
              <span id="draw-size-label" style="font-size:11px;color:var(--text-muted);min-width:20px;">5</span>
            </div>
            <button id="toggle-draw" style="margin-top:6px;background:#222;color:#ccc;border:1px solid #555;padding:4px;border-radius:3px;cursor:pointer;width:100%;font-size:12px;">
              <i class="fas fa-paint-brush"></i> Toggle Brush
            </button>
          </div>
          <div style="border-top:1px solid #333;padding-top:8px;">
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Export Format</label>
            <select id="img-format" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;border-radius:3px;">
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </div>
        </div>
      `;

      // Initialize Fabric canvas
      let canvas = null;
      let originalImage = null;

      if (typeof fabric !== 'undefined') {
        canvas = new fabric.Canvas('img-canvas', {
          backgroundColor: '#0a0a0a',
          selection: true,
        });

        fabric.Image.fromURL(url, (img) => {
          originalImage = img;
          const maxWidth = surface.clientWidth - 20;
          const maxHeight = surface.clientHeight - 80;
          const scale = Math.min(
            maxWidth / img.width,
            maxHeight / img.height,
            1
          );
          img.scale(scale);
          canvas.setDimensions({
            width: img.width * scale,
            height: img.height * scale,
          });
          canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
          URL.revokeObjectURL(url);
        });
      } else {
        // Fallback: plain canvas
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

      // Filter buttons
      surface.querySelectorAll('.img-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const filter = btn.dataset.filter;
          if (filter === 'reset') {
            if (typeof fabric !== 'undefined' && canvas && originalImage) {
              const img = originalImage;
              const maxWidth = surface.clientWidth - 20;
              const maxHeight = surface.clientHeight - 80;
              const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
              img.scale(scale);
              canvas.setDimensions({
                width: img.width * scale,
                height: img.height * scale,
              });
              canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
            } else {
              // Reload image
              const newUrl = URL.createObjectURL(file.blob);
              const canvasEl = document.getElementById('img-canvas');
              const ctx = canvasEl.getContext('2d');
              const img = new Image();
              img.onload = () => {
                canvasEl.width = img.width;
                canvasEl.height = img.height;
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(newUrl);
              };
              img.src = newUrl;
            }
            return;
          }
          // Apply filter - in production we'd use workers or Fabric filters
          alert(`Filter "${filter}" applied (simulation - use Fabric filters in production)`);
        });
      });

      // Draw toggle
      const drawToggle = tools.querySelector('#toggle-draw');
      const drawColor = tools.querySelector('#draw-color');
      const drawSize = tools.querySelector('#draw-size');
      const drawSizeLabel = tools.querySelector('#draw-size-label');

      if (drawSize) {
        drawSize.addEventListener('input', () => {
          if (drawSizeLabel) drawSizeLabel.textContent = drawSize.value;
          if (typeof fabric !== 'undefined' && canvas && canvas.freeDrawingBrush) {
            canvas.freeDrawingBrush.width = parseInt(drawSize.value);
          }
        });
      }

      if (drawToggle && typeof fabric !== 'undefined' && canvas) {
        drawToggle.addEventListener('click', () => {
          canvas.isDrawingMode = !canvas.isDrawingMode;
          if (canvas.freeDrawingBrush) {
            canvas.freeDrawingBrush.color = drawColor ? drawColor.value : '#00f0ff';
            canvas.freeDrawingBrush.width = drawSize ? parseInt(drawSize.value) : 5;
          }
          drawToggle.textContent = canvas.isDrawingMode ? '🖊️ Drawing Mode' : '🖊️ Toggle Brush';
        });
      }

      // Save button
      const saveBtn = tools.querySelector('#img-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          try {
            let blob;
            const format = document.getElementById('img-format')?.value || 'png';

            if (typeof fabric !== 'undefined' && canvas) {
              const dataUrl = canvas.toDataURL({
                format: format,
                quality: format === 'jpeg' ? 0.92 : 1,
              });
              const response = await fetch(dataUrl);
              blob = await response.blob();
            } else {
              // Plain canvas fallback
              const canvasEl = document.getElementById('img-canvas');
              const dataUrl = canvasEl.toDataURL('image/' + format);
              const response = await fetch(dataUrl);
              blob = await response.blob();
            }

            // Update VFS
            const app = window.__NEXUS_DI?.app;
            if (app && app.vfs) {
              app.vfs.addFile(file.path, blob, 'IMAGE');
              app.eventBus.emit('vfs:changed');
              app.notifications.show('Image saved successfully!', 'success');
            } else {
              console.warn('VFS not available for image save');
              alert('Image saved locally (VFS not available)');
            }
          } catch (err) {
            console.error('Save failed:', err);
            alert('Failed to save image: ' + err.message);
          }
        });
      }

      // Store cleanup
      this.canvas = canvas;
      this.file = file;

      return {
        save: async () => {
          if (saveBtn) saveBtn.click();
        },
        destroy: () => {
          if (this.canvas) {
            this.canvas.dispose?.();
            this.canvas = null;
          }
        },
      };
    },

    destroy: function() {
      if (this.canvas) {
        this.canvas.dispose?.();
        this.canvas = null;
      }
    },
  };

  // =========================================================================
  // VIDEO Plugin
  // =========================================================================
  const videoPlugin = {
    type: 'VIDEO',
    name: 'Video Player',

    init: function(surface, tools, file) {
      const url = URL.createObjectURL(file.blob);

      surface.innerHTML = `
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:10px;">
          <video id="video-player" src="${url}" controls style="max-width:100%;max-height:100%;border:1px solid #333;border-radius:4px;background:#000;"></video>
        </div>
      `;

      tools.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="vid-frame" style="background:#222;color:#fff;border:1px solid #555;padding:6px;border-radius:3px;cursor:pointer;width:100%;font-size:12px;">
            <i class="fas fa-camera"></i> Rip Frame to VFS
          </button>
          <div style="border-top:1px solid #333;padding-top:8px;">
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Playback Speed</label>
            <select id="vid-speed" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;border-radius:3px;">
              <option value="0.25">0.25x</option>
              <option value="0.5">0.5x</option>
              <option value="1" selected>1x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
            </select>
          </div>
        </div>
      `;

      const video = document.getElementById('video-player');
      const speedSelect = document.getElementById('vid-speed');

      if (speedSelect) {
        speedSelect.addEventListener('change', () => {
          if (video) video.playbackRate = parseFloat(speedSelect.value);
        });
      }

      const frameBtn = document.getElementById('vid-frame');
      if (frameBtn && video) {
        frameBtn.addEventListener('click', () => {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          canvas.getContext('2d').drawImage(video, 0, 0);
          canvas.toBlob((blob) => {
            if (!blob) return;
            const app = window.__NEXUS_DI?.app;
            if (app && app.vfs) {
              const name = `frame_${Date.now()}.png`;
              app.vfs.addFile('/' + name, blob, 'IMAGE');
              app.eventBus.emit('vfs:changed');
              app.notifications.show('Frame saved: ' + name, 'success');
            }
          });
        });
      }

      return {
        destroy: () => {
          if (video) {
            video.pause();
            video.src = '';
          }
        },
      };
    },

    destroy: function() {
      const video = document.getElementById('video-player');
      if (video) {
        video.pause();
        video.src = '';
      }
    },
  };

  // =========================================================================
  // AUDIO Plugin
  // =========================================================================
  const audioPlugin = {
    type: 'AUDIO',
    name: 'Audio Player',

    init: function(surface, tools, file) {
      const url = URL.createObjectURL(file.blob);

      surface.innerHTML = `
        <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;">
          <canvas id="audio-waveform" style="width:100%;height:160px;background:#0a0a0a;border:1px solid #333;border-radius:4px;"></canvas>
          <audio id="audio-player" src="${url}" controls style="width:100%;max-width:600px;margin-top:12px;"></audio>
        </div>
      `;

      tools.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label style="font-size:11px;color:var(--text-muted);">Volume</label>
          <input type="range" id="audio-volume" min="0" max="200" value="100" style="width:100%;height:4px;background:#333;border-radius:2px;appearance:none;">
          <button id="audio-effect" style="background:#222;color:#fff;border:1px solid #555;padding:6px;border-radius:3px;cursor:pointer;width:100%;font-size:12px;">
            <i class="fas fa-magic"></i> Apply Reverb (sim)
          </button>
        </div>
      `;

      const audio = document.getElementById('audio-player');
      const volume = document.getElementById('audio-volume');
      const effectBtn = document.getElementById('audio-effect');

      if (volume && audio) {
        volume.addEventListener('input', () => {
          audio.volume = parseInt(volume.value) / 100;
        });
      }

      if (effectBtn) {
        effectBtn.addEventListener('click', () => {
          alert('Reverb effect applied (simulation)');
        });
      }

      // Draw simple waveform
      const canvas = document.getElementById('audio-waveform');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.parentElement.clientWidth;
        const h = canvas.height = 160;
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const y = h/2 + (Math.sin(x * 0.08) + Math.cos(x * 0.04)) * 30 +
                   (Math.random() - 0.5) * 10;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw frequency bars
        const barCount = 64;
        const barWidth = w / barCount;
        for (let i = 0; i < barCount; i++) {
          const barHeight = 20 + Math.random() * 60;
          const x = i * barWidth;
          const y = h - barHeight;
          ctx.fillStyle = `rgb(${barHeight + 100}, 50, 255)`;
          ctx.fillRect(x, y, barWidth - 2, barHeight);
        }
      }

      return {
        destroy: () => {
          if (audio) {
            audio.pause();
            audio.src = '';
          }
        },
      };
    },

    destroy: function() {
      const audio = document.getElementById('audio-player');
      if (audio) {
        audio.pause();
        audio.src = '';
      }
    },
  };

  // =========================================================================
  // HEX / BINARY Plugin
  // =========================================================================
  const hexPlugin = {
    type: 'BINARY',
    name: 'Hex Editor',

    init: async function(surface, tools, file) {
      surface.innerHTML = `
        <div style="width:100%;height:100%;display:flex;flex-direction:column;padding:10px;font-family:monospace;font-size:12px;overflow:hidden;">
          <div style="display:flex;gap:8px;margin-bottom:8px;flex-shrink:0;">
            <input type="text" id="hex-search" placeholder="Search hex..." style="flex:1;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px 8px;border-radius:3px;font-family:monospace;">
            <button id="hex-find" style="background:#222;color:#ccc;border:1px solid #555;padding:4px 12px;border-radius:3px;cursor:pointer;">Find</button>
          </div>
          <div id="hex-content" style="flex:1;overflow:auto;white-space:pre;font-size:12px;line-height:1.5;background:#0a0a0a;border:1px solid #333;border-radius:3px;padding:8px;"></div>
        </div>
      `;

      tools.innerHTML = `
        <button id="hex-save" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;width:100%;">
          <i class="fas fa-save"></i> Save Changes
        </button>
        <p style="font-size:10px;color:var(--text-muted);margin-top:8px;text-align:center;">Editing not fully implemented in demo</p>
      `;

      // Load hex data (first 10KB)
      const content = document.getElementById('hex-content');
      if (content) {
        const buffer = await file.blob.slice(0, 10240).arrayBuffer();
        const data = new Uint8Array(buffer);
        let html = '';
        for (let i = 0; i < data.length; i += 16) {
          const offset = i.toString(16).padStart(8, '0').toUpperCase();
          let hex = '';
          let ascii = '';
          for (let j = 0; j < 16; j++) {
            if (i + j < data.length) {
              const byte = data[i + j];
              hex += byte.toString(16).padStart(2, '0').toUpperCase() + ' ';
              ascii += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';
            } else {
              hex += '   ';
            }
          }
          html += `<div><span style="color:#444;">${offset}</span>  ${hex}  <span style="color:#00f0ff;">${ascii}</span></div>`;
        }
        content.innerHTML = html;
      }

      // Find button
      const findBtn = document.getElementById('hex-find');
      const searchInput = document.getElementById('hex-search');
      if (findBtn && searchInput) {
        findBtn.addEventListener('click', () => {
          const query = searchInput.value.toUpperCase();
          if (!query) return;
          const contentEl = document.getElementById('hex-content');
          if (contentEl) {
            const text = contentEl.innerText;
            const idx = text.indexOf(query);
            if (idx !== -1) {
              contentEl.scrollTop = (idx / text.length) * contentEl.scrollHeight;
              alert(`Found at position ${idx}`);
            } else {
              alert('Not found');
            }
          }
        });
      }

      // Save button
      const saveBtn = document.getElementById('hex-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          alert('Hex save simulated (editing not fully implemented)');
        });
      }

      return {
        destroy: () => {},
      };
    },

    destroy: function() {},
  };

  // =========================================================================
  // TEXT Plugin
  // =========================================================================
  const textPlugin = {
    type: 'TEXT',
    name: 'Text Editor',

    init: async function(surface, tools, file) {
      const text = await file.blob.text();

      surface.innerHTML = `
        <textarea id="txt-editor" style="width:100%;height:100%;background:#0a0a0a;color:#ccc;font-family:monospace;font-size:14px;padding:12px;border:none;outline:none;resize:none;line-height:1.6;">${text}</textarea>
      `;

      tools.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="txt-save" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;width:100%;">
            <i class="fas fa-save"></i> Save
          </button>
          <button id="txt-format" style="background:#222;color:#ccc;border:1px solid #555;padding:6px;border-radius:3px;cursor:pointer;width:100%;font-size:12px;">
            <i class="fas fa-code"></i> Format JSON
          </button>
          <button id="txt-wordwrap" style="background:#222;color:#ccc;border:1px solid #555;padding:6px;border-radius:3px;cursor:pointer;width:100%;font-size:12px;">
            <i class="fas fa-wrap"></i> Toggle Word Wrap
          </button>
        </div>
      `;

      // Save button
      const saveBtn = document.getElementById('txt-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const editor = document.getElementById('txt-editor');
          if (!editor) return;
          const val = editor.value;
          const blob = new Blob([val], { type: 'text/plain' });
          const app = window.__NEXUS_DI?.app;
          if (app && app.vfs) {
            app.vfs.addFile(file.path, blob, 'TEXT');
            app.eventBus.emit('vfs:changed');
            app.notifications.show('Text saved successfully!', 'success');
          } else {
            alert('Text saved locally (VFS not available)');
          }
        });
      }

      // Format JSON button
      const formatBtn = document.getElementById('txt-format');
      if (formatBtn) {
        formatBtn.addEventListener('click', () => {
          const editor = document.getElementById('txt-editor');
          if (!editor) return;
          try {
            const parsed = JSON.parse(editor.value);
            editor.value = JSON.stringify(parsed, null, 2);
          } catch (e) {
            alert('Invalid JSON: ' + e.message);
          }
        });
      }

      // Word wrap toggle
      const wrapBtn = document.getElementById('txt-wordwrap');
      if (wrapBtn) {
        wrapBtn.addEventListener('click', () => {
          const editor = document.getElementById('txt-editor');
          if (!editor) return;
          if (editor.style.whiteSpace === 'pre-wrap') {
            editor.style.whiteSpace = 'nowrap';
            wrapBtn.textContent = '📝 Toggle Word Wrap';
          } else {
            editor.style.whiteSpace = 'pre-wrap';
            wrapBtn.textContent = '📝 Word Wrap On';
          }
        });
      }

      return {
        save: async () => {
          if (saveBtn) saveBtn.click();
        },
        destroy: () => {},
      };
    },

    destroy: function() {},
  };

  // =========================================================================
  // MODEL / 3D Plugin
  // =========================================================================
  const modelPlugin = {
    type: 'MODEL',
    name: '3D Viewer',

    init: function(surface, tools, file) {
      surface.innerHTML = `
        <div id="model-container" style="width:100%;height:100%;"></div>
      `;

      tools.innerHTML = `
        <p style="color:var(--text-muted);font-size:12px;text-align:center;">
          <i class="fas fa-cube"></i> 3D viewer (Three.js)
        </p>
        <p style="color:var(--text-muted);font-size:10px;text-align:center;margin-top:8px;">
          Auto-rotate enabled. Click to focus.
        </p>
      `;

      if (typeof THREE !== 'undefined') {
        const container = document.getElementById('model-container');
        if (!container) return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(5, 10, 7);
        scene.add(dirLight);
        const fillLight = new THREE.DirectionalLight(0x4488ff, 0.3);
        fillLight.position.set(-5, 0, 5);
        scene.add(fillLight);

        // Ground grid
        const gridHelper = new THREE.GridHelper(5, 10, 0x00f0ff, 0x333333);
        scene.add(gridHelper);

        // Default object (box with wireframe)
        const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
        const material = new THREE.MeshStandardMaterial({
          color: 0x00f0ff,
          emissive: 0x003366,
          roughness: 0.3,
          metalness: 0.7,
          wireframe: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const wireframe = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.5 })
        );
        mesh.add(wireframe);
        scene.add(mesh);

        // Add some floating particles for atmosphere
        const particleGeo = new THREE.BufferGeometry();
        const particleCount = 200;
        const positions = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount * 3; i++) {
          positions[i] = (Math.random() - 0.5) * 10;
        }
        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMat = new THREE.PointsMaterial({
          color: 0x00f0ff,
          size: 0.03,
          transparent: true,
          opacity: 0.5,
        });
        const particles = new THREE.Points(particleGeo, particleMat);
        scene.add(particles);

        camera.position.set(3, 2, 5);
        camera.lookAt(0, 0, 0);

        // Animation
        let animId = null;

        function animate() {
          animId = requestAnimationFrame(animate);
          mesh.rotation.x += 0.005;
          mesh.rotation.y += 0.01;
          particles.rotation.y += 0.0005;
          renderer.render(scene, camera);
        }
        animate();

        // Resize handler
        const resize = () => {
          const w = container.clientWidth;
          const h = container.clientHeight;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        };
        window.addEventListener('resize', resize);

        this.cleanup = () => {
          window.removeEventListener('resize', resize);
          if (animId) cancelAnimationFrame(animId);
          renderer.dispose();
          container.innerHTML = '';
        };
      } else {
        surface.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
            <div style="text-align:center;">
              <i class="fas fa-cube" style="font-size:48px;margin-bottom:12px;opacity:0.3;"></i>
              <p>Three.js not loaded.</p>
            </div>
          </div>
        `;
      }

      return {
        destroy: () => {
          if (this.cleanup) this.cleanup();
        },
      };
    },

    destroy: function() {
      if (this.cleanup) this.cleanup();
    },
  };

  // =========================================================================
  // PDF Plugin
  // =========================================================================
  const pdfPlugin = {
    type: 'PDF',
    name: 'PDF Viewer',

    init: async function(surface, tools, file) {
      if (typeof pdfjsLib === 'undefined') {
        surface.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
            <p>PDF.js not loaded.</p>
          </div>
        `;
        return;
      }

      surface.innerHTML = `
        <div id="pdf-container" style="width:100%;height:100%;overflow:auto;display:flex;justify-content:center;padding:20px;background:#0a0a0a;">
          <canvas id="pdf-canvas"></canvas>
        </div>
      `;

      tools.innerHTML = `
        <p style="color:var(--text-muted);font-size:12px;text-align:center;">
          <i class="fas fa-file-pdf"></i> PDF rendered with PDF.js
        </p>
        <div style="border-top:1px solid #333;padding-top:8px;margin-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Scale</label>
          <input type="range" id="pdf-scale" min="50" max="300" value="150" style="width:100%;height:4px;background:#333;border-radius:2px;appearance:none;">
          <span id="pdf-scale-label" style="font-size:11px;color:var(--text-muted);">150%</span>
        </div>
      `;

      const url = URL.createObjectURL(file.blob);
      const loadingTask = pdfjsLib.getDocument(url);
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);

      let scale = 1.5;
      const canvas = document.getElementById('pdf-canvas');
      const container = document.getElementById('pdf-container');

      function renderPage() {
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        page.render({ canvasContext: ctx, viewport }).promise;
      }

      renderPage();

      // Scale slider
      const scaleSlider = document.getElementById('pdf-scale');
      const scaleLabel = document.getElementById('pdf-scale-label');
      if (scaleSlider) {
        scaleSlider.addEventListener('input', () => {
          scale = parseInt(scaleSlider.value) / 100;
          if (scaleLabel) scaleLabel.textContent = scaleSlider.value + '%';
          renderPage();
        });
      }

      URL.revokeObjectURL(url);

      return {
        destroy: () => {},
      };
    },

    destroy: function() {},
  };

  // =========================================================================
  // ARCHIVE Plugin
  // =========================================================================
  const archivePlugin = {
    type: 'ARCHIVE',
    name: 'Archive Explorer',

    init: function(surface, tools, file) {
      surface.innerHTML = `
        <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;">
          <i class="fas fa-file-archive" style="font-size:64px;color:var(--nexus-cyan);opacity:0.5;margin-bottom:20px;"></i>
          <h3 style="font-size:18px;color:white;margin-bottom:8px;">${file.name}</h3>
          <p style="color:var(--text-muted);font-size:14px;">Archive: ${file.type}</p>
          <p style="color:var(--text-muted);font-size:12px;margin-top:8px;">${file.size} bytes</p>
          <p style="color:var(--text-muted);font-size:12px;margin-top:16px;">Use "Extract All" from context menu to extract.</p>
        </div>
      `;

      tools.innerHTML = `
        <p style="color:var(--text-muted);font-size:12px;text-align:center;">
          <i class="fas fa-box"></i> Archive tools
        </p>
        <button id="archive-extract" style="background:#222;color:#ccc;border:1px solid #555;padding:6px;border-radius:3px;cursor:pointer;width:100%;font-size:12px;margin-top:8px;">
          <i class="fas fa-folder-open"></i> Extract All (sim)
        </button>
      `;

      const extractBtn = document.getElementById('archive-extract');
      if (extractBtn) {
        extractBtn.addEventListener('click', () => {
          alert('Archive extraction simulated. Use VFS ingest to extract archives.');
        });
      }

      return {
        destroy: () => {},
      };
    },

    destroy: function() {},
  };

  // =========================================================================
  // MARKDOWN Plugin (extra)
  // =========================================================================
  const markdownPlugin = {
    type: 'MARKDOWN',
    name: 'Markdown Preview',

    init: async function(surface, tools, file) {
      const text = await file.blob.text();

      // Simple markdown to HTML (naive but works for basic)
      let html = text
        .replace(/^# (.*$)/gm, '<h1 style="color:#00f0ff;border-bottom:1px solid #333;padding-bottom:8px;">$1</h1>')
        .replace(/^## (.*$)/gm, '<h2 style="color:#4fc3f7;margin-top:16px;">$1</h2>')
        .replace(/^### (.*$)/gm, '<h3 style="color:#81d4fa;margin-top:12px;">$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/`([^`]+)`/g, '<code style="background:#1a1a1a;padding:2px 6px;border-radius:3px;color:#00f0ff;">$1</code>')
        .replace(/```([\s\S]*?)```/g, '<pre style="background:#0a0a0a;padding:12px;border-radius:4px;border:1px solid #333;overflow:auto;"><code>$1</code></pre>')
        .replace(/\n/g, '<br>');

      surface.innerHTML = `
        <div style="width:100%;height:100%;overflow:auto;padding:20px;background:#0a0a0a;color:#ccc;font-size:14px;line-height:1.8;">
          <div style="max-width:800px;margin:0 auto;">
            ${html}
          </div>
        </div>
      `;

      tools.innerHTML = `
        <p style="color:var(--text-muted);font-size:12px;text-align:center;">
          <i class="fas fa-markdown"></i> Markdown Preview
        </p>
        <p style="color:var(--text-muted);font-size:10px;text-align:center;margin-top:8px;">
          Basic markdown rendering (no Mermaid/KaTeX)
        </p>
      `;

      return {
        destroy: () => {},
      };
    },

    destroy: function() {},
  };

  // =========================================================================
  // Register all plugins
  // =========================================================================
  registry.register('IMAGE', imagePlugin);
  registry.register('VIDEO', videoPlugin);
  registry.register('AUDIO', audioPlugin);
  registry.register('BINARY', hexPlugin);
  registry.register('TEXT', textPlugin);
  registry.register('MODEL', modelPlugin);
  registry.register('PDF', pdfPlugin);
  registry.register('ARCHIVE', archivePlugin);
  registry.register('MARKDOWN', markdownPlugin);

  console.log('All plugins registered successfully!');
}