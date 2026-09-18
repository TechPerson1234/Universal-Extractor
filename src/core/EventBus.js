export class EventBus {
  constructor(options = {}) {
    this.listeners = new Map();
    this.wildcardListeners = [];
    this.replayBuffer = new Map();
    this.replaySize = options.replaySize || 0;
    this.maxListeners = options.maxListeners || 1000;
    this.debug = options.debug || false;
    this._dispatchDepth = 0;
    this._pendingEmits = [];
    this._middleware = [];
    this._debounceTimers = new Map();
    this._throttleState = new Map();
    this._stats = {
      emitted: 0,
      delivered: 0,
      errors: 0,
      wildcardMatches: 0,
      filtered: 0,
      middlewareBlocked: 0,
      queued: 0,
    };
  }

  on(event, callback, options = {}) {
    if (typeof callback !== 'function') throw new TypeError('callback required');
    const { priority = 0, once = false, filter = null, label = null } = options;
    if (event.includes('*')) {
      const entry = { pattern: event, callback, priority, once, filter, label };
      this.wildcardListeners.push(entry);
      this.wildcardListeners.sort((a, b) => b.priority - a.priority);
      this._checkListenerLimit();
      return () => this._removeWildcard(entry);
    }
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    const entry = { callback, priority, once, filter, label };
    const arr = this.listeners.get(event);
    arr.push(entry);
    arr.sort((a, b) => b.priority - a.priority);
    this._checkListenerLimit();
    return () => this._removeExact(event, entry);
  }

  once(event, callback, options = {}) {
    return this.on(event, callback, { ...options, once: true });
  }

  onAny(callback, options = {}) {
    return this.on('*', callback, options);
  }

  off(event, callback) {
    if (!event) {
      this.listeners.clear();
      this.wildcardListeners = [];
      return;
    }
    if (event.includes('*')) {
      this.wildcardListeners = this.wildcardListeners.filter(e => {
        if (e.pattern !== event) return true;
        if (callback && e.callback !== callback) return true;
        return false;
      });
      return;
    }
    const arr = this.listeners.get(event);
    if (!arr) return;
    if (callback) {
      const filtered = arr.filter(e => e.callback !== callback);
      if (filtered.length) this.listeners.set(event, filtered);
      else this.listeners.delete(event);
    } else {
      this.listeners.delete(event);
    }
  }

  removeAll(event) {
    this.off(event);
  }

  use(middleware) {
    if (typeof middleware !== 'function') throw new TypeError('middleware must be fn');
    this._middleware.push(middleware);
    return () => {
      const idx = this._middleware.indexOf(middleware);
      if (idx !== -1) this._middleware.splice(idx, 1);
    };
  }

  emit(event, data) {
    if (typeof event !== 'string') throw new TypeError('event must be string');
    this._stats.emitted++;

    let currentEvent = event;
    let currentData = data;
    for (const mw of this._middleware) {
      try {
        const result = mw(currentEvent, currentData);
        if (result === false) {
          this._stats.middlewareBlocked++;
          return false;
        }
        if (result && typeof result === 'object' && result.__event) {
          currentEvent = result.__event;
          currentData = result.data;
        }
      } catch (err) {
        console.error('[EventBus] middleware error', err);
      }
    }

    if (this._dispatchDepth > 32) {
      this._stats.queued++;
      this._pendingEmits.push({ event: currentEvent, data: currentData });
      return true;
    }

    this._dispatchDepth++;
    try {
      const exact = this.listeners.get(currentEvent) || [];
      const wildcardMatches = [];
      for (const entry of this.wildcardListeners) {
        if (this._matchesPattern(currentEvent, entry.pattern)) {
          wildcardMatches.push(entry);
          this._stats.wildcardMatches++;
        }
      }
      const all = [...exact, ...wildcardMatches];
      all.sort((a, b) => b.priority - a.priority);
      const toRemove = [];
      for (const entry of all) {
        if (entry.filter && !entry.filter(currentData, currentEvent)) {
          this._stats.filtered++;
          continue;
        }
        try {
          entry.callback(currentData, currentEvent);
          this._stats.delivered++;
        } catch (err) {
          this._stats.errors++;
          console.error(`[EventBus] listener error "${currentEvent}"`, err);
        }
        if (entry.once) toRemove.push(entry);
      }
      for (const entry of toRemove) {
        if (entry.pattern) this._removeWildcard(entry);
        else this._removeExact(currentEvent, entry);
      }
      if (this.replaySize > 0) {
        if (!this.replayBuffer.has(currentEvent)) this.replayBuffer.set(currentEvent, []);
        const buf = this.replayBuffer.get(currentEvent);
        buf.push({ data: currentData, ts: Date.now() });
        while (buf.length > this.replaySize) buf.shift();
      }
      if (this.debug) console.debug(`[EventBus] ${currentEvent}`, { listeners: all.length });
      return true;
    } finally {
      this._dispatchDepth--;
      if (this._dispatchDepth === 0 && this._pendingEmits.length) {
        const pending = this._pendingEmits.splice(0);
        for (const p of pending) this.emit(p.event, p.data);
      }
    }
  }

  async emitAsync(event, data) {
    const exact = this.listeners.get(event) || [];
    const wildcardMatches = this.wildcardListeners.filter(e =>
      this._matchesPattern(event, e.pattern)
    );
    const all = [...exact, ...wildcardMatches];
    all.sort((a, b) => b.priority - a.priority);
    const results = [];
    for (const entry of all) {
      if (entry.filter && !entry.filter(data, event)) continue;
      try {
        const r = await entry.callback(data, event);
        results.push({ ok: true, value: r });
      } catch (err) {
        results.push({ ok: false, error: err });
      }
    }
    return results;
  }

  request(event, data, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const responseEvent = `${event}:response:${this._uid()}`;
      const timer = setTimeout(() => {
        this.off(responseEvent);
        reject(new Error(`Event request timeout: ${event}`));
      }, timeoutMs);
      this.once(responseEvent, (resp) => {
        clearTimeout(timer);
        resolve(resp);
      });
      this.emit(event, { ...data, __replyTo: responseEvent });
    });
  }

  reply(replyTo, response) {
    if (!replyTo) return;
    this.emit(replyTo, response);
  }

  pipe(otherBus, events) {
    const unbinds = [];
    const list = Array.isArray(events) ? events : events ? [events] : ['*'];
    for (const ev of list) {
      unbinds.push(this.on(ev, (data, name) => otherBus.emit(name, data)));
    }
    return () => unbinds.forEach(fn => fn());
  }

  replay(event, callback) {
    const buf = this.replayBuffer.get(event) || [];
    for (const item of buf) {
      try { callback(item.data); } catch {}
    }
  }

  listenerCount(event) {
    let count = (this.listeners.get(event) || []).length;
    for (const entry of this.wildcardListeners) {
      if (this._matchesPattern(event, entry.pattern)) count++;
    }
    return count;
  }

  eventNames() {
    const names = new Set(this.listeners.keys());
    for (const e of this.wildcardListeners) names.add(e.pattern);
    return Array.from(names);
  }

  hasListeners(event) {
    return this.listenerCount(event) > 0;
  }

  getStats() {
    return {
      ...this._stats,
      events: this.listeners.size,
      wildcards: this.wildcardListeners.length,
      totalListeners:
        Array.from(this.listeners.values()).reduce((s, a) => s + a.length, 0) +
        this.wildcardListeners.length,
      replayBufferSize: Array.from(this.replayBuffer.values())
        .reduce((s, a) => s + a.length, 0),
      middleware: this._middleware.length,
    };
  }

  waitFor(event, timeoutMs = 10000, filter = null) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const off = this.on(event, (data) => {
        if (filter && !filter(data)) return;
        if (timer) clearTimeout(timer);
        off();
        resolve(data);
      });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          off();
          reject(new Error(`waitFor timeout: ${event}`));
        }, timeoutMs);
      }
    });
  }

  waitForAny(events, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const offs = [];
      let timer = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        for (const off of offs) { try { off(); } catch {} }
      };
      for (const ev of events) {
        offs.push(this.on(ev, (data) => {
          cleanup();
          resolve({ event: ev, data });
        }));
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`waitForAny timeout: ${events.join(',')}`));
        }, timeoutMs);
      }
    });
  }

  debounceEmit(event, data, delayMs = 100) {
    if (this._debounceTimers.has(event)) clearTimeout(this._debounceTimers.get(event));
    const timer = setTimeout(() => {
      this._debounceTimers.delete(event);
      this.emit(event, data);
    }, delayMs);
    this._debounceTimers.set(event, timer);
  }

  throttleEmit(event, data, limitMs = 100) {
    if (this._throttleState.has(event)) return false;
    this._throttleState.set(event, true);
    this.emit(event, data);
    setTimeout(() => this._throttleState.delete(event), limitMs);
    return true;
  }

  reset() {
    for (const timer of this._debounceTimers.values()) clearTimeout(timer);
    this._debounceTimers.clear();
    this._throttleState.clear();
    this.listeners.clear();
    this.wildcardListeners = [];
    this.replayBuffer.clear();
    this._pendingEmits = [];
    this._middleware = [];
    this._stats = {
      emitted: 0, delivered: 0, errors: 0, wildcardMatches: 0,
      filtered: 0, middlewareBlocked: 0, queued: 0,
    };
  }

  _matchesPattern(event, pattern) {
    if (pattern === '*') return true;
    if (pattern.endsWith('**')) {
      const prefix = pattern.slice(0, -2);
      return event.startsWith(prefix);
    }
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return event.startsWith(prefix);
    }
    if (pattern.startsWith('*')) {
      const suffix = pattern.slice(1);
      return event.endsWith(suffix);
    }
    if (pattern.includes('*')) {
      const parts = pattern.split('*');
      let idx = 0;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        const found = event.indexOf(part, idx);
        if (found === -1) return false;
        if (i === 0 && !pattern.startsWith('*') && found !== 0) return false;
        idx = found + part.length;
      }
      if (!pattern.endsWith('*') && idx !== event.length) {
        const lastPart = parts[parts.length - 1];
        if (lastPart && !event.endsWith(lastPart)) return false;
      }
      return true;
    }
    return event === pattern;
  }

  _removeExact(event, entry) {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(entry);
    if (idx !== -1) arr.splice(idx, 1);
    if (!arr.length) this.listeners.delete(event);
  }

  _removeWildcard(entry) {
    const idx = this.wildcardListeners.indexOf(entry);
    if (idx !== -1) this.wildcardListeners.splice(idx, 1);
  }

  _checkListenerLimit() {
    const total = this.listenerCount('*');
    if (total > this.maxListeners) {
      console.warn(`[EventBus] listener count ${total} exceeds limit`);
    }
  }

  _uid() {
    return Math.random().toString(36).slice(2, 10);
  }
}

export class ScopedEventBus {
  constructor(parent, scope) {
    this.parent = parent;
    this.scope = scope;
    this._owns = [];
  }
  on(event, cb, opts) {
    const off = this.parent.on(`${this.scope}:${event}`, cb, opts);
    this._owns.push(off);
    return off;
  }
  once(event, cb, opts) {
    return this.on(event, cb, { ...opts, once: true });
  }
  emit(event, data) {
    this.parent.emit(`${this.scope}:${event}`, data);
  }
  off(event, cb) {
    this.parent.off(`${this.scope}:${event}`, cb);
  }
  dispose() {
    for (const off of this._owns) { try { off(); } catch {} }
    this._owns = [];
  }
}

export class StatefulEventBus extends EventBus {
  constructor(options = {}) {
    super({ replaySize: 1, ...options });
    this.lastData = new Map();
  }
  emit(event, data) {
    this.lastData.set(event, data);
    super.emit(event, data);
  }
  getLast(event) {
    return this.lastData.get(event);
  }
  subscribeWithReplay(event, cb, opts) {
    const last = this.lastData.get(event);
    if (last !== undefined) {
      try { cb(last, event); } catch {}
    }
    return this.on(event, cb, opts);
  }
}

export class BufferedEventBus extends EventBus {
  constructor(options = {}) {
    super(options);
    this.bufferMs = options.bufferMs || 50;
    this._buffer = [];
    this._flushTimer = null;
  }
  emit(event, data) {
    this._buffer.push({ event, data });
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => this._flush(), this.bufferMs);
  }
  _flush() {
    const items = this._buffer.splice(0);
    this._flushTimer = null;
    const grouped = new Map();
    for (const item of items) {
      if (!grouped.has(item.event)) grouped.set(item.event, []);
      grouped.get(item.event).push(item.data);
    }
    for (const [event, dataList] of grouped) {
      super.emit(event, dataList.length === 1 ? dataList[0] : dataList);
    }
  }
  flushNow() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    this._flush();
  }
}
