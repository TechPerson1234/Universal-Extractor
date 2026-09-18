const SHADERS = {
  vertex: `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `,
  grayscale: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    void main() {
      vec4 c = texture2D(u_texture, v_texCoord);
      float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      gl_FragColor = vec4(g, g, g, c.a);
    }
  `,
  sepia: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    void main() {
      vec4 c = texture2D(u_texture, v_texCoord);
      gl_FragColor = vec4(
        dot(c.rgb, vec3(0.393, 0.769, 0.189)),
        dot(c.rgb, vec3(0.349, 0.686, 0.168)),
        dot(c.rgb, vec3(0.272, 0.534, 0.131)),
        c.a
      );
    }
  `,
  invert: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    void main() {
      vec4 c = texture2D(u_texture, v_texCoord);
      gl_FragColor = vec4(1.0 - c.rgb, c.a);
    }
  `,
  vignette: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform float u_strength;
    void main() {
      vec4 c = texture2D(u_texture, v_texCoord);
      vec2 uv = v_texCoord - 0.5;
      float v = 1.0 - dot(uv, uv) * u_strength;
      gl_FragColor = vec4(c.rgb * v, c.a);
    }
  `,
  chromatic: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform float u_offset;
    void main() {
      float r = texture2D(u_texture, v_texCoord + vec2(u_offset, 0.0)).r;
      float g = texture2D(u_texture, v_texCoord).g;
      float b = texture2D(u_texture, v_texCoord - vec2(u_offset, 0.0)).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
  scanlines: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform float u_density;
    void main() {
      vec4 c = texture2D(u_texture, v_texCoord);
      float scan = sin(v_texCoord.y * u_density) * 0.5 + 0.5;
      gl_FragColor = vec4(c.rgb * (0.7 + scan * 0.3), c.a);
    }
  `,
  pixelate: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform vec2 u_size;
    uniform float u_amount;
    void main() {
      vec2 px = u_amount / u_size;
      vec2 uv = floor(v_texCoord / px) * px + px * 0.5;
      gl_FragColor = texture2D(u_texture, uv);
    }
  `,
  hue: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform float u_shift;
    vec3 hueShift(vec3 color, float angle) {
      const vec3 k = vec3(0.57735);
      float cosA = cos(angle);
      return color * cosA + cross(k, color) * sin(angle) + k * dot(k, color) * (1.0 - cosA);
    }
    void main() {
      vec4 c = texture2D(u_texture, v_texCoord);
      gl_FragColor = vec4(hueShift(c.rgb, u_shift), c.a);
    }
  `,
  wave: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform float u_amplitude;
    void main() {
      vec2 uv = v_texCoord;
      uv.x += sin(uv.y * 20.0 + u_time * 3.0) * u_amplitude;
      gl_FragColor = texture2D(u_texture, uv);
    }
  `,
  swirl: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform float u_strength;
    void main() {
      vec2 uv = v_texCoord - 0.5;
      float r = length(uv);
      float a = atan(uv.y, uv.x) + u_strength * (0.5 - r) * sin(u_time);
      vec2 nuv = vec2(cos(a), sin(a)) * r + 0.5;
      gl_FragColor = texture2D(u_texture, nuv);
    }
  `,
  glitch: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform float u_amount;
    float rand(vec2 co) { return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      vec2 uv = v_texCoord;
      float row = floor(uv.y * 40.0);
      float shift = (rand(vec2(row, floor(u_time * 10.0))) - 0.5) * u_amount;
      if (rand(vec2(row, floor(u_time * 8.0))) > 0.92) {
        uv.x += shift;
      }
      vec4 c = texture2D(u_texture, uv);
      float r = texture2D(u_texture, uv + vec2(0.005, 0.0)).r;
      float b = texture2D(u_texture, uv - vec2(0.005, 0.0)).b;
      gl_FragColor = vec4(r, c.g, b, c.a);
    }
  `,
  bloom: `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform vec2 u_texelSize;
    uniform float u_threshold;
    uniform float u_intensity;
    void main() {
      vec4 c = texture2D(u_texture, v_texCoord);
      vec3 bloom = vec3(0.0);
      for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
          vec2 offset = vec2(float(i), float(j)) * u_texelSize * 3.0;
          vec3 sample = texture2D(u_texture, v_texCoord + offset).rgb;
          float lum = dot(sample, vec3(0.299, 0.587, 0.114));
          if (lum > u_threshold) bloom += sample;
        }
      }
      gl_FragColor = vec4(c.rgb + bloom * u_intensity, c.a);
    }
  `,
};

export class WebGLVideoEffect {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { preserveDrawingBuffer: true }) ||
              canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('WebGL not supported');
    this.programs = new Map();
    this.texture = null;
    this.buffers = null;
    this._init();
  }

  _init() {
    const gl = this.gl;
    const vertices = new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]);
    const indices = new Uint16Array([0, 1, 2, 1, 3, 2]);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    this.buffers = { vbo, ibo };

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  getProgram(name) {
    if (this.programs.has(name)) return this.programs.get(name);
    const gl = this.gl;
    const frag = SHADERS[name];
    if (!frag) throw new Error(`Unknown shader: ${name}`);
    const program = this._compile(SHADERS.vertex, frag);
    this.programs.set(name, program);
    return program;
  }

  _compile(vsSource, fsSource) {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error('Vertex compile: ' + gl.getShaderInfoLog(vs));
    }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error('Fragment compile: ' + gl.getShaderInfoLog(fs));
    }
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Link: ' + gl.getProgramInfoLog(program));
    }
    return program;
  }

  apply(source, effectName, uniforms = {}) {
    const gl = this.gl;
    const program = this.getProgram(effectName);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(program);

    const vbo = this.buffers.vbo;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const aPos = gl.getAttribLocation(program, 'a_position');
    const aTex = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const uTex = gl.getUniformLocation(program, 'u_texture');
    if (uTex) gl.uniform1i(uTex, 0);

    for (const [key, value] of Object.entries(uniforms)) {
      const loc = gl.getUniformLocation(program, key);
      if (!loc) continue;
      if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2fv(loc, value);
        else if (value.length === 3) gl.uniform3fv(loc, value);
        else if (value.length === 4) gl.uniform4fv(loc, value);
      } else if (typeof value === 'number') {
        gl.uniform1f(loc, value);
      }
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.ibo);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  destroy() {
    const gl = this.gl;
    if (!gl) return;
    for (const program of this.programs.values()) gl.deleteProgram(program);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.buffers) {
      gl.deleteBuffer(this.buffers.vbo);
      gl.deleteBuffer(this.buffers.ibo);
    }
  }
}

export class VideoEffectsChain {
  constructor(videoEl) {
    this.video = videoEl;
    this.canvas = document.createElement('canvas');
    this.canvas.width = videoEl.videoWidth || 640;
    this.canvas.height = videoEl.videoHeight || 480;
    this.effect = null;
    this.effects = [];
    this._rafId = null;
    this._running = false;
  }

  async init() {
    try {
      this.effect = new WebGLVideoEffect(this.canvas);
      return true;
    } catch (e) {
      console.warn('WebGL unavailable:', e);
      return false;
    }
  }

  addEffect(name, uniforms = {}) {
    this.effects.push({ name, uniforms });
  }

  removeEffect(name) {
    this.effects = this.effects.filter(e => e.name !== name);
  }

  clearEffects() {
    this.effects = [];
  }

  start() {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      if (this.video.readyState >= 2) {
        if (this.canvas.width !== this.video.videoWidth) {
          this.canvas.width = this.video.videoWidth;
          this.canvas.height = this.video.videoHeight;
        }
        if (this.effects.length === 0) {
          const ctx = this.canvas.getContext('2d');
          ctx.drawImage(this.video, 0, 0);
        } else {
          const { name, uniforms } = this.effects[this.effects.length - 1];
          const dynamicUniforms = {
            u_time: performance.now() / 1000,
            u_texelSize: [1 / this.canvas.width, 1 / this.canvas.height],
            u_size: [this.canvas.width, this.canvas.height],
            ...uniforms,
          };
          this.effect.apply(this.video, name, dynamicUniforms);
        }
      }
      this._rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  destroy() {
    this.stop();
    if (this.effect) this.effect.destroy();
  }
}

export const VideoEffectsPlugin = {
  type: 'VIDEO_EFFECTS',
  name: 'Video Effects',

  async init(surface, tools, file) {
    const EFFECTS = [
      { id: 'grayscale', label: 'Grayscale', uniforms: {} },
      { id: 'sepia', label: 'Sepia', uniforms: {} },
      { id: 'invert', label: 'Invert', uniforms: {} },
      { id: 'vignette', label: 'Vignette', uniforms: { u_strength: 1.5 } },
      { id: 'chromatic', label: 'Chromatic', uniforms: { u_offset: 0.005 } },
      { id: 'scanlines', label: 'Scanlines', uniforms: { u_density: 200 } },
      { id: 'pixelate', label: 'Pixelate', uniforms: { u_amount: 8 } },
      { id: 'hue', label: 'Hue Shift', uniforms: { u_shift: 1.0 } },
      { id: 'wave', label: 'Wave', uniforms: { u_amplitude: 0.02 } },
      { id: 'swirl', label: 'Swirl', uniforms: { u_strength: 3.0 } },
      { id: 'glitch', label: 'Glitch', uniforms: { u_amount: 0.05 } },
      { id: 'bloom', label: 'Bloom', uniforms: { u_threshold: 0.6, u_intensity: 0.5 } },
    ];

    surface.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:#000;overflow:hidden;">
        <video id="vfx-video" style="display:none;" muted playsinline></video>
        <div style="flex:1;position:relative;display:flex;align-items:center;justify-content:center;background:#000;">
          <canvas id="vfx-canvas" style="max-width:100%;max-height:100%;"></canvas>
          <video id="vfx-preview-video" controls playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;"></video>
        </div>
        <div id="vfx-info" style="height:24px;background:#0a0a0a;border-top:1px solid #222;display:flex;align-items:center;padding:0 12px;font-size:10px;font-family:monospace;color:#666;">
          <span>GPU-Accelerated Effects</span>
        </div>
      </div>
    `;

    tools.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Effects</label>
          <div id="vfx-list" style="display:flex;flex-direction:column;gap:4px;"></div>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Effect Parameters</label>
          <div id="vfx-params" style="font-size:11px;color:#888;">Select an effect</div>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Transitions</label>
          <select id="vfx-transition" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;border-radius:3px;font-size:11px;">
            <option value="">None</option>
            <option value="fade">Fade</option>
            <option value="glitch">Glitch</option>
            <option value="blur">Blur</option>
            <option value="zoom">Zoom</option>
          </select>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <button id="vfx-apply" style="width:100%;padding:8px;background:var(--nexus-cyan);color:#000;border:none;border-radius:4px;font-weight:bold;cursor:pointer;font-size:12px;">
            <i class="fas fa-save"></i> Export with Effects
          </button>
          <button id="vfx-clear" style="width:100%;margin-top:6px;padding:6px;background:transparent;color:#ff003c;border:1px solid #ff003c;border-radius:4px;font-size:11px;cursor:pointer;">
            Clear All Effects
          </button>
        </div>
      </div>
    `;

    const url = URL.createObjectURL(file.blob);
    const hiddenVideo = document.getElementById('vfx-video');
    hiddenVideo.src = url;
    const previewVideo = document.getElementById('vfx-preview-video');
    previewVideo.src = url;
    const canvas = document.getElementById('vfx-canvas');

    const chain = new VideoEffectsChain(hiddenVideo);
    const glSupported = await chain.init();

    if (!glSupported) {
      surface.innerHTML = '<div style="padding:20px;color:#ff003c;font-family:monospace;">WebGL not supported</div>';
      return { destroy: () => URL.revokeObjectURL(url) };
    }

    const activeEffects = new Map();
    const state = { previewMode: false };

    const listEl = document.getElementById('vfx-list');
    for (const effect of EFFECTS) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:11px;color:#ccc;padding:4px 6px;background:#0f0f0f;border:1px solid #222;border-radius:3px;cursor:pointer;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.style.cssText = 'accent-color:var(--nexus-cyan);';
      cb.addEventListener('change', () => {
        if (cb.checked) {
          activeEffects.set(effect.id, { ...effect.uniforms });
          chain.addEffect(effect.id, effect.uniforms);
          renderParams(effect.id);
        } else {
          activeEffects.delete(effect.id);
          chain.removeEffect(effect.id);
          renderParams(activeEffects.size ? Array.from(activeEffects.keys())[0] : null);
        }
        updateCanvas();
      });
      row.appendChild(cb);
      row.appendChild(document.createTextNode(effect.label));
      listEl.appendChild(row);
    }

    const renderParams = (effectId) => {
      const panel = document.getElementById('vfx-params');
      if (!effectId) {
        panel.innerHTML = '<div style="color:#666;">Select an effect</div>';
        return;
      }
      const effect = EFFECTS.find(e => e.id === effectId);
      const current = activeEffects.get(effectId);
      panel.innerHTML = '';
      for (const [key, value] of Object.entries(current)) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
        const lbl = document.createElement('span');
        lbl.textContent = key.replace('u_', '');
        lbl.style.cssText = 'font-size:10px;color:#888;flex:1;';
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = 0;
        inp.max = key.includes('threshold') ? 1 : 20;
        inp.step = 0.01;
        inp.value = value;
        inp.style.cssText = 'flex:1;accent-color:var(--nexus-cyan);';
        const valSpan = document.createElement('span');
        valSpan.textContent = value.toFixed(2);
        valSpan.style.cssText = 'font-size:10px;color:#666;min-width:34px;text-align:right;font-family:monospace;';
        inp.addEventListener('input', () => {
          const v = parseFloat(inp.value);
          current[key] = v;
          valSpan.textContent = v.toFixed(2);
          chain.clearEffects();
          for (const [id, uniforms] of activeEffects) chain.addEffect(id, uniforms);
          updateCanvas();
        });
        wrap.appendChild(lbl);
        wrap.appendChild(inp);
        wrap.appendChild(valSpan);
        panel.appendChild(wrap);
      }
    };

    const updateCanvas = () => {
      if (!state.previewMode) {
        previewVideo.style.display = 'block';
        canvas.style.display = 'none';
        return;
      }
      previewVideo.style.display = 'none';
      canvas.style.display = 'block';
      if (activeEffects.size === 0) {
        const ctx = canvas.getContext('2d');
        canvas.width = hiddenVideo.videoWidth || 640;
        canvas.height = hiddenVideo.videoHeight || 480;
        ctx.drawImage(hiddenVideo, 0, 0);
      } else {
        hiddenVideo.currentTime = previewVideo.currentTime;
        hiddenVideo.play().catch(() => {});
        setTimeout(() => {
          hiddenVideo.pause();
          const last = Array.from(activeEffects.entries()).pop();
          chain.effect.apply(hiddenVideo, last[0], {
            ...last[1],
            u_time: performance.now() / 1000,
            u_texelSize: [1 / canvas.width, 1 / canvas.height],
            u_size: [canvas.width, canvas.height],
          });
          previewVideo.play().catch(() => {});
        }, 100);
      }
    };

    previewVideo.addEventListener('play', () => {
      if (activeEffects.size) {
        state.previewMode = true;
        hiddenVideo.currentTime = previewVideo.currentTime;
        hiddenVideo.play();
        chain.start();
        canvas.style.display = 'block';
        previewVideo.style.opacity = '0';
      }
    });

    previewVideo.addEventListener('pause', () => {
      chain.stop();
      hiddenVideo.pause();
      canvas.style.display = 'block';
      previewVideo.style.opacity = '1';
    });

    previewVideo.addEventListener('seeking', () => {
      hiddenVideo.currentTime = previewVideo.currentTime;
    });

    const syncLoop = setInterval(() => {
      if (activeEffects.size && !previewVideo.paused) {
        previewVideo.style.opacity = '0';
        canvas.style.display = 'block';
        if (!chain._running) chain.start();
      } else {
        chain.stop();
        previewVideo.style.opacity = '1';
        canvas.style.display = 'none';
      }
    }, 100);

    document.getElementById('vfx-apply').addEventListener('click', async () => {
      const app = window.__NEXUS_DI?.app;
      app?.notifications?.show('Effects applied in preview mode. Full export requires encoder integration.', 'info', 4000);
    });

    document.getElementById('vfx-clear').addEventListener('click', () => {
      activeEffects.clear();
      chain.clearEffects();
      listEl.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
      renderParams(null);
      chain.stop();
      previewVideo.style.opacity = '1';
      canvas.style.display = 'none';
    });

    return {
      chain,
      destroy: () => {
        clearInterval(syncLoop);
        chain.destroy();
        URL.revokeObjectURL(url);
        previewVideo.pause();
        previewVideo.removeAttribute('src');
        hiddenVideo.removeAttribute('src');
      },
    };
  },
};
