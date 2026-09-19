const UPDATE_INTERVAL = 500;
const HISTORY_SIZE = 60;

export class StatusBar {
  constructor(container, options = {}) {
    this.container = container;
    this.vfs = options.vfs;
    this.workerManager = options.workerManager;
    this.chunkStore = options.chunkStore;
    this.eventBus = options.eventBus;
    this.onClickActivity = options.onClickActivity || (() => {});

    this._ramHistory = [];
    this._chunkHistory = [];
    this._stats = {
      online: navigator.onLine !== false,
      memory: 0,
      chunks: 0,
      chunkBytes: 0,
      workers: 0,
      workerActive: 0,
      queue: 0,
      progress: null,
      activity: '',
      status: 'READY',
      statusType: 'ready',
    };
    this._unsubscribers = [];
    this._updateTimer = null;
    this._destroyed = false;
  }

  init() {
    this._build();
    this._bindEvents();
    this._startUpdates();
    return this;
  }

  _build() {
    const c = this.container;
    if (!c) return;
    c.innerHTML = '';
    c.style.cssText = 'height:26px;background:var(--bg-panel);border-top:1px solid #333;display:flex;align-items:center;padding:0 12px;gap:14px;font-size:11px;font-family:monospace;color:var(--text-muted);flex-shrink:0;overflow:hidden;user-select:none;';

    const led = document.createElement('span');
    led.id = 'sb-led';
    led.textContent = '●';
    led.style.cssText = 'color:#00ff41;font-size:10px;flex-shrink:0;transition:color 0.2s;';
    c.appendChild(led);
    this._led = led;

    const status = document.createElement('span');
    status.id = 'sb-status';
    status.textContent = 'READY';
    status.style.cssText = 'color:#00ff41;font-weight:bold;flex-shrink:0;letter-spacing:0.05em;';
    c.appendChild(status);
    this._statusEl = status;

    const sep1 = this._sep();
    c.appendChild(sep1);

    const activity = document.createElement('span');
    activity.id = 'sb-activity';
    activity.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;cursor:pointer;color:#888;';
    activity.title = 'Click to view activity log';
    activity.textContent = '';
    c.appendChild(activity);
    this._activityEl = activity;

    const progressWrap = document.createElement('div');
    progressWrap.id = 'sb-progress-wrap';
    progressWrap.style.cssText = 'display:none;width:120px;height:5px;background:#1a1a1a;border-radius:3px;overflow:hidden;flex-shrink:0;';
    const progressBar = document.createElement('div');
    progressBar.id = 'sb-progress-bar';
    progressBar.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#00f0ff,#8a2be2);transition:width 0.2s ease;';
    progressWrap.appendChild(progressBar);
    c.appendChild(progressWrap);
    this._progressWrap = progressWrap;
    this._progressBar = progressBar;

    const progressLabel = document.createElement('span');
    progressLabel.id = 'sb-progress-label';
    progressLabel.style.cssText = 'display:none;color:var(--nexus-cyan);font-size:10px;flex-shrink:0;min-width:32px;';
    c.appendChild(progressLabel);
    this._progressLabel = progressLabel;

    this._metrics = {};
    this._metrics.chunks = this._metric(c, 'fa-cubes', 'CH', 'Chunks', '#00f0ff');
    this._metrics.workers = this._metric(c, 'fa-microchip', 'W', 'Workers active/total', '#8a2be2');
    this._metrics.queue = this._metric(c, 'fa-list-ol', 'Q', 'Task queue', '#ffcc00');
    this._metrics.memory = this._metric(c, 'fa-memory', 'MEM', 'Heap usage', '#00ff41');

    const sep2 = this._sep();
    c.appendChild(sep2);

    const online = document.createElement('span');
    online.id = 'sb-online';
    online.textContent = '⬤ ONLINE';
    online.style.cssText = 'color:#00ff41;font-size:10px;flex-shrink:0;letter-spacing:0.05em;';
    c.appendChild(online);
    this._onlineEl = online;

    const time = document.createElement('span');
    time.id = 'sb-time';
    time.style.cssText = 'color:#444;font-size:10px;flex-shrink:0;min-width:60px;text-align:right;';
    c.appendChild(time);
    this._timeEl = time;
  }

  _metric(parent, icon, label, title, color) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0;';
    wrap.title = title;
    const i = document.createElement('i');
    i.className = `fas ${icon}`;
    i.style.cssText = `color:${color};font-size:10px;opacity:0.7;`;
    wrap.appendChild(i);
    const lbl = document.createElement('span');
    lbl.textContent = label + ':';
    lbl.style.cssText = 'color:#555;font-size:10px;';
    wrap.appendChild(lbl);
    const val = document.createElement('span');
    val.textContent = '0';
    val.style.cssText = `color:${color};font-size:10px;min-width:24px;`;
    wrap.appendChild(val);
    parent.appendChild(wrap);
    return { wrap, value: val };
  }

  _sep() {
    const s = document.createElement('span');
    s.style.cssText = 'color:#222;flex-shrink:0;';
    s.textContent = '│';
    return s;
  }

  _bindEvents() {
    if (this.eventBus) {
      this._unsubscribers.push(
        this.eventBus.on('boot:complete', () => this.setStatus('READY', 'ready'))
      );
      this._unsubscribers.push(
        this.eventBus.on('vfs:changed', () => this.updateVFSStats())
      );
      this._unsubscribers.push(
        this.eventBus.on('worker:busy', (data) => this.setWorkers(data.active, data.total))
      );
      this._unsubscribers.push(
        this.eventBus.on('worker:queue', (data) => this.setQueue(data.count))
      );
      this._unsubscribers.push(
        this.eventBus.on('vfs:progress', (data) => this.setProgress(data.progress, data.label))
      );
      this._unsubscribers.push(
        this.eventBus.on('storage:near-full', () => this.setStatus('STORAGE FULL', 'error'))
      );
    }

    window.addEventListener('online', () => this.setOnline(true));
    window.addEventListener('offline', () => this.setOnline(false));

    if (this._activityEl) {
      this._activityEl.addEventListener('click', () => this.onClickActivity());
    }
  }

  _startUpdates() {
    const tick = () => {
      if (this._destroyed) return;
      this._updateMemory();
      this._updateTime();
      if (this.vfs && this.vfs.chunkStore) this._updateChunks();
    };
    tick();
    this._updateTimer = setInterval(tick, UPDATE_INTERVAL);
  }

  _updateMemory() {
    let used = 0;
    let limit = 0;
    if (performance && performance.memory) {
      used = performance.memory.usedJSHeapSize;
      limit = performance.memory.jsHeapSizeLimit;
    } else if (this.vfs) {
      used = this.vfs.getTotalSize();
      limit = used * 2;
    }
    this._stats.memory = used;
    this._ramHistory.push(used);
    if (this._ramHistory.length > HISTORY_SIZE) this._ramHistory.shift();
    const mb = (used / 1024 / 1024).toFixed(0);
    if (this._metrics && this._metrics.memory && this._metrics.memory.value) {
      this._metrics.memory.value.textContent = `${mb}M`;
      if (limit > 0 && used / limit > 0.85) {
        this._metrics.memory.value.style.color = '#ff003c';
      } else if (limit > 0 && used / limit > 0.65) {
        this._metrics.memory.value.style.color = '#ffcc00';
      } else {
        this._metrics.memory.value.style.color = '#00ff41';
      }
    }
  }

  async _updateChunks() {
    try {
      if (this.chunkStore && this.chunkStore.ready) {
        const stats = this.chunkStore.getStats();
        this._stats.chunks = stats.cache.entries || 0;
        this._stats.chunkBytes = stats.cache.bytes || 0;
        if (this._metrics && this._metrics.chunks && this._metrics.chunks.value) {
          this._metrics.chunks.value.textContent = String(this._stats.chunks);
          const bytes = this._stats.chunkBytes;
          this._metrics.chunks.wrap.title = `Cache: ${stats.cache.entries} entries (${(bytes / 1024 / 1024).toFixed(1)} MB)`;
        }
      }
    } catch {}
  }

  _updateTime() {
    if (this._timeEl && this._timeEl.isConnected) {
      const now = new Date();
      this._timeEl.textContent = now.toTimeString().slice(0, 8);
    }
  }

  setStatus(text, type = 'ready') {
    this._stats.status = text;
    this._stats.statusType = type;
    if (!this._statusEl || !this._led || !this._statusEl.isConnected) return;
    this._statusEl.textContent = text.toUpperCase();
    const colors = {
      ready: '#00ff41',
      busy: '#ffcc00',
      error: '#ff003c',
      warning: '#ffcc00',
      info: 'var(--nexus-cyan)',
      success: '#00ff41',
    };
    const color = colors[type] || '#00ff41';
    this._statusEl.style.color = color;
    this._led.style.color = color;
    if (type === 'busy') {
      this._led.style.animation = 'pulse 1s infinite';
    } else {
      this._led.style.animation = '';
    }
  }

  setActivity(text) {
    this._stats.activity = text;
    if (!this._activityEl || !this._activityEl.isConnected) return;
    this._activityEl.textContent = text;
  }

  setProgress(progress, label = '') {
    if (progress == null) {
      if (this._progressWrap) this._progressWrap.style.display = 'none';
      if (this._progressLabel) this._progressLabel.style.display = 'none';
      this._stats.progress = null;
      return;
    }
    const pct = Math.max(0, Math.min(100, progress * 100));
    if (this._progressWrap && this._progressBar) {
      this._progressWrap.style.display = 'block';
      this._progressBar.style.width = pct + '%';
    }
    if (this._progressLabel) {
      this._progressLabel.style.display = 'block';
      this._progressLabel.textContent = label || `${pct.toFixed(0)}%`;
    }
    this._stats.progress = pct;
  }

  setOnline(online) {
    this._stats.online = !!online;
    if (!this._onlineEl || !this._onlineEl.isConnected) return;
    this._onlineEl.textContent = online ? '⬤ ONLINE' : '⬤ OFFLINE';
    this._onlineEl.style.color = online ? '#00ff41' : '#ff003c';
  }

  setWorkers(active, total) {
    this._stats.workers = total;
    this._stats.workerActive = active;
    if (this._metrics && this._metrics.workers && this._metrics.workers.value) {
      this._metrics.workers.value.textContent = `${active}/${total}`;
      this._metrics.workers.value.style.color = active > 0 ? '#ffcc00' : '#8a2be2';
    }
  }

  setQueue(count) {
    this._stats.queue = count;
    if (this._metrics && this._metrics.queue && this._metrics.queue.value) {
      this._metrics.queue.value.textContent = String(count);
      this._metrics.queue.value.style.color = count > 0 ? '#ffcc00' : '#666';
    }
  }

  setChunks(count, bytes) {
    this._stats.chunks = count;
    this._stats.chunkBytes = bytes;
    if (this._metrics && this._metrics.chunks && this._metrics.chunks.value) {
      this._metrics.chunks.value.textContent = String(count);
    }
  }

  updateVFSStats() {
    if (!this.vfs) return;
    try {
      const all = this.vfs.listAllFiles();
      const count = all.length;
      const totalBytes = all.reduce((s, f) => s + (f.size || 0), 0);
      this.setActivity(`${count} file${count === 1 ? '' : 's'} · ${this._fmtBytes(totalBytes)}`);
    } catch {}
  }

  flashActivity(text, duration = 2500) {
    const prev = this._stats.activity;
    this.setActivity(text);
    setTimeout(() => {
      if (this._stats.activity === text) this.setActivity(prev);
    }, duration);
  }

  getStats() {
    return { ...this._stats, ramHistory: [...this._ramHistory] };
  }

  _fmtBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  destroy() {
    this._destroyed = true;
    if (this._updateTimer) clearInterval(this._updateTimer);
    for (const unsub of this._unsubscribers) {
      try { unsub(); } catch {}
    }
    this.container.innerHTML = '';
  }
}

if (typeof document !== 'undefined' && !document.getElementById('nexus-statusbar-styles')) {
  const style = document.createElement('style');
  style.id = 'nexus-statusbar-styles';
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  `;
  document.head.appendChild(style);
}
