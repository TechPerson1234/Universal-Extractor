const DEFAULT_MAX_HISTORY = 50;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

function _uid() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function _deepMerge(base, next) {
  if (Array.isArray(base) && Array.isArray(next)) return next;
  if (base && next && typeof base === 'object' && typeof next === 'object') {
    const out = { ...base };
    for (const k of Object.keys(next)) out[k] = _deepMerge(base[k], next[k]);
    return out;
  }
  return next;
}

export class StateManager {
  constructor(options = {}) {
    this.maxHistory = options.maxHistory || DEFAULT_MAX_HISTORY;
    this.maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
    this.storageKey = options.storageKey || 'nexus-history';
    this.persist = options.persist !== false;
    this.diffMode = options.diffMode !== false;
    this.history = [];
    this.currentIndex = -1;
    this.enabled = true;
    this._listeners = new Set();
    this._byteSize = 0;
    this._branches = new Map();
    this._activeBranch = 'main';
    this._lastLabel = null;
    if (this.persist) this._loadPersisted();
  }

  pushState(state, label = null) {
    if (!this.enabled) return null;
    if (state === undefined) return null;
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }
    const snapshot = this._createSnapshot(state, label);
    this.history.push(snapshot);
    this.currentIndex = this.history.length - 1;
    this._byteSize += snapshot.size;
    while (this.history.length > this.maxHistory || this._byteSize > this.maxBytes) {
      const removed = this.history.shift();
      if (removed) this._byteSize -= removed.size;
      this.currentIndex--;
    }
    if (this.currentIndex < 0) this.currentIndex = 0;
    this._notify('push', { index: this.currentIndex, size: snapshot.size });
    if (this.persist) this._persist();
    return snapshot.id;
  }

  undo() {
    if (this.currentIndex <= 0) return null;
    this.currentIndex--;
    const snap = this.history[this.currentIndex];
    this._notify('undo', { index: this.currentIndex });
    if (this.persist) this._persist();
    return this._materialize(snap);
  }

  redo() {
    if (this.currentIndex >= this.history.length - 1) return null;
    this.currentIndex++;
    const snap = this.history[this.currentIndex];
    this._notify('redo', { index: this.currentIndex });
    if (this.persist) this._persist();
    return this._materialize(snap);
  }

  jumpTo(index) {
    if (index < 0 || index >= this.history.length) return null;
    this.currentIndex = index;
    const snap = this.history[index];
    this._notify('jump', { index });
    if (this.persist) this._persist();
    return this._materialize(snap);
  }

  getCurrentState() {
    if (this.currentIndex < 0 || this.currentIndex >= this.history.length) return null;
    return this._materialize(this.history[this.currentIndex]);
  }

  peekAt(index) {
    if (index < 0 || index >= this.history.length) return null;
    return this._materialize(this.history[index]);
  }

  getHistory() {
    return this.history.map((s, i) => ({
      id: s.id,
      label: s.label,
      ts: s.ts,
      size: s.size,
      isCurrent: i === this.currentIndex,
      index: i,
    }));
  }

  get length() {
    return this.history.length;
  }

  get position() {
    return this.currentIndex;
  }

  get canUndo() {
    return this.currentIndex > 0;
  }

  get canRedo() {
    return this.currentIndex < this.history.length - 1;
  }

  clear() {
    this.history = [];
    this.currentIndex = -1;
    this._byteSize = 0;
    this._notify('clear', {});
    if (this.persist) this._persist();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this._notify('enabled', { enabled: this.enabled });
  }

  setMaxHistory(n) {
    this.maxHistory = Math.max(1, n);
    while (this.history.length > this.maxHistory) {
      const removed = this.history.shift();
      if (removed) this._byteSize -= removed.size;
      this.currentIndex--;
    }
    if (this.currentIndex < 0) this.currentIndex = 0;
    if (this.persist) this._persist();
  }

  createBranch(name, fromIndex = null) {
    const idx = fromIndex === null ? this.currentIndex : fromIndex;
    if (idx < 0 || idx >= this.history.length) return false;
    this._branches.set(name, {
      history: JSON.parse(JSON.stringify(this.history.slice(0, idx + 1))),
      currentIndex: idx,
      created: Date.now(),
    });
    return true;
  }

  switchBranch(name) {
    if (name === this._activeBranch) return true;
    if (!this._branches.has(name)) return false;
    this._branches.set(this._activeBranch, {
      history: this.history,
      currentIndex: this.currentIndex,
      created: Date.now(),
    });
    const branch = this._branches.get(name);
    this.history = branch.history;
    this.currentIndex = branch.currentIndex;
    this._activeBranch = name;
    this._byteSize = this.history.reduce((s, snap) => s + snap.size, 0);
    this._notify('branch', { name });
    if (this.persist) this._persist();
    return true;
  }

  listBranches() {
    return [this._activeBranch, ...Array.from(this._branches.keys())]
      .filter((v, i, a) => a.indexOf(v) === i);
  }

  deleteBranch(name) {
    if (name === this._activeBranch) return false;
    return this._branches.delete(name);
  }

  get activeBranch() {
    return this._activeBranch;
  }

  compress() {
    if (this.history.length <= 2) return { removed: 0 };
    const initial = this.history.slice(0, 1);
    const final = this.history.slice(-1);
    const removed = this.history.length - 2;
    this.history = [...initial, ...final];
    this.currentIndex = this.history.length - 1;
    this._byteSize = this.history.reduce((s, snap) => s + snap.size, 0);
    this._notify('compress', { removed });
    if (this.persist) this._persist();
    return { removed };
  }

  export() {
    return {
      version: 1,
      history: this.history,
      currentIndex: this.currentIndex,
      activeBranch: this._activeBranch,
      branches: Array.from(this._branches.entries()).map(([k, v]) => ({ name: k, ...v })),
      exported: Date.now(),
    };
  }

  import(data) {
    if (!data || !Array.isArray(data.history)) throw new Error('Invalid history data');
    this.history = data.history;
    this.currentIndex = data.currentIndex ?? this.history.length - 1;
    this._activeBranch = data.activeBranch || 'main';
    this._branches = new Map();
    for (const b of data.branches || []) {
      this._branches.set(b.name, {
        history: b.history,
        currentIndex: b.currentIndex,
        created: b.created || Date.now(),
      });
    }
    if (this.currentIndex >= this.history.length) this.currentIndex = this.history.length - 1;
    this._byteSize = this.history.reduce((s, snap) => s + snap.size, 0);
    this._notify('import', { length: this.history.length });
    if (this.persist) this._persist();
  }

  subscribe(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  getStats() {
    return {
      length: this.history.length,
      position: this.currentIndex,
      bytes: this._byteSize,
      maxHistory: this.maxHistory,
      maxBytes: this.maxBytes,
      enabled: this.enabled,
      activeBranch: this._activeBranch,
      branches: this.listBranches(),
    };
  }

  _createSnapshot(state, label) {
    let serialized;
    try {
      serialized = JSON.stringify(state);
    } catch (e) {
      serialized = JSON.stringify({ __unserializable: true, ts: Date.now() });
    }
    const size = serialized.length * 2;
    return {
      id: _uid(),
      label: label || this._lastLabel || null,
      ts: Date.now(),
      serialized,
      size,
    };
  }

  _materialize(snapshot) {
    if (!snapshot) return null;
    if (this.diffMode && this.history.length > 1) {
      const idx = this.history.indexOf(snapshot);
      if (idx > 0) {
        const prev = this.history[idx - 1];
        try {
          const base = JSON.parse(prev.serialized);
          const next = JSON.parse(snapshot.serialized);
          return _deepMerge(base, next);
        } catch {}
      }
    }
    try {
      return JSON.parse(snapshot.serialized);
    } catch {
      return null;
    }
  }

  _notify(type, payload) {
    for (const fn of this._listeners) {
      try { fn({ type, ...payload, ts: Date.now() }); } catch {}
    }
  }

  _persist() {
    if (!this.persist) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.export()));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        this.compress();
        try { localStorage.setItem(this.storageKey, JSON.stringify(this.export())); } catch {}
      }
    }
  }

  _loadPersisted() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      this.import(JSON.parse(raw));
    } catch (e) {
      console.warn('[StateManager] load persisted failed', e);
    }
  }
}

export class DiffStateManager extends StateManager {
  constructor(options = {}) {
    super({ diffMode: true, ...options });
    this._patches = [];
  }

  pushState(state, label) {
    const id = super.pushState(state, label);
    const idx = this.currentIndex;
    if (idx > 0) {
      const prev = this._materialize(this.history[idx - 1]);
      const patch = this._computePatch(prev, state);
      this._patches[idx] = patch;
    } else {
      this._patches[idx] = { type: 'init', value: state };
    }
    return id;
  }

  _computePatch(prev, next) {
    const ops = [];
    this._diffObjects(prev, next, '', ops);
    return { type: 'patch', ops };
  }

  _diffObjects(a, b, path, ops) {
    if (a === b) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len; i++) this._diffObjects(a[i], b[i], `${path}[${i}]`, ops);
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) this._diffObjects(a[k], b[k], path ? `${path}.${k}` : k, ops);
      return;
    }
    ops.push({ path, value: b });
  }
}

export class CoalescingStateManager extends StateManager {
  constructor(options = {}) {
    super(options);
    this.coalesceWindow = options.coalesceWindow || 500;
    this._lastPush = 0;
    this._lastLabelKey = null;
  }

  pushState(state, label = null) {
    const now = Date.now();
    const key = label || '__default';
    const withinWindow = (now - this._lastPush) < this.coalesceWindow;
    const sameLabel = key === this._lastLabelKey;
    if (withinWindow && sameLabel && this.history.length > 0 && this.currentIndex === this.history.length - 1) {
      const snap = this._createSnapshot(state, label);
      const old = this.history[this.currentIndex];
      this._byteSize -= old.size;
      this.history[this.currentIndex] = snap;
      this._byteSize += snap.size;
      this._lastPush = now;
      if (this.persist) this._persist();
      return snap.id;
    }
    this._lastPush = now;
    this._lastLabelKey = key;
    return super.pushState(state, label);
  }
}
