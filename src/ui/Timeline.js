const DEFAULT_PPS = 80;
const MIN_PPS = 10;
const MAX_PPS = 600;
const TRACK_HEIGHT = 44;
const RULER_HEIGHT = 24;
const HANDLE_W = 8;
const SNAP_PX = 6;

export class Timeline {
  constructor(container, options = {}) {
    this.container = container;
    this.duration = options.duration || 0;
    this.pixelsPerSecond = options.pixelsPerSecond || DEFAULT_PPS;
    this.tracks = options.tracks || [];
    this.playhead = 0;
    this.onSeek = options.onSeek || (() => {});
    this.onRegionChange = options.onRegionChange || (() => {});
    this.onKeyframeSelect = options.onKeyframeSelect || (() => {});
    this.onRegionSelect = options.onRegionSelect || (() => {});
    this.onZoom = options.onZoom || (() => {});

    this.regions = options.regions || [];
    this.keyframes = options.keyframes || [];
    this.markers = options.markers || [];
    this.snapEnabled = options.snap !== false;
    this.loopEnabled = false;
    this.loopRegion = null;

    this._scrollLeft = 0;
    this._selectedRegion = null;
    this._selectedKeyframe = null;
    this._dragging = null;
    this._hoverTime = null;
    this._destroyed = false;

    this._build();
    this._bindEvents();
    this.render();
  }

  _build() {
    const c = this.container;
    c.innerHTML = '';
    c.style.cssText = 'position:relative;display:flex;flex-direction:column;background:#0a0a0a;border:1px solid #222;border-radius:6px;overflow:hidden;height:100%;min-height:120px;font-family:monospace;user-select:none;';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-panel);border-bottom:1px solid #222;flex-shrink:0;';
    toolbar.innerHTML = `
      <span id="tl-time" style="color:var(--nexus-cyan);font-size:11px;min-width:90px;">00:00.000</span>
      <span style="color:#333;">|</span>
      <span id="tl-duration" style="color:#888;font-size:11px;min-width:70px;">00:00.000</span>
    `;

    const zoomOut = this._toolBtn('fa-search-minus', 'Zoom out', () => this.setZoom(this.pixelsPerSecond * 0.75));
    const zoomIn = this._toolBtn('fa-search-plus', 'Zoom in', () => this.setZoom(this.pixelsPerSecond * 1.33));
    const zoomFit = this._toolBtn('fa-arrows-alt-h', 'Zoom to fit', () => this.zoomToFit());
    const snapBtn = this._toolBtn('fa-magnet', 'Toggle snap', () => {
      this.snapEnabled = !this.snapEnabled;
      snapBtn.style.color = this.snapEnabled ? 'var(--nexus-cyan)' : '#666';
    });
    snapBtn.style.color = this.snapEnabled ? 'var(--nexus-cyan)' : '#666';
    const loopBtn = this._toolBtn('fa-redo-alt', 'Toggle loop', () => {
      this.loopEnabled = !this.loopEnabled;
      loopBtn.style.color = this.loopEnabled ? 'var(--nexus-cyan)' : '#666';
      this.render();
    });
    const splitBtn = this._toolBtn('fa-cut', 'Split region at playhead', () => this.splitAtPlayhead());

    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex:1;';
    toolbar.appendChild(spacer);

    toolbar.appendChild(zoomOut);
    toolbar.appendChild(zoomIn);
    toolbar.appendChild(zoomFit);
    toolbar.appendChild(snapBtn);
    toolbar.appendChild(loopBtn);
    toolbar.appendChild(splitBtn);

    const addRegionBtn = this._toolBtn('fa-plus', 'Add region at playhead', () => this.addRegionAtPlayhead());
    toolbar.appendChild(addRegionBtn);

    c.appendChild(toolbar);
    this._toolbar = toolbar;
    this._timeEl = toolbar.querySelector('#tl-time');
    this._durationEl = toolbar.querySelector('#tl-duration');

    const scrollWrap = document.createElement('div');
    scrollWrap.style.cssText = 'position:relative;flex:1;overflow-x:auto;overflow-y:hidden;background:#050505;';
    scrollWrap.className = 'nexus-scroll';

    const inner = document.createElement('div');
    inner.style.cssText = `position:relative;height:${RULER_HEIGHT + this.tracks.length * TRACK_HEIGHT}px;min-width:100%;`;
    scrollWrap.appendChild(inner);
    c.appendChild(scrollWrap);

    this._scrollWrap = scrollWrap;
    this._inner = inner;

    this._ruler = document.createElement('canvas');
    this._ruler.style.cssText = `position:absolute;top:0;left:0;height:${RULER_HEIGHT}px;width:100%;background:#0f0f0f;border-bottom:1px solid #222;cursor:pointer;`;
    inner.appendChild(this._ruler);

    this._tracksEl = document.createElement('div');
    this._tracksEl.style.cssText = 'position:relative;';
    inner.appendChild(this._tracksEl);

    this._playheadEl = document.createElement('div');
    this._playheadEl.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:var(--nexus-cyan);pointer-events:none;z-index:20;box-shadow:0 0 8px var(--nexus-cyan);';
    this._playheadEl.innerHTML = '<div style="position:absolute;top:-1px;left:-5px;width:12px;height:12px;background:var(--nexus-cyan);border-radius:50%;box-shadow:0 0 8px var(--nexus-cyan);"></div>';
    inner.appendChild(this._playheadEl);

    this._hoverLine = document.createElement('div');
    this._hoverLine.style.cssText = 'position:absolute;top:0;bottom:0;width:1px;background:rgba(0,240,255,0.3);pointer-events:none;z-index:19;display:none;';
    inner.appendChild(this._hoverLine);

    this._playheadLabel = document.createElement('div');
    this._playheadLabel.style.cssText = 'position:absolute;top:24px;background:var(--nexus-cyan);color:#000;font-size:9px;padding:2px 5px;border-radius:2px;transform:translateX(-50%);pointer-events:none;z-index:21;font-weight:bold;white-space:nowrap;';
    inner.appendChild(this._playheadLabel);
  }

  _toolBtn(icon, title, onClick) {
    const btn = document.createElement('button');
    btn.className = 'nexus-touch';
    btn.innerHTML = `<i class="fas ${icon}"></i>`;
    btn.title = title;
    btn.style.cssText = 'background:transparent;border:none;color:#888;cursor:pointer;font-size:12px;padding:5px 8px;border-radius:4px;transition:all 0.15s;';
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(0,240,255,0.1)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
    btn.addEventListener('click', onClick);
    return btn;
  }

  _bindEvents() {
    const inner = this._inner;
    const scroll = this._scrollWrap;

    scroll.addEventListener('scroll', () => {
      this._scrollLeft = scroll.scrollLeft;
      this.render();
    });

    scroll.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = scroll.getBoundingClientRect();
        const x = e.clientX - rect.left + scroll.scrollLeft;
        const timeAt = x / this.pixelsPerSecond;
        const delta = e.deltaY > 0 ? 0.85 : 1.18;
        const newPps = Math.max(MIN_PPS, Math.min(MAX_PPS, this.pixelsPerSecond * delta));
        const ratio = newPps / this.pixelsPerSecond;
        this.pixelsPerSecond = newPps;
        scroll.scrollLeft = (x - (e.clientX - rect.left)) * (ratio) + (e.clientX - rect.left) - (timeAt * newPps - timeAt * this.pixelsPerSecond);
        this.onZoom(newPps);
        this.render();
      }
    }, { passive: false });

    const ruler = this._ruler;
    ruler.addEventListener('mousedown', (e) => this._startScrub(e));
    ruler.addEventListener('touchstart', (e) => {
      this._startScrub(e.touches[0]);
      e.preventDefault();
    }, { passive: false });

    inner.addEventListener('mousemove', (e) => {
      const rect = inner.getBoundingClientRect();
      const x = e.clientX - rect.left;
      this._hoverTime = x / this.pixelsPerSecond;
      this._hoverLine.style.display = 'block';
      this._hoverLine.style.left = x + 'px';
    });
    inner.addEventListener('mouseleave', () => {
      this._hoverTime = null;
      this._hoverLine.style.display = 'none';
    });

    document.addEventListener('keydown', this._keyHandler = (e) => {
      if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.setPlayhead(this.playhead + (e.shiftKey ? 1 : 1/this.pixelsPerSecond*20)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.setPlayhead(this.playhead - (e.shiftKey ? 1 : 1/this.pixelsPerSecond*20)); }
      else if (e.key === 'Home') { e.preventDefault(); this.setPlayhead(0); }
      else if (e.key === 'End') { e.preventDefault(); this.setPlayhead(this.duration); }
      else if (e.key === 'Delete' && this._selectedRegion !== null) {
        e.preventDefault();
        this.removeRegion(this._selectedRegion);
      }
    });
  }

  _startScrub(e) {
    const rect = this._inner.getBoundingClientRect();
    const getX = (ev) => (ev.clientX ?? (ev.touches && ev.touches[0]?.clientX)) - rect.left;
    const seek = (ev) => {
      const x = getX(ev);
      const t = Math.max(0, Math.min(this.duration, x / this.pixelsPerSecond));
      this.setPlayhead(t);
    };
    seek(e);
    const move = (ev) => seek(ev);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', up);
  }

  setDuration(d) {
    this.duration = Math.max(0, d);
    this.render();
  }

  setTracks(tracks) {
    this.tracks = tracks || [];
    this.render();
  }

  setRegions(regions) {
    this.regions = regions || [];
    this.render();
  }

  setKeyframes(kf) {
    this.keyframes = kf || [];
    this.render();
  }

  setMarkers(m) {
    this.markers = m || [];
    this.render();
  }

  setPlayhead(t) {
    this.playhead = Math.max(0, Math.min(this.duration, t));
    this._updatePlayheadPosition();
    this._timeEl.textContent = this._fmt(this.playhead);
    this.onSeek(this.playhead);
  }

  setZoom(pps) {
    this.pixelsPerSecond = Math.max(MIN_PPS, Math.min(MAX_PPS, pps));
    this.onZoom(this.pixelsPerSecond);
    this.render();
  }

  zoomToFit() {
    if (!this.duration) return;
    const w = this._scrollWrap.clientWidth;
    this.pixelsPerSecond = Math.max(MIN_PPS, Math.min(MAX_PPS, w / this.duration));
    this.render();
  }

  addRegionAtPlayhead() {
    const region = {
      id: 'region_' + Date.now(),
      start: this.playhead,
      end: Math.min(this.duration, this.playhead + 1),
      track: 0,
      label: 'Region ' + (this.regions.length + 1),
      color: '#00f0ff',
    };
    this.regions.push(region);
    this.render();
    this.onRegionChange(this.regions);
    return region;
  }

  addRegion(start, end, options = {}) {
    const region = {
      id: options.id || 'region_' + Date.now(),
      start: Math.min(start, end),
      end: Math.max(start, end),
      track: options.track || 0,
      label: options.label || 'Region',
      color: options.color || '#00f0ff',
      ...options,
    };
    this.regions.push(region);
    this.render();
    this.onRegionChange(this.regions);
    return region;
  }

  removeRegion(regionOrId) {
    const id = typeof regionOrId === 'string' ? regionOrId : regionOrId?.id;
    const idx = this.regions.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this.regions.splice(idx, 1);
    if (this._selectedRegion === id) this._selectedRegion = null;
    this.render();
    this.onRegionChange(this.regions);
    return true;
  }

  clearRegions() {
    this.regions = [];
    this._selectedRegion = null;
    this.render();
    this.onRegionChange(this.regions);
  }

  splitAtPlayhead() {
    const t = this.playhead;
    for (const r of this.regions) {
      if (t > r.start && t < r.end) {
        const oldEnd = r.end;
        r.end = t;
        const newRegion = { ...r, id: 'region_' + Date.now(), start: t, end: oldEnd };
        this.regions.push(newRegion);
        this.render();
        this.onRegionChange(this.regions);
        return [r, newRegion];
      }
    }
    return null;
  }

  mergeSelectedRegions() {
    const selected = this.regions.filter(r => r.selected);
    if (selected.length < 2) return null;
    selected.sort((a, b) => a.start - b.start);
    const merged = {
      id: 'region_' + Date.now(),
      start: selected[0].start,
      end: selected[selected.length - 1].end,
      track: selected[0].track,
      label: selected.map(r => r.label).join('+'),
      color: selected[0].color,
    };
    this.regions = this.regions.filter(r => !r.selected);
    this.regions.push(merged);
    this.render();
    this.onRegionChange(this.regions);
    return merged;
  }

  addKeyframe(time, options = {}) {
    const kf = {
      id: 'kf_' + Date.now() + Math.random().toString(36).slice(2, 6),
      time: Math.max(0, Math.min(this.duration, time)),
      track: options.track || 0,
      value: options.value ?? 0,
      type: options.type || 'linear',
      color: options.color || '#ffcc00',
      ...options,
    };
    this.keyframes.push(kf);
    this.keyframes.sort((a, b) => a.time - b.time);
    this.render();
    return kf;
  }

  removeKeyframe(id) {
    const idx = this.keyframes.findIndex(k => k.id === id);
    if (idx === -1) return false;
    this.keyframes.splice(idx, 1);
    this.render();
    return true;
  }

  addMarker(time, label, color = '#8a2be2') {
    const m = { id: 'mk_' + Date.now(), time, label, color };
    this.markers.push(m);
    this.markers.sort((a, b) => a.time - b.time);
    this.render();
    return m;
  }

  render() {
    if (this._destroyed) return;
    const inner = this._inner;
    const scroll = this._scrollWrap;

    const totalWidth = Math.max(scroll.clientWidth, this.duration * this.pixelsPerSecond + 40);
    inner.style.width = totalWidth + 'px';
    this._ruler.width = totalWidth;

    this._drawRuler();
    this._renderTracks();
    this._renderRegions();
    this._renderKeyframes();
    this._renderMarkers();
    this._updatePlayheadPosition();

    this._timeEl.textContent = this._fmt(this.playhead);
    this._durationEl.textContent = this._fmt(this.duration);
  }

  _drawRuler() {
    const canvas = this._ruler;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = RULER_HEIGHT;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, w, h);

    const pps = this.pixelsPerSecond;
    const step = this._pickStep(pps);

    ctx.strokeStyle = '#333';
    ctx.fillStyle = '#666';
    ctx.font = '9px monospace';
    ctx.textBaseline = 'top';

    const startTime = 0;
    const endTime = w / pps;

    for (let t = Math.ceil(startTime / step) * step; t <= endTime; t += step) {
      const x = Math.floor(t * pps) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, h - 6);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(this._fmtTick(t, step), x + 3, 4);

      const sub = step / 5;
      if (sub * pps > 8) {
        for (let i = 1; i < 5; i++) {
          const x2 = Math.floor((t + sub * i) * pps) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x2, h - 3);
          ctx.lineTo(x2, h);
          ctx.stroke();
        }
      }
    }
  }

  _pickStep(pps) {
    const targets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    for (const t of targets) {
      if (t * pps >= 60) return t;
    }
    return 600;
  }

  _renderTracks() {
    const el = this._tracksEl;
    el.innerHTML = '';
    el.style.height = (this.tracks.length * TRACK_HEIGHT) + 'px';

    for (let i = 0; i < this.tracks.length; i++) {
      const track = this.tracks[i];
      const row = document.createElement('div');
      row.dataset.track = i;
      row.style.cssText = `position:relative;height:${TRACK_HEIGHT}px;border-bottom:1px solid #1a1a1a;background:${i % 2 ? '#080808' : '#0d0d0d'};`;
      if (track && track.color) row.style.background = track.color + '11';

      const label = document.createElement('div');
      label.style.cssText = 'position:sticky;left:0;display:inline-block;background:#000;color:#666;font-size:10px;padding:4px 8px;z-index:5;border-right:1px solid #222;';
      label.textContent = track?.name || `Track ${i + 1}`;
      row.appendChild(label);

      el.appendChild(row);
    }
  }

  _renderRegions() {
    this._tracksEl.querySelectorAll('.tl-region').forEach(e => e.remove());

    for (const region of this.regions) {
      const trackEl = this._tracksEl.children[region.track || 0];
      if (!trackEl) continue;

      const el = document.createElement('div');
      el.className = 'tl-region nexus-touch';
      el.dataset.regionId = region.id;
      const x = region.start * this.pixelsPerSecond;
      const w = Math.max(4, (region.end - region.start) * this.pixelsPerSecond);
      const isSelected = region.id === this._selectedRegion;
      el.style.cssText = `position:absolute;left:${x}px;top:6px;height:${TRACK_HEIGHT - 12}px;width:${w}px;background:${region.color}33;border:1px solid ${region.color};border-radius:3px;cursor:pointer;overflow:hidden;z-index:6;${isSelected ? 'box-shadow:0 0 12px ' + region.color + ';' : ''}`;

      const lbl = document.createElement('div');
      lbl.textContent = region.label || '';
      lbl.style.cssText = 'font-size:9px;color:#fff;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 0 4px #000;';
      el.appendChild(lbl);

      const leftHandle = document.createElement('div');
      leftHandle.className = 'tl-handle';
      leftHandle.dataset.handle = 'left';
      leftHandle.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:${HANDLE_W}px;background:${region.color};cursor:ew-resize;`;
      el.appendChild(leftHandle);

      const rightHandle = document.createElement('div');
      rightHandle.className = 'tl-handle';
      rightHandle.dataset.handle = 'right';
      rightHandle.style.cssText = `position:absolute;right:0;top:0;bottom:0;width:${HANDLE_W}px;background:${region.color};cursor:ew-resize;`;
      el.appendChild(rightHandle);

      el.addEventListener('mousedown', (e) => this._startRegionDrag(e, region, 'move'));
      el.addEventListener('touchstart', (e) => {
        this._startRegionDrag(e.touches[0], region, e.target.dataset.handle || 'move');
        e.preventDefault();
      }, { passive: false });

      el.addEventListener('click', (e) => {
        if (e.target.dataset.handle) return;
        this._selectedRegion = region.id;
        this.onRegionSelect(region);
        this.render();
      });

      trackEl.appendChild(el);
    }
  }

  _startRegionDrag(startEvent, region, mode) {
    const startX = startEvent.clientX ?? (startEvent.touches && startEvent.touches[0]?.clientX);
    if (startX == null) return;
    const origStart = region.start;
    const origEnd = region.end;
    const startTime = this.playhead;
    const wasSelected = this._selectedRegion;
    this._selectedRegion = region.id;
    this.onRegionSelect(region);
    this.render();

    const move = (e) => {
      const x = e.clientX ?? (e.touches && e.touches[0]?.clientX);
      if (x == null) return;
      const dx = x - startX;
      const dt = dx / this.pixelsPerSecond;
      if (mode === 'left') {
        region.start = Math.max(0, Math.min(region.end - 0.05, origStart + dt));
      } else if (mode === 'right') {
        region.end = Math.min(this.duration, Math.max(region.start + 0.05, origEnd + dt));
      } else {
        const width = origEnd - origStart;
        let ns = Math.max(0, origStart + dt);
        let ne = ns + width;
        if (ne > this.duration) { ne = this.duration; ns = ne - width; }
        region.start = ns;
        region.end = ne;
      }
      if (this.snapEnabled) this._snapRegion(region);
      this.render();
      this.onRegionChange(this.regions);
    };

    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      this.onRegionChange(this.regions);
    };

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', up);
  }

  _snapRegion(region) {
    const candidates = [0, this.duration, this.playhead];
    for (const r of this.regions) {
      if (r === region) continue;
      candidates.push(r.start, r.end);
    }
    for (const m of this.markers) candidates.push(m.time);
    for (const k of this.keyframes) candidates.push(k.time);

    const threshold = SNAP_PX / this.pixelsPerSecond;
    for (const c of candidates) {
      if (Math.abs(region.start - c) < threshold) region.start = c;
      if (Math.abs(region.end - c) < threshold) region.end = c;
    }
  }

  _renderKeyframes() {
    this._tracksEl.querySelectorAll('.tl-keyframe').forEach(e => e.remove());

    for (const kf of this.keyframes) {
      const trackEl = this._tracksEl.children[kf.track || 0];
      if (!trackEl) continue;
      const x = kf.time * this.pixelsPerSecond;
      const el = document.createElement('div');
      el.className = 'tl-keyframe nexus-touch';
      el.dataset.keyframeId = kf.id;
      const isSelected = kf.id === this._selectedKeyframe;
      el.style.cssText = `position:absolute;left:${x}px;top:50%;width:10px;height:10px;background:${kf.color};transform:translate(-50%,-50%) rotate(45deg);z-index:8;cursor:pointer;border:1px solid #fff;${isSelected ? 'box-shadow:0 0 10px ' + kf.color : ''}`;
      el.title = `${kf.type} · t=${kf.time.toFixed(3)}s`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._selectedKeyframe = kf.id;
        this.onKeyframeSelect(kf);
        this.render();
      });
      el.addEventListener('mousedown', (e) => this._startKeyframeDrag(e, kf));
      el.addEventListener('touchstart', (e) => {
        this._startKeyframeDrag(e.touches[0], kf);
        e.preventDefault();
      }, { passive: false });
      trackEl.appendChild(el);
    }
  }

  _startKeyframeDrag(startEvent, kf) {
    const startX = startEvent.clientX;
    const origTime = kf.time;
    const move = (e) => {
      const x = e.clientX ?? (e.touches && e.touches[0]?.clientX);
      if (x == null) return;
      const dt = (x - startX) / this.pixelsPerSecond;
      let nt = Math.max(0, Math.min(this.duration, origTime + dt));
      if (this.snapEnabled) {
        const candidates = [0, this.duration, this.playhead, ...this.markers.map(m => m.time)];
        const threshold = SNAP_PX / this.pixelsPerSecond;
        for (const c of candidates) {
          if (Math.abs(nt - c) < threshold) { nt = c; break; }
        }
      }
      kf.time = nt;
      this.render();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      this.keyframes.sort((a, b) => a.time - b.time);
      this.render();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', up);
  }

  _renderMarkers() {
    this._inner.querySelectorAll('.tl-marker').forEach(e => e.remove());
    for (const m of this.markers) {
      const x = m.time * this.pixelsPerSecond;
      const el = document.createElement('div');
      el.className = 'tl-marker';
      el.style.cssText = `position:absolute;top:0;left:${x}px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid ${m.color};transform:translateX(-50%);z-index:15;cursor:pointer;`;
      el.title = `${m.label} · ${this._fmt(m.time)}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setPlayhead(m.time);
      });
      this._inner.appendChild(el);
    }
  }

  _updatePlayheadPosition() {
    const x = this.playhead * this.pixelsPerSecond;
    this._playheadEl.style.left = x + 'px';
    this._playheadLabel.style.left = x + 'px';
    this._playheadLabel.textContent = this._fmt(this.playhead);
  }

  _fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const ms = Math.floor((sec % 1) * 1000);
    const s = Math.floor(sec) % 60;
    const m = Math.floor(sec / 60) % 60;
    const h = Math.floor(sec / 3600);
    const base = h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${base}.${String(ms).padStart(3, '0')}`;
  }

  _fmtTick(t, step) {
    if (step >= 60) return Math.floor(t / 60) + 'm';
    if (step >= 1) {
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      return `${m}:${String(s).padStart(2, '0')}`;
    }
    return t.toFixed(step < 0.1 ? 2 : 1);
  }

  getRegions() { return [...this.regions]; }
  getKeyframes() { return [...this.keyframes]; }
  getMarkers() { return [...this.markers]; }
  getPlayhead() { return this.playhead; }
  getSelectedRegion() { return this.regions.find(r => r.id === this._selectedRegion) || null; }

  destroy() {
    this._destroyed = true;
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    this.container.innerHTML = '';
  }
}
