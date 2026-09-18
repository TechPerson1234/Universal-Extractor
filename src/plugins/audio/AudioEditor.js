const WAVEFORM_BUCKETS = 1024;
const DEFAULT_ZOOM = 1;

export class AudioDecoder {
  constructor(blob) {
    this.blob = blob;
    this.audioContext = null;
    this.buffer = null;
  }

  async decode(onProgress) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('Web Audio API unavailable');
    this.audioContext = new AudioCtx();
    const arrayBuffer = await this.blob.arrayBuffer();
    const total = arrayBuffer.byteLength;
    if (onProgress) onProgress(0.1);
    this.buffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0), () => {}, (err) => {
      throw new Error('Decode failed: ' + err);
    });
    if (onProgress) onProgress(1);
    return this.buffer;
  }

  async decodeChunked(onProgress, chunkSize = 1024 * 1024) {
    if (this.blob.size <= chunkSize) return this.decode(onProgress);
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioCtx();
    const total = this.blob.size;
    let offset = 0;
    const chunks = [];
    while (offset < total) {
      const end = Math.min(offset + chunkSize, total);
      const chunk = this.blob.slice(offset, end);
      chunks.push(await chunk.arrayBuffer());
      offset = end;
      if (onProgress) onProgress(offset / total);
      await new Promise(r => setTimeout(r, 0));
    }
    const combined = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      combined.set(new Uint8Array(c), pos);
      pos += c.byteLength;
    }
    this.buffer = await this.audioContext.decodeAudioData(combined.buffer);
    return this.buffer;
  }

  getPeaks(count = WAVEFORM_BUCKETS) {
    if (!this.buffer) return new Float32Array(count);
    const channel = this.buffer.getChannelData(0);
    const blockSize = Math.floor(channel.length / count);
    const peaks = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let max = 0;
      const start = i * blockSize;
      const end = Math.min(start + blockSize, channel.length);
      for (let j = start; j < end; j++) {
        const v = Math.abs(channel[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    return peaks;
  }

  getChannelPeaks(count, channelIndex) {
    if (!this.buffer) return new Float32Array(count);
    const channel = this.buffer.getChannelData(channelIndex);
    const blockSize = Math.floor(channel.length / count);
    const peaks = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let max = 0;
      const start = i * blockSize;
      const end = Math.min(start + blockSize, channel.length);
      for (let j = start; j < end; j++) {
        const v = Math.abs(channel[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    return peaks;
  }

  getMetadata() {
    if (!this.buffer) return null;
    return {
      duration: this.buffer.duration,
      sampleRate: this.buffer.sampleRate,
      channels: this.buffer.numberOfChannels,
      length: this.buffer.length,
    };
  }

  async exportAsWav() {
    if (!this.buffer) return null;
    return this.bufferToWav(this.buffer);
  }

  bufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;
    const blockAlign = numChannels * bitDepth / 8;
    const byteRate = sampleRate * blockAlign;
    const dataSize = buffer.length * blockAlign;
    const headerSize = 44;
    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    const channelData = [];
    for (let i = 0; i < numChannels; i++) channelData.push(buffer.getChannelData(i));
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }
}

export class SpectrogramRenderer {
  constructor(buffer) {
    this.buffer = buffer;
    this.fftSize = 512;
    this.hopSize = 256;
  }

  async render(width, height, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const channel = this.buffer.getChannelData(0);
    const sampleRate = this.buffer.sampleRate;
    const totalSamples = channel.length;
    const frames = Math.floor((totalSamples - this.fftSize) / this.hopSize);

    const windowsPerPixel = Math.max(1, Math.floor(frames / width));
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    const window = new Float32Array(this.fftSize);
    for (let i = 0; i < this.fftSize; i++) {
      window[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (this.fftSize - 1));
    }

    let maxMag = 0.0001;

    for (let x = 0; x < width; x++) {
      const frameStart = Math.floor((x / width) * frames) * this.hopSize;
      const spectrum = this._computeFFT(channel, frameStart, window);
      for (let y = 0; y < height; y++) {
        const bin = Math.floor((1 - y / height) * (spectrum.length / 2));
        const mag = spectrum[bin] || 0;
        if (mag > maxMag) maxMag = mag;
      }
    }

    for (let x = 0; x < width; x++) {
      const frameStart = Math.floor((x / width) * frames) * this.hopSize;
      const spectrum = this._computeFFT(channel, frameStart, window);
      for (let y = 0; y < height; y++) {
        const bin = Math.floor((1 - y / height) * (spectrum.length / 2));
        const mag = spectrum[bin] || 0;
        const norm = Math.min(1, mag / maxMag);
        const intensity = Math.pow(norm, 0.4);
        const [r, g, b] = this._colorMap(intensity);
        const idx = (y * width + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
      if (x % 20 === 0 && options.onProgress) options.onProgress(x / width);
      if (x % 40 === 0) await new Promise(r => setTimeout(r, 0));
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  _computeFFT(samples, start, window) {
    const N = this.fftSize;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const s = samples[start + i] || 0;
      re[i] = s * window[i];
    }
    this._fft(re, im);
    const mag = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) {
      mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }
    return mag;
  }

  _fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wRe = Math.cos(ang);
      const wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curRe = 1, curIm = 0;
        for (let j = 0; j < len / 2; j++) {
          const uRe = re[i + j];
          const uIm = im[i + j];
          const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
          const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
          re[i + j] = uRe + vRe;
          im[i + j] = uIm + vIm;
          re[i + j + len / 2] = uRe - vRe;
          im[i + j + len / 2] = uIm - vIm;
          const newRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = newRe;
        }
      }
    }
  }

  _colorMap(v) {
    v = Math.max(0, Math.min(1, v));
    const stops = [
      [0, [10, 10, 40]],
      [0.25, [0, 100, 200]],
      [0.5, [0, 240, 255]],
      [0.75, [138, 43, 226]],
      [1, [255, 100, 100]],
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      if (v >= stops[i][0] && v <= stops[i + 1][0]) {
        const t = (v - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
        return stops[i][1].map((c, j) => Math.round(c + (stops[i + 1][1][j] - c) * t));
      }
    }
    return stops[stops.length - 1][1];
  }
}

export const AudioEditorPlugin = {
  type: 'AUDIO',
  name: 'Audio Editor',
  version: '2.0.0',

  async init(surface, tools, file) {
    const state = {
      audioEl: null,
      buffer: null,
      decoder: null,
      waveformCanvas: null,
      spectrogramCanvas: null,
      playhead: 0,
      selection: null,
      viewMode: 'waveform',
      zoom: 1,
      scrollLeft: 0,
      peaks: null,
    };

    surface.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:#0a0a0a;overflow:hidden;">
        <div id="ae-tabs" style="display:flex;gap:4px;padding:6px 8px;background:#0f0f0f;border-bottom:1px solid #222;flex-shrink:0;">
          <button data-view="waveform" class="ae-tab" style="padding:4px 12px;background:rgba(0,240,255,0.15);border:1px solid var(--nexus-cyan);color:var(--nexus-cyan);border-radius:3px;font-size:11px;cursor:pointer;">Waveform</button>
          <button data-view="spectrogram" class="ae-tab" style="padding:4px 12px;background:transparent;border:1px solid #333;color:#888;border-radius:3px;font-size:11px;cursor:pointer;">Spectrogram</button>
          <button data-view="both" class="ae-tab" style="padding:4px 12px;background:transparent;border:1px solid #333;color:#888;border-radius:3px;font-size:11px;cursor:pointer;">Both</button>
        </div>
        <div id="ae-wave-wrap" style="flex:1;position:relative;overflow:hidden;background:#050505;min-height:80px;">
          <canvas id="ae-waveform" style="width:100%;height:100%;cursor:pointer;"></canvas>
          <div id="ae-playhead" style="position:absolute;top:0;bottom:0;width:2px;background:var(--nexus-cyan);pointer-events:none;box-shadow:0 0 8px var(--nexus-cyan);left:0;"></div>
          <div id="ae-selection" style="position:absolute;top:0;bottom:0;background:rgba(138,43,226,0.25);border-left:1px solid #8a2be2;border-right:1px solid #8a2be2;display:none;pointer-events:none;"></div>
        </div>
        <div id="ae-spectro-wrap" style="flex:1;position:relative;overflow:hidden;background:#000;display:none;min-height:80px;">
          <canvas id="ae-spectrogram" style="width:100%;height:100%;"></canvas>
        </div>
        <div id="ae-controls" style="height:52px;background:#0f0f0f;border-top:1px solid #222;display:flex;align-items:center;padding:0 12px;gap:10px;flex-shrink:0;flex-wrap:wrap;">
          <button id="ae-play" style="background:transparent;border:none;color:#ccc;cursor:pointer;font-size:16px;padding:6px;"><i class="fas fa-play"></i></button>
          <button id="ae-stop" style="background:transparent;border:none;color:#ccc;cursor:pointer;font-size:14px;padding:6px;"><i class="fas fa-stop"></i></button>
          <span id="ae-time" style="font-family:monospace;font-size:11px;color:#ccc;min-width:80px;">00:00.00</span>
          <span style="color:#333;">/</span>
          <span id="ae-duration" style="font-family:monospace;font-size:11px;color:#666;min-width:80px;">00:00.00</span>
          <div style="flex:1;"></div>
          <div style="display:flex;align-items:center;gap:6px;">
            <i class="fas fa-volume-up" style="color:#666;font-size:11px;"></i>
            <input id="ae-volume" type="range" min="0" max="1" step="0.01" value="1" style="width:80px;accent-color:var(--nexus-cyan);">
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <i class="fas fa-tachometer-alt" style="color:#666;font-size:11px;"></i>
            <select id="ae-speed" style="background:#0a0a0a;color:#ccc;border:1px solid #333;padding:2px 6px;border-radius:3px;font-size:11px;">
              <option value="0.5">0.5×</option>
              <option value="1" selected>1×</option>
              <option value="1.5">1.5×</option>
              <option value="2">2×</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <button id="ae-zoom-out" style="background:#1a1a1a;color:#ccc;border:1px solid #333;padding:2px 6px;border-radius:3px;font-size:10px;cursor:pointer;">−</button>
            <span id="ae-zoom-label" style="font-size:10px;color:#666;font-family:monospace;min-width:32px;text-align:center;">1.0×</span>
            <button id="ae-zoom-in" style="background:#1a1a1a;color:#ccc;border:1px solid #333;padding:2px 6px;border-radius:3px;font-size:10px;cursor:pointer;">+</button>
          </div>
        </div>
      </div>
    `;

    tools.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button id="ae-save" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;font-size:12px;">
          <i class="fas fa-save"></i> Save as WAV
        </button>
        <button id="ae-export" style="background:#222;color:#ccc;border:1px solid #555;padding:6px;border-radius:3px;cursor:pointer;font-size:12px;">
          <i class="fas fa-download"></i> Export Copy
        </button>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Selection</label>
          <div style="display:flex;gap:4px;">
            <button id="ae-sel-all" style="flex:1;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">All</button>
            <button id="ae-sel-clear" style="flex:1;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Clear</button>
          </div>
          <div id="ae-sel-info" style="font-size:10px;color:#666;font-family:monospace;margin-top:4px;">No selection</div>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Edit</label>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <button id="ae-trim" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">
              <i class="fas fa-crop"></i> Trim to Selection
            </button>
            <button id="ae-fade-in" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">
              <i class="fas fa-arrow-up"></i> Fade In
            </button>
            <button id="ae-fade-out" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">
              <i class="fas fa-arrow-down"></i> Fade Out
            </button>
            <button id="ae-normalize" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">
              <i class="fas fa-compress-arrows-alt"></i> Normalize
            </button>
            <button id="ae-reverse" style="padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">
              <i class="fas fa-exchange-alt"></i> Reverse
            </button>
          </div>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Info</label>
          <div id="ae-meta" style="font-size:10px;color:#666;font-family:monospace;line-height:1.6;"></div>
        </div>
      </div>
    `;

    const url = URL.createObjectURL(file.blob);
    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    state.audioEl = audio;

    const decoder = new AudioDecoder(file.blob);
    state.decoder = decoder;

    const waveCanvas = document.getElementById('ae-waveform');
    const spectroCanvas = document.getElementById('ae-spectrogram');
    state.waveformCanvas = waveCanvas;
    state.spectrogramCanvas = spectroCanvas;

    const playhead = document.getElementById('ae-playhead');
    const selEl = document.getElementById('ae-selection');

    const formatTime = (sec) => {
      if (!isFinite(sec)) return '00:00.00';
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      const ms = Math.floor((sec % 1) * 100);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    };

    const drawWaveform = () => {
      if (!state.peaks) return;
      const wrap = waveCanvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      waveCanvas.width = w * dpr;
      waveCanvas.height = h * dpr;
      waveCanvas.style.width = w + 'px';
      waveCanvas.style.height = h + 'px';
      const ctx = waveCanvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, w, h);

      const mid = h / 2;
      const peaks = state.peaks;
      const visiblePeaks = peaks.length / state.zoom;
      const start = state.scrollLeft * peaks.length;

      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = (i / 4) * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      ctx.strokeStyle = 'var(--nexus-cyan)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x++) {
        const peakIdx = Math.floor(start + (x / w) * visiblePeaks);
        const p = peaks[peakIdx] || 0;
        const barH = p * (h * 0.45);
        ctx.beginPath();
        ctx.moveTo(x, mid - barH);
        ctx.lineTo(x, mid + barH);
        ctx.stroke();
      }

      const sel = state.selection;
      if (sel && audio.duration) {
        const leftPct = (sel.start / audio.duration);
        const rightPct = (sel.end / audio.duration);
        selEl.style.display = 'block';
        selEl.style.left = (leftPct * 100) + '%';
        selEl.style.width = ((rightPct - leftPct) * 100) + '%';
      } else {
        selEl.style.display = 'none';
      }
    };

    const drawSpectrogram = async () => {
      if (!state.buffer) return;
      const wrap = spectroCanvas.parentElement;
      const w = Math.min(2000, wrap.clientWidth);
      const h = wrap.clientHeight;
      const renderer = new SpectrogramRenderer(state.buffer);
      const canvas = await renderer.render(w, h);
      spectroCanvas.width = canvas.width;
      spectroCanvas.height = canvas.height;
      spectroCanvas.style.width = '100%';
      spectroCanvas.style.height = '100%';
      spectroCanvas.getContext('2d').drawImage(canvas, 0, 0);
    };

    const updatePlayhead = () => {
      if (!audio.duration) return;
      const pct = audio.currentTime / audio.duration;
      const wrap = waveCanvas.parentElement;
      playhead.style.left = (pct * wrap.clientWidth) + 'px';
      document.getElementById('ae-time').textContent = formatTime(audio.currentTime);
    };

    let scrubbing = false;
    waveCanvas.addEventListener('mousedown', (e) => {
      const rect = waveCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = x / rect.width;
      if (!e.shiftKey) {
        audio.currentTime = pct * audio.duration;
        updatePlayhead();
        scrubbing = true;
      } else {
        const t = pct * audio.duration;
        if (!state.selection) state.selection = { start: t, end: t };
        else if (Math.abs(t - state.selection.start) < Math.abs(t - state.selection.end)) state.selection.start = t;
        else state.selection.end = t;
        if (state.selection.start > state.selection.end) {
          [state.selection.start, state.selection.end] = [state.selection.end, state.selection.start];
        }
        document.getElementById('ae-sel-info').textContent = `${state.selection.start.toFixed(2)}s – ${state.selection.end.toFixed(2)}s (${(state.selection.end - state.selection.start).toFixed(2)}s)`;
        drawWaveform();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!scrubbing) return;
      const rect = waveCanvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const pct = x / rect.width;
      audio.currentTime = pct * audio.duration;
      updatePlayhead();
    });

    document.addEventListener('mouseup', () => { scrubbing = false; });

    audio.addEventListener('timeupdate', updatePlayhead);
    audio.addEventListener('loadedmetadata', () => {
      document.getElementById('ae-duration').textContent = formatTime(audio.duration);
    });
    audio.addEventListener('play', () => {
      document.getElementById('ae-play').innerHTML = '<i class="fas fa-pause"></i>';
    });
    audio.addEventListener('pause', () => {
      document.getElementById('ae-play').innerHTML = '<i class="fas fa-play"></i>';
    });
    audio.addEventListener('ended', () => {
      document.getElementById('ae-play').innerHTML = '<i class="fas fa-play"></i>';
    });

    document.getElementById('ae-play').addEventListener('click', () => {
      if (audio.paused) audio.play();
      else audio.pause();
    });

    document.getElementById('ae-stop').addEventListener('click', () => {
      audio.pause();
      audio.currentTime = 0;
      updatePlayhead();
    });

    document.getElementById('ae-volume').addEventListener('input', (e) => {
      audio.volume = parseFloat(e.target.value);
    });

    document.getElementById('ae-speed').addEventListener('change', (e) => {
      audio.playbackRate = parseFloat(e.target.value);
    });

    document.getElementById('ae-zoom-in').addEventListener('click', () => {
      state.zoom = Math.min(20, state.zoom * 1.5);
      document.getElementById('ae-zoom-label').textContent = state.zoom.toFixed(1) + '×';
      drawWaveform();
    });

    document.getElementById('ae-zoom-out').addEventListener('click', () => {
      state.zoom = Math.max(1, state.zoom / 1.5);
      document.getElementById('ae-zoom-label').textContent = state.zoom.toFixed(1) + '×';
      drawWaveform();
    });

    const setView = (view) => {
      state.viewMode = view;
      document.querySelectorAll('.ae-tab').forEach(t => {
        const active = t.dataset.view === view;
        t.style.background = active ? 'rgba(0,240,255,0.15)' : 'transparent';
        t.style.borderColor = active ? 'var(--nexus-cyan)' : '#333';
        t.style.color = active ? 'var(--nexus-cyan)' : '#888';
      });
      document.getElementById('ae-wave-wrap').style.display = view === 'spectrogram' ? 'none' : 'block';
      document.getElementById('ae-spectro-wrap').style.display = view === 'waveform' ? 'none' : 'block';
      if (view !== 'waveform' && state.buffer && !spectroCanvas.dataset.rendered) {
        drawSpectrogram().then(() => { spectroCanvas.dataset.rendered = '1'; });
      }
    };

    document.querySelectorAll('.ae-tab').forEach(t => {
      t.addEventListener('click', () => setView(t.dataset.view));
    });

    document.getElementById('ae-sel-all').addEventListener('click', () => {
      state.selection = { start: 0, end: audio.duration };
      document.getElementById('ae-sel-info').textContent = `0.00s – ${audio.duration.toFixed(2)}s (${audio.duration.toFixed(2)}s)`;
      drawWaveform();
    });

    document.getElementById('ae-sel-clear').addEventListener('click', () => {
      state.selection = null;
      document.getElementById('ae-sel-info').textContent = 'No selection';
      drawWaveform();
    });

    const applyBufferEdit = (editFn) => {
      if (!state.buffer) return;
      const newBuffer = editFn(state.buffer);
      state.buffer = newBuffer;
      state.peaks = decoder.getPeaks(WAVEFORM_BUCKETS);
      decoder.buffer = newBuffer;
      const wavBlob = decoder.bufferToWav(newBuffer);
      const newUrl = URL.createObjectURL(wavBlob);
      audio.src = newUrl;
      audio.load();
      drawWaveform();
      spectroCanvas.dataset.rendered = '';
      if (state.viewMode !== 'waveform') drawSpectrogram();
      window.__NEXUS_DI?.app?.notifications?.show('Buffer modified (preview)', 'info', 2000);
    };

    document.getElementById('ae-trim').addEventListener('click', () => {
      if (!state.selection || !state.buffer) return;
      const { start, end } = state.selection;
      const sr = state.buffer.sampleRate;
      const startSample = Math.floor(start * sr);
      const endSample = Math.floor(end * sr);
      const newLen = endSample - startSample;
      const ctx = decoder.audioContext;
      const newBuf = ctx.createBuffer(state.buffer.numberOfChannels, newLen, sr);
      for (let ch = 0; ch < state.buffer.numberOfChannels; ch++) {
        const src = state.buffer.getChannelData(ch);
        const dst = newBuf.getChannelData(ch);
        for (let i = 0; i < newLen; i++) dst[i] = src[startSample + i];
      }
      applyBufferEdit(() => newBuf);
      state.selection = null;
      document.getElementById('ae-sel-info').textContent = 'No selection';
    });

    document.getElementById('ae-fade-in').addEventListener('click', () => {
      if (!state.buffer) return;
      const sr = state.buffer.sampleRate;
      const dur = Math.min(1, state.buffer.duration);
      const samples = Math.floor(dur * sr);
      const ctx = decoder.audioContext;
      const newBuf = ctx.createBuffer(state.buffer.numberOfChannels, state.buffer.length, sr);
      for (let ch = 0; ch < state.buffer.numberOfChannels; ch++) {
        const src = state.buffer.getChannelData(ch);
        const dst = newBuf.getChannelData(ch);
        for (let i = 0; i < src.length; i++) {
          const gain = i < samples ? i / samples : 1;
          dst[i] = src[i] * gain;
        }
      }
      applyBufferEdit(() => newBuf);
    });

    document.getElementById('ae-fade-out').addEventListener('click', () => {
      if (!state.buffer) return;
      const sr = state.buffer.sampleRate;
      const dur = Math.min(1, state.buffer.duration);
      const samples = Math.floor(dur * sr);
      const total = state.buffer.length;
      const ctx = decoder.audioContext;
      const newBuf = ctx.createBuffer(state.buffer.numberOfChannels, total, sr);
      for (let ch = 0; ch < state.buffer.numberOfChannels; ch++) {
        const src = state.buffer.getChannelData(ch);
        const dst = newBuf.getChannelData(ch);
        for (let i = 0; i < total; i++) {
          const fromEnd = total - i;
          const gain = fromEnd < samples ? fromEnd / samples : 1;
          dst[i] = src[i] * gain;
        }
      }
      applyBufferEdit(() => newBuf);
    });

    document.getElementById('ae-normalize').addEventListener('click', () => {
      if (!state.buffer) return;
      let max = 0;
      for (let ch = 0; ch < state.buffer.numberOfChannels; ch++) {
        const data = state.buffer.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i]);
          if (v > max) max = v;
        }
      }
      if (max === 0) return;
      const gain = 1 / max;
      const ctx = decoder.audioContext;
      const newBuf = ctx.createBuffer(state.buffer.numberOfChannels, state.buffer.length, state.buffer.sampleRate);
      for (let ch = 0; ch < state.buffer.numberOfChannels; ch++) {
        const src = state.buffer.getChannelData(ch);
        const dst = newBuf.getChannelData(ch);
        for (let i = 0; i < src.length; i++) dst[i] = src[i] * gain;
      }
      applyBufferEdit(() => newBuf);
    });

    document.getElementById('ae-reverse').addEventListener('click', () => {
      if (!state.buffer) return;
      const ctx = decoder.audioContext;
      const newBuf = ctx.createBuffer(state.buffer.numberOfChannels, state.buffer.length, state.buffer.sampleRate);
      for (let ch = 0; ch < state.buffer.numberOfChannels; ch++) {
        const src = state.buffer.getChannelData(ch);
        const dst = newBuf.getChannelData(ch);
        for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
      }
      applyBufferEdit(() => newBuf);
    });

    document.getElementById('ae-save').addEventListener('click', async () => {
      if (!state.buffer) return;
      const wavBlob = decoder.bufferToWav(state.buffer);
      const app = window.__NEXUS_DI?.app;
      if (app?.vfs) {
        const newPath = file.path.replace(/\.[^.]+$/, '') + '.wav';
        await app.vfs.addFile(newPath, wavBlob, 'AUDIO');
        app.eventBus.emit('vfs:changed');
        app.notifications.show('Saved as WAV', 'success');
      }
    });

    document.getElementById('ae-export').addEventListener('click', () => {
      if (!state.buffer) return;
      const wavBlob = decoder.bufferToWav(state.buffer);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(wavBlob);
      a.download = file.name.replace(/\.[^.]+$/, '') + '.wav';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });

    try {
      await decoder.decodeChunked();
      state.buffer = decoder.buffer;
      state.peaks = decoder.getPeaks(WAVEFORM_BUCKETS);
      const meta = decoder.getMetadata();
      document.getElementById('ae-meta').innerHTML = `
        Duration: ${formatTime(meta.duration)}<br>
        Sample Rate: ${meta.sampleRate} Hz<br>
        Channels: ${meta.channels}<br>
        Samples: ${meta.length.toLocaleString()}
      `;
      document.getElementById('ae-duration').textContent = formatTime(meta.duration);
      drawWaveform();
      window.addEventListener('resize', drawWaveform);
    } catch (e) {
      surface.innerHTML = `<div style="padding:20px;color:#ff003c;font-family:monospace;">Decode failed: ${e.message}</div>`;
    }

    return {
      getBuffer: () => state.buffer,
      getSelection: () => state.selection,
      destroy: () => {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
        if (decoder.audioContext) decoder.audioContext.close().catch(() => {});
        window.removeEventListener('resize', drawWaveform);
      },
    };
  },
};
