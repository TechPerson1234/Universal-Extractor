export const ModelViewerPlugin = {
  type: 'MODEL',
  name: '3D Viewer',
  version: '2.0.0',

  async init(surface, tools, file) {
    if (typeof THREE === 'undefined') {
      surface.innerHTML = '<div style="padding:20px;color:#ff003c;font-family:monospace;">Three.js not loaded</div>';
      return { destroy: () => {} };
    }

    const state = {
      scene: null,
      camera: null,
      renderer: null,
      controls: null,
      model: null,
      animationId: null,
      autoRotate: true,
      wireframe: false,
      showGrid: true,
      showAxes: true,
      backgroundColor: '#1a1a1a',
      modelScale: 1,
      progressiveLoad: false,
    };

    surface.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:#1a1a1a;overflow:hidden;">
        <div style="height:36px;background:#0f0f0f;border-bottom:1px solid #222;display:flex;align-items:center;padding:0 10px;gap:8px;flex-shrink:0;">
          <span style="font-size:11px;color:#ccc;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${file.name}</span>
          <div style="flex:1;"></div>
          <span id="mv-fps" style="font-size:10px;color:#666;font-family:monospace;min-width:60px;text-align:right;">-- FPS</span>
        </div>
        <div id="mv-viewport" style="flex:1;position:relative;overflow:hidden;background:#1a1a1a;">
          <div id="mv-loading" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);color:#ccc;font-family:monospace;font-size:12px;gap:12px;">
            <div class="mv-spinner" style="width:40px;height:40px;border:3px solid rgba(0,240,255,0.2);border-top-color:var(--nexus-cyan);border-radius:50%;animation:mv-spin 1s linear infinite;"></div>
            <div>Loading model...</div>
            <div id="mv-load-progress" style="font-size:10px;color:#666;"></div>
          </div>
        </div>
        <div style="height:32px;background:#0f0f0f;border-top:1px solid #222;display:flex;align-items:center;padding:0 10px;gap:12px;flex-shrink:0;font-family:monospace;font-size:10px;color:#666;">
          <span id="mv-stats">—</span>
          <div style="flex:1;"></div>
          <span id="mv-camera-info"></span>
        </div>
      </div>
    `;

    tools.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="border-bottom:1px solid #333;padding-bottom:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Display</label>
          <button id="mv-rotate" style="width:100%;padding:5px;background:rgba(0,240,255,0.15);color:var(--nexus-cyan);border:1px solid var(--nexus-cyan);border-radius:3px;font-size:11px;cursor:pointer;margin-bottom:4px;">
            <i class="fas fa-sync"></i> Auto-Rotate: ON
          </button>
          <button id="mv-wireframe" style="width:100%;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;margin-bottom:4px;">
            <i class="fas fa-border-all"></i> Wireframe
          </button>
          <button id="mv-grid" style="width:100%;padding:5px;background:rgba(0,240,255,0.15);color:var(--nexus-cyan);border:1px solid var(--nexus-cyan);border-radius:3px;font-size:11px;cursor:pointer;margin-bottom:4px;">
            <i class="fas fa-th"></i> Grid
          </button>
          <button id="mv-axes" style="width:100%;padding:5px;background:rgba(0,240,255,0.15);color:var(--nexus-cyan);border:1px solid var(--nexus-cyan);border-radius:3px;font-size:11px;cursor:pointer;">
            <i class="fas fa-compass"></i> Axes
          </button>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Camera</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <button data-view="front" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Front</button>
            <button data-view="back" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Back</button>
            <button data-view="top" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Top</button>
            <button data-view="bottom" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Bottom</button>
            <button data-view="left" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Left</button>
            <button data-view="right" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Right</button>
          </div>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Scale</label>
          <input id="mv-scale" type="range" min="0.1" max="5" step="0.1" value="1" style="width:100%;accent-color:var(--nexus-cyan);">
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Background</label>
          <input id="mv-bg" type="color" value="#1a1a1a" style="width:100%;height:32px;background:transparent;border:1px solid #333;border-radius:3px;cursor:pointer;">
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <button id="mv-export" style="width:100%;padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">
            <i class="fas fa-camera"></i> Export Screenshot
          </button>
          <button id="mv-reset" style="width:100%;margin-top:4px;padding:6px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:11px;cursor:pointer;">
            <i class="fas fa-redo"></i> Reset View
          </button>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = '@keyframes mv-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);

    const viewport = document.getElementById('mv-viewport');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(state.backgroundColor);
    state.scene = scene;

    const camera = new THREE.PerspectiveCamera(50, viewport.clientWidth / viewport.clientHeight, 0.01, 1000);
    camera.position.set(3, 2, 4);
    state.camera = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    renderer.outputEncoding = THREE.sRGBEncoding || 3001;
    viewport.appendChild(renderer.domElement);
    state.renderer = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.35);
    fillLight.position.set(-5, 0, 5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xff00ff, 0.25);
    rimLight.position.set(0, -5, -5);
    scene.add(rimLight);

    let gridHelper = new THREE.GridHelper(10, 20, 0x00f0ff, 0x333333);
    scene.add(gridHelper);

    let axesHelper = new THREE.AxesHelper(2);
    scene.add(axesHelper);

    let controls = null;
    if (typeof THREE.OrbitControls !== 'undefined') {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.rotateSpeed = 0.8;
      controls.zoomSpeed = 1.2;
      controls.panSpeed = 0.8;
      controls.autoRotate = state.autoRotate;
      controls.autoRotateSpeed = 1.5;
      controls.target.set(0, 0, 0);
      state.controls = controls;
    } else {
      console.warn('OrbitControls not loaded — using manual controls');
      setupManualControls(renderer.domElement, camera, state);
    }

    const setupManualControls = (el, cam, st) => {
      let isDragging = false;
      let prevX = 0, prevY = 0;
      let theta = Math.atan2(cam.position.x, cam.position.z);
      let phi = Math.acos(cam.position.y / cam.position.length());
      const radius = cam.position.length();

      el.addEventListener('mousedown', (e) => {
        isDragging = true;
        prevX = e.clientX;
        prevY = e.clientY;
      });
      el.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - prevX;
        const dy = e.clientY - prevY;
        prevX = e.clientX;
        prevY = e.clientY;
        theta -= dx * 0.01;
        phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi - dy * 0.01));
        cam.position.x = radius * Math.sin(phi) * Math.sin(theta);
        cam.position.y = radius * Math.cos(phi);
        cam.position.z = radius * Math.sin(phi) * Math.cos(theta);
        cam.lookAt(0, 0, 0);
      });
      el.addEventListener('mouseup', () => { isDragging = false; });
      el.addEventListener('mouseleave', () => { isDragging = false; });
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const scale = e.deltaY > 0 ? 1.1 : 0.9;
        cam.position.multiplyScalar(scale);
      }, { passive: false });
    };

    const loader = new THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
    const OBJLoader = THREE.OBJLoader;
    const STLLoader = THREE.STLLoader;

    const extension = file.name.split('.').pop().toLowerCase();
    const loadProgress = document.getElementById('mv-load-progress');
    const loadingEl = document.getElementById('mv-loading');

    const processLoadedObject = (obj) => {
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 3 / maxDim;
      obj.scale.setScalar(scale);
      obj.position.sub(center.multiplyScalar(scale));
      obj.position.y += size.y * scale / 2;

      state.model = obj;
      scene.add(obj);

      const camDist = Math.max(size.x, size.y, size.z) * scale * 2.5;
      camera.position.set(camDist * 0.7, camDist * 0.5, camDist);
      camera.lookAt(0, size.y * scale / 2, 0);
      if (controls) {
        controls.target.set(0, size.y * scale / 2, 0);
        controls.update();
      }

      const tris = countTriangles(obj);
      document.getElementById('mv-stats').textContent = `${tris.toLocaleString()} tris · ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}`;
      loadingEl.style.display = 'none';
    };

    const countTriangles = (obj) => {
      let total = 0;
      obj.traverse((child) => {
        if (child.isMesh && child.geometry) {
          const geo = child.geometry;
          if (geo.index) total += geo.index.count / 3;
          else if (geo.attributes.position) total += geo.attributes.position.count / 3;
        }
      });
      return Math.floor(total);
    };

    const applyMaterial = (obj) => {
      obj.traverse((child) => {
        if (child.isMesh) {
          if (!child.material || !child.material.color) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0x00f0ff,
              metalness: 0.4,
              roughness: 0.5,
            });
          } else if (Array.isArray(child.material)) {
            child.material = child.material.map(m => {
              if (m.color) return m;
              return new THREE.MeshStandardMaterial({ color: 0x00f0ff });
            });
          }
        }
      });
    };

    try {
      const blobUrl = URL.createObjectURL(file.blob);

      if (extension === 'glb' || extension === 'gltf') {
        if (!loader) throw new Error('GLTFLoader not loaded');
        const result = await loader.loadAsync(blobUrl, (progress) => {
          if (progress.total) {
            loadProgress.textContent = `${((progress.loaded / progress.total) * 100).toFixed(0)}%`;
          }
        });
        const gltf = result;
        processLoadedObject(gltf.scene);
      } else if (extension === 'obj') {
        if (!OBJLoader) throw new Error('OBJLoader not loaded');
        const obj = await OBJLoader.loadAsync(blobUrl);
        applyMaterial(obj);
        processLoadedObject(obj);
      } else if (extension === 'stl') {
        if (!STLLoader) throw new Error('STLLoader not loaded');
        const geometry = await STLLoader.loadAsync(blobUrl);
        const material = new THREE.MeshStandardMaterial({
          color: 0x00f0ff,
          metalness: 0.5,
          roughness: 0.4,
          flatShading: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        geometry.computeVertexNormals();
        const wireframe = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 30),
          new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.15 })
        );
        mesh.add(wireframe);
        processLoadedObject(mesh);
      } else {
        throw new Error('Unsupported format: ' + extension);
      }

      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Model load failed:', err);
      loadingEl.innerHTML = `<div style="color:#ff003c;">Failed to load: ${err.message}</div>`;
    }

    let lastTime = performance.now();
    let frames = 0;
    const fpsEl = document.getElementById('mv-fps');

    const animate = () => {
      state.animationId = requestAnimationFrame(animate);
      if (controls) controls.update();
      else if (state.autoRotate && state.model) {
        state.model.rotation.y += 0.005;
      }

      renderer.render(scene, camera);

      frames++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        fpsEl.textContent = frames + ' FPS';
        frames = 0;
        lastTime = now;
      }

      const camInfo = document.getElementById('mv-camera-info');
      if (camInfo) {
        camInfo.textContent = `cam (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})`;
      }
    };
    animate();

    const resizeHandler = () => {
      const w = viewport.clientWidth;
      const h = viewport.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', resizeHandler);

    document.getElementById('mv-rotate').addEventListener('click', () => {
      state.autoRotate = !state.autoRotate;
      if (controls) controls.autoRotate = state.autoRotate;
      const btn = document.getElementById('mv-rotate');
      btn.style.background = state.autoRotate ? 'rgba(0,240,255,0.15)' : '#1a1a1a';
      btn.style.color = state.autoRotate ? 'var(--nexus-cyan)' : '#ccc';
      btn.style.borderColor = state.autoRotate ? 'var(--nexus-cyan)' : '#333';
      btn.innerHTML = `<i class="fas fa-sync"></i> Auto-Rotate: ${state.autoRotate ? 'ON' : 'OFF'}`;
    });

    document.getElementById('mv-wireframe').addEventListener('click', () => {
      state.wireframe = !state.wireframe;
      if (state.model) {
        state.model.traverse((child) => {
          if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of mats) if (m) m.wireframe = state.wireframe;
          }
        });
      }
      const btn = document.getElementById('mv-wireframe');
      btn.style.background = state.wireframe ? 'rgba(0,240,255,0.15)' : '#1a1a1a';
      btn.style.color = state.wireframe ? 'var(--nexus-cyan)' : '#ccc';
    });

    document.getElementById('mv-grid').addEventListener('click', () => {
      state.showGrid = !state.showGrid;
      gridHelper.visible = state.showGrid;
      const btn = document.getElementById('mv-grid');
      btn.style.background = state.showGrid ? 'rgba(0,240,255,0.15)' : '#1a1a1a';
      btn.style.color = state.showGrid ? 'var(--nexus-cyan)' : '#ccc';
    });

    document.getElementById('mv-axes').addEventListener('click', () => {
      state.showAxes = !state.showAxes;
      axesHelper.visible = state.showAxes;
      const btn = document.getElementById('mv-axes');
      btn.style.background = state.showAxes ? 'rgba(0,240,255,0.15)' : '#1a1a1a';
      btn.style.color = state.showAxes ? 'var(--nexus-cyan)' : '#ccc';
    });

    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        const dist = camera.position.length();
        const target = controls ? controls.target : new THREE.Vector3(0, 0, 0);
        switch (view) {
          case 'front': camera.position.set(target.x, target.y, target.z + dist); break;
          case 'back': camera.position.set(target.x, target.y, target.z - dist); break;
          case 'top': camera.position.set(target.x, target.y + dist, target.z + 0.001); break;
          case 'bottom': camera.position.set(target.x, target.y - dist, target.z + 0.001); break;
          case 'left': camera.position.set(target.x - dist, target.y, target.z); break;
          case 'right': camera.position.set(target.x + dist, target.y, target.z); break;
        }
        camera.lookAt(target);
        if (controls) controls.update();
      });
    });

    document.getElementById('mv-scale').addEventListener('input', (e) => {
      state.modelScale = parseFloat(e.target.value);
      if (state.model) state.model.scale.setScalar(state.modelScale);
    });

    document.getElementById('mv-bg').addEventListener('input', (e) => {
      state.backgroundColor = e.target.value;
      scene.background = new THREE.Color(e.target.value);
    });

    document.getElementById('mv-export').addEventListener('click', () => {
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = file.name.replace(/\.[^.]+$/, '') + '_render.png';
      a.click();
    });

    document.getElementById('mv-reset').addEventListener('click', () => {
      if (!state.model) return;
      const box = new THREE.Box3().setFromObject(state.model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const dist = maxDim * 2.5;
      camera.position.set(dist * 0.7, dist * 0.5, dist);
      camera.lookAt(0, 0, 0);
      if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
      }
      state.model.rotation.set(0, 0, 0);
    });

    return {
      getScene: () => scene,
      getCamera: () => camera,
      getRenderer: () => renderer,
      destroy: () => {
        if (state.animationId) cancelAnimationFrame(state.animationId);
        window.removeEventListener('resize', resizeHandler);
        renderer.dispose();
        if (state.model) {
          state.model.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              for (const m of mats) if (m) m.dispose();
            }
          });
        }
        viewport.innerHTML = '';
        style.remove();
      },
    };
  },
};
