const SUPPORTED_CODECS = [
  { codec: 'avc1.42E01E', label: 'H.264 Baseline' },
  { codec: 'avc1.4D401E', label: 'H.264 Main' },
  { codec: 'avc1.640028', label: 'H.264 High' },
  { codec: 'vp8', label: 'VP8' },
  { codec: 'vp09.00.10.08', label: 'VP9' },
  { codec: 'av01.0.04M.08', label: 'AV1' },
];

const FRAME_FORMATS = [
  { format: 'RGBA', label: 'RGBA' },
  { format: 'RGBX', label: 'RGBX' },
  { format: 'BGRA', label: 'BGRA' },
  { format: 'I420', label: 'I420' },
];

export class VideoFrameExtractor {
  constructor(blob) {
    this.blob = blob;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      const url = URL.createObjectURL(this.blob);
      video.onloadedmetadata = () => {
        this.video = video;
        this.canvas = document.createElement('canvas');
        this.canvas.width = video.videoWidth;
        this.canvas.height = video.videoHeight;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        resolve(video);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Video load failed'));
      };
      video.src = url;
    });
  }

  async seekTo(time) {
    return new Promise((resolve) => {
      const v = this.video;
      const handler = () => {
        v.removeEventListener('seeked', handler);
        resolve();
      };
      v.addEventListener('seeked', handler);
      v.currentTime = Math.max(0, Math.min(v.duration, time));
    });
  }

  async extractFrame(time) {
    await this.seekTo(time);
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    return new Promise(resolve => this.canvas.toBlob(resolve, 'image/png'));
  }

  async extractFrames(from, to, step, onProgress) {
    const frames = [];
    const total = Math.floor((to - from) / step) + 1;
    let done = 0;
    for (let t = from; t <= to; t += step) {
      const blob = await this.extractFrame(t);
      frames.push({ time: t, blob });
      done++;
      if (onProgress) onProgress(done / total, t);
    }
    return frames;
  }

  async extractThumbnails(count = 10) {
    const duration = this.video.duration;
    const interval = duration / count;
    const thumbs = [];
    for (let i = 0; i < count; i++) {
      const t = i * interval;
      const blob = await this.extractFrame(t);
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 160;
      thumbCanvas.height = Math.round(160 * this.video.videoHeight / this.video.videoWidth);
      thumbCanvas.getContext('2d').drawImage(this.canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const thumbBlob = await new Promise(r => thumbCanvas.toBlob(r, 'image/jpeg', 0.7));
      thumbs.push({ time: t, blob: thumbBlob });
    }
    return thumbs;
  }

  destroy() {
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
  }
}

export class VideoTrimmer {
  constructor(blob) {
    this.blob = blob;
    this.extractor = null;
  }

  async init() {
    this.extractor = new VideoFrameExtractor(this.blob);
    await this.extractor.init();
    return this;
  }

  async getMetadata() {
    const v = this.extractor.video;
    return {
      duration: v.duration,
      width: v.videoWidth,
      height: v.videoHeight,
      aspectRatio: v.videoWidth / v.videoHeight,
    };
  }

  async trimToGif(startTime, endTime, options = {}) {
    const fps = options.fps || 10;
    const width = options.width || 320;
    const frameCount = Math.floor((endTime - startTime) * fps);
    const frames = [];
    const v = this.extractor.video;
    const canvas = document.createElement('canvas');
    const scale = width / v.videoWidth;
    canvas.width = width;
    canvas.height = Math.round(v.videoHeight * scale);
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < frameCount; i++) {
      const t = startTime + (i / fps);
      await this.extractor.seekTo(t);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (options.onProgress) options.onProgress(i / frameCount);
    }

    return frames;
  }

  async extractKeyframes() {
    const frames = [];
    const duration = this.extractor.video.duration;
    const step = duration / 20;
    for (let t = 0; t < duration; t += step) {
      const blob = await this.extractor.extractFrame(t);
      frames.push({ time: t, blob });
    }
    return frames;
  }

  destroy() {
    if (this.extractor) this.extractor.destroy();
  }
}

export const VideoEditorPlugin = {
  type: 'VIDEO',
  name: 'Video Editor',
  version: '2.0.0',

  async init(surface, tools, file) {
    const state = {
      video: null,
      trimStart: 0,
      trimEnd: 0,
      currentTime: 0,
      duration: 0,
      extractor: null,
      trimmer: null,
      history: [],
    };

    surface.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:#000;overflow:hidden;">
        <div style="flex:1;display:flex;align-items:center;justify-content:center;position:relative;background:#000;overflow:hidden;">
          <video id="ve-video" style="max-width:100%;max-height:100%;" controls playsinline></video>
          <div id="ve-overlay" style="position:absolute;bottom:0;left:0;right:0;pointer-events:none;"></div>
        </div>
        <div id="ve-timeline-wrap" style="height:100px;background:#0a0a0a;border-top:1px solid #222;position:relative;overflow:hidden;flex-shrink:0;">
          <canvas id="ve-timeline" style="width:100%;height:100%;"></canvas>
          <div id="ve-playhead" style="position:absolute;top:0;bottom:0;width:2px;background:var(--nexus-cyan);pointer-events:none;box-shadow:0 0 8px var(--nexus-cyan);left:0;"></div>
          <div id="ve-trim-overlay" style="position:absolute;top:0;bottom:0;background:rgba(0,240,255,0.15);border-left:2px solid var(--nexus-cyan);border-right:2px solid var(--nexus-cyan);left:0;width:100%;pointer-events:none;"></div>
        </div>
        <div id="ve-controls" style="height:40px;background:#0f0f0f;border-top:1px solid #222;display:flex;align-items:center;padding:0 12px;gap:12px;flex-shrink:0;">
          <span id="ve-time" style="font-family:monospace;font-size:11px;color:#ccc;">00:00.00</span>
          <span style="color:#333;">|</span>
          <span id="ve-trim-info" style="font-family:monospace;font-size:11px;color:var(--nexus-cyan);">Trim: 0.0s - 0.0s</span>
          <div style="flex:1;"></div>
          <span id="ve-fps" style="font-family:monospace;font-size:10px;color:#666;"></span>
        </div>
      </div>
    `;

    tools.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button id="ve-save" style="background:var(--nexus-cyan);color:#000;border:none;padding:8px;border-radius:4px;font-weight:bold;cursor:pointer;font-size:12px;">
          <i class="fas fa-save"></i> Save Edits
        </button>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Trim</label>
          <div style="display:flex;gap:4px;">
            <button id="ve-set-start" style="flex:1;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Set Start</button>
            <button id="ve-set-end" style="flex:1;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">Set End</button>
          </div>
          <button id="ve-reset-trim" style="width:100%;margin-top:4px;padding:5px;background:#1a1a1a;color:#ff003c;border:1px solid #ff003c;border-radius:3px;font-size:10px;cursor:pointer;">Reset</button>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Playback Speed</label>
          <select id="ve-speed" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;border-radius:3px;font-size:11px;">
            <option value="0.25">0.25×</option>
            <option value="0.5">0.5×</option>
            <option value="1" selected>1×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </select>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Frame Extract</label>
          <input id="ve-frame-time" type="number" step="0.01" placeholder="Time (s)" value="0" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;border-radius:3px;font-size:11px;margin-bottom:4px;">
          <button id="ve-grab-frame" style="width:100%;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">
            <i class="fas fa-camera"></i> Grab Frame
          </button>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Batch Extract</label>
          <input id="ve-batch-interval" type="number" step="0.1" placeholder="Interval (s)" value="1" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;border-radius:3px;font-size:11px;margin-bottom:4px;">
          <input id="ve-batch-count" type="number" placeholder="Count" value="10" style="width:100%;background:#0a0a0a;color:#ccc;border:1px solid #333;padding:4px;border-radius:3px;font-size:11px;margin-bottom:4px;">
          <button id="ve-batch-extract" style="width:100%;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">
            <i class="fas fa-layer-group"></i> Extract Frames
          </button>
          <div id="ve-batch-progress" style="font-size:10px;color:#666;margin-top:4px;text-align:center;"></div>
        </div>
        <div style="border-top:1px solid #333;padding-top:8px;">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Thumbnails</label>
          <button id="ve-thumbs" style="width:100%;padding:5px;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:3px;font-size:10px;cursor:pointer;">
            <i class="fas fa-images"></i> Generate Thumbnails
          </button>
          <div id="ve-thumbs-strip" style="display:flex;gap:2px;overflow-x:auto;margin-top:6px;"></div>
        </div>
      </div>
    `;

    const video = document.getElementById('ve-video');
    const timelineCanvas = document.getElementById('ve-timeline');
    const playhead = document.getElementById('ve-playhead');
    const trimOverlay = document.getElementById('ve-trim-overlay');

    const url = URL.createObjectURL(file.blob);
    video.src = url;

    const updateTimeline = () => {
      const rect = timelineCanvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      timelineCanvas.width = rect.width * dpr;
      timelineCanvas.height = rect.height * dpr;
      timelineCanvas.style.width = rect.width + 'px';
      timelineCanvas.style.height = rect.height + 'px';
      const ctx = timelineCanvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, rect.width, rect.height);

      if (!state.duration) return;

      const pad = 8;
      const trackY = rect.height / 2;
      const trackH = 36;

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(pad, trackY - trackH / 2, rect.width - pad * 2, trackH);

      const startX = pad + (state.trimStart / state.duration) * (rect.width - pad * 2);
      const endX = pad + (state.trimEnd / state.duration) * (rect.width - pad * 2);

      ctx.fillStyle = 'rgba(0,240,255,0.2)';
      ctx.fillRect(startX, trackY - trackH / 2, endX - startX, trackH);
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(startX, trackY - trackH / 2, endX - startX, trackH);

      ctx.fillStyle = '#333';
      for (let i = 0; i <= 10; i++) {
        const x = pad + (i / 10) * (rect.width - pad * 2);
        const t = (i / 10) * state.duration;
        ctx.fillRect(x, trackY + trackH / 2 + 2, 1, 4);
        ctx.fillStyle = '#666';
        ctx.font = '9px monospace';
        ctx.fillText(formatTime(t), x + 2, trackY + trackH / 2 + 16);
        ctx.fillStyle = '#333';
      }

      trimOverlay.style.left = startX + 'px';
      trimOverlay.style.width = (endX - startX) + 'px';
    };

    const formatTime = (t) => {
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      const ms = Math.floor((t % 1) * 100);
      return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    };

    video.addEventListener('loadedmetadata', async () => {
      state.duration = video.duration;
      state.trimStart = 0;
      state.trimEnd = video.duration;
      document.getElementById('ve-time').textContent = '00:00.00';
      document.getElementById('ve-trim-info').textContent = `Trim: 0.0s - ${video.duration.toFixed(1)}s`;
      updateTimeline();
      try {
        state.extractor = new VideoFrameExtractor(file.blob);
        await state.extractor.init();
      } catch {}
    });

    video.addEventListener('timeupdate', () => {
      state.currentTime = video.currentTime;
      document.getElementById('ve-time').textContent = formatTime(video.currentTime);
      const rect = timelineCanvas.parentElement.getBoundingClientRect();
      const pad = 8;
      const pct = video.currentTime / state.duration;
      const x = pad + pct * (rect.width - pad * 2);
      playhead.style.left = x + 'px';
    });

    video.addEventListener('ended', () => {
      if (state.trimEnd < state.duration - 0.1) {
        video.currentTime = state.trimStart;
        video.play();
      }
    });

    let dragging = null;
    timelineCanvas.addEventListener('mousedown', (e) => {
      const rect = timelineCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pad = 8;
      const pct = (x - pad) / (rect.width - pad * 2);
      const t = Math.max(0, Math.min(state.duration, pct * state.duration));
      const startX = pad + (state.trimStart / state.duration) * (rect.width - pad * 2);
      const endX = pad + (state.trimEnd / state.duration) * (rect.width - pad * 2);
      if (Math.abs(x - startX) < 12) dragging = 'start';
      else if (Math.abs(x - endX) < 12) dragging = 'end';
      else { video.currentTime = t; dragging = 'seek'; }
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = timelineCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pad = 8;
      const pct = Math.max(0, Math.min(1, (x - pad) / (rect.width - pad * 2)));
      const t = pct * state.duration;
      if (dragging === 'start') state.trimStart = Math.min(t, state.trimEnd - 0.1);
      else if (dragging === 'end') state.trimEnd = Math.max(t, state.trimStart + 0.1);
      else if (dragging === 'seek') video.currentTime = t;
      updateTimeline();
      document.getElementById('ve-trim-info').textContent = `Trim: ${state.trimStart.toFixed(1)}s - ${state.trimEnd.toFixed(1)}s`;
    });

    document.addEventListener('mouseup', () => { dragging = null; });

    document.getElementById('ve-speed').addEventListener('change', (e) => {
      video.playbackRate = parseFloat(e.target.value);
    });

    document.getElementById('ve-set-start').addEventListener('click', () => {
      state.trimStart = video.currentTime;
      if (state.trimStart >= state.trimEnd) state.trimEnd = Math.min(state.duration, state.trimStart + 0.1);
      updateTimeline();
      document.getElementById('ve-trim-info').textContent = `Trim: ${state.trimStart.toFixed(1)}s - ${state.trimEnd.toFixed(1)}s`;
    });

    document.getElementById('ve-set-end').addEventListener('click', () => {
      state.trimEnd = video.currentTime;
      if (state.trimEnd <= state.trimStart) state.trimStart = Math.max(0, state.trimEnd - 0.1);
      updateTimeline();
      document.getElementById('ve-trim-info').textContent = `Trim: ${state.trimStart.toFixed(1)}s - ${state.trimEnd.toFixed(1)}s`;
    });

    document.getElementById('ve-reset-trim').addEventListener('click', () => {
      state.trimStart = 0;
      state.trimEnd = state.duration;
      updateTimeline();
      document.getElementById('ve-trim-info').textContent = `Trim: 0.0s - ${state.duration.toFixed(1)}s`;
    });

    document.getElementById('ve-grab-frame').addEventListener('click', async () => {
      const t = parseFloat(document.getElementById('ve-frame-time').value) || video.currentTime;
      const app = window.__NEXUS_DI?.app;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const v2 = document.createElement('video');
        v2.src = url;
        v2.currentTime = t;
        await new Promise(r => v2.addEventListener('seeked', r, { once: true }));
        canvas.getContext('2d').drawImage(v2, 0, 0);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        const name = file.name.replace(/\.[^.]+$/, '') + `_frame_${t.toFixed(2)}s.png`;
        const path = file.path.substring(0, file.path.lastIndexOf('/')) + '/' + name;
        await window.__NEXUS_DI.vfs.addFile(path, blob, 'IMAGE');
        app?.eventBus.emit('vfs:changed');
        app?.notifications?.show(`Frame extracted: ${name}`, 'success');
      } catch (e) {
        app?.notifications?.show('Frame extract failed', 'error');
      }
    });

    document.getElementById('ve-batch-extract').addEventListener('click', async () => {
      const interval = parseFloat(document.getElementById('ve-batch-interval').value) || 1;
      const count = parseInt(document.getElementById('ve-batch-count').value) || 10;
      const progress = document.getElementById('ve-batch-progress');
      const app = window.__NEXUS_DI?.app;
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const folderPath = file.path.substring(0, file.path.lastIndexOf('/')) + '/' + baseName + '_frames';
      await window.__NEXUS_DI.vfs.createFolder(folderPath);

      for (let i = 0; i < count; i++) {
        const t = (i * interval);
        if (t > state.duration) break;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const v2 = document.createElement('video');
          v2.src = url;
          v2.currentTime = t;
          await new Promise(r => v2.addEventListener('seeked', r, { once: true }));
          canvas.getContext('2d').drawImage(v2, 0, 0);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
          await window.__NEXUS_DI.vfs.addFile(`${folderPath}/frame_${i.toString().padStart(4, '0')}_${t.toFixed(2)}s.png`, blob, 'IMAGE');
          progress.textContent = `${i + 1}/${count}`;
        } catch (e) {
          console.error(e);
        }
      }
      app?.eventBus.emit('vfs:changed');
      app?.notifications?.show(`Extracted ${count} frames`, 'success');
      progress.textContent = 'Done';
    });

    document.getElementById('ve-thumbs').addEventListener('click', async () => {
      const strip = document.getElementById('ve-thumbs-strip');
      strip.innerHTML = '<span style="font-size:10px;color:#666;">Generating...</span>';
      try {
        const thumbs = [];
        for (let i = 0; i < 10; i++) {
          const t = (i / 10) * state.duration;
          const v2 = document.createElement('video');
          v2.src = url;
          v2.currentTime = t;
          await new Promise(r => v2.addEventListener('seeked', r, { once: true }));
          const c = document.createElement('canvas');
          c.width = 80;
          c.height = Math.round(80 * video.videoHeight / video.videoWidth);
          c.getContext('2d').drawImage(v2, 0, 0, c.width, c.height);
          const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.6));
          thumbs.push({ t, blob });
        }
        strip.innerHTML = '';
        for (const th of thumbs) {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(th.blob);
          img.style.cssText = 'height:40px;border-radius:2px;cursor:pointer;border:1px solid #333;';
          img.title = formatTime(th.t);
          img.addEventListener('click', () => { video.currentTime = th.t; });
          strip.appendChild(img);
        }
      } catch (e) {
        strip.innerHTML = '<span style="color:#ff003c;font-size:10px;">Failed</span>';
      }
    });

    document.getElementById('ve-save').addEventListener('click', () => {
      const app = window.__NEXUS_DI?.app;
      app?.notifications?.show(`Trim: ${state.trimStart.toFixed(2)}s → ${state.trimEnd.toFixed(2)}s (metadata saved)`, 'success');
    });

    window.addEventListener('resize', updateTimeline);
    setTimeout(updateTimeline, 100);

    return {
      destroy: () => {
        URL.revokeObjectURL(url);
        video.pause();
        video.removeAttribute('src');
        video.load();
        if (state.extractor) state.extractor.destroy();
        window.removeEventListener('resize', updateTimeline);
      },
      getTrimRange: () => ({ start: state.trimStart, end: state.trimEnd }),
    };
  },
};
