const DEFAULT_TIMEOUT = 15000;
const MAX_PLUGINS = 128;

export class PluginRegistry {
  constructor(options = {}) {
    this.plugins = new Map();
    this.instances = new Map();
    this.loaders = new Map();
    this.priority = new Map();
    this.dependencies = new Map();
    this.version = new Map();
    this.sandboxed = new Map();
    this.enabled = new Map();
    this.log = [];
    this.maxLog = options.maxLog || 500;
    this.loadTimeout = options.loadTimeout || DEFAULT_TIMEOUT;
    this._listeners = new Set();
    this._stats = {
      registered: 0,
      unregistered: 0,
      initialized: 0,
      destroyed: 0,
      errors: 0,
      lazyLoaded: 0,
      hotSwaps: 0,
    };
  }

  register(type, plugin, options = {}) {
    if (!type || typeof type !== 'string') throw new TypeError('type required');
    if (!plugin || typeof plugin !== 'object') throw new TypeError('plugin object required');
    if (this.plugins.size >= MAX_PLUGINS) throw new Error('plugin limit reached');
    const meta = {
      type,
      name: plugin.name || type,
      version: options.version || plugin.version || '1.0.0',
      priority: options.priority || plugin.priority || 0,
      dependencies: options.dependencies || plugin.dependencies || [],
      sandbox: options.sandbox || plugin.sandbox || false,
      lazy: options.lazy || plugin.lazy || false,
      aliases: options.aliases || plugin.aliases || [],
      author: options.author || plugin.author || null,
      description: options.description || plugin.description || null,
      registeredAt: Date.now(),
    };
    if (this.plugins.has(type)) {
      this._log('warn', `overwriting plugin for type "${type}"`);
      this._destroyInstance(type);
    }
    this.plugins.set(type, plugin);
    this.priority.set(type, meta.priority);
    this.version.set(type, meta.version);
    this.dependencies.set(type, meta.dependencies);
    this.sandboxed.set(type, meta.sandbox);
    this.enabled.set(type, true);
    for (const alias of meta.aliases) {
      this.plugins.set(alias, plugin);
      this.priority.set(alias, meta.priority);
    }
    this._stats.registered++;
    this._emit('registered', { type, meta });
    return meta;
  }

  unregister(type) {
    if (!this.plugins.has(type)) return false;
    this._destroyInstance(type);
    this.plugins.delete(type);
    this.priority.delete(type);
    this.version.delete(type);
    this.dependencies.delete(type);
    this.sandboxed.delete(type);
    this.enabled.delete(type);
    this._stats.unregistered++;
    this._emit('unregistered', { type });
    return true;
  }

  registerLazy(type, loader, options = {}) {
    if (typeof loader !== 'function') throw new TypeError('loader must be a function');
    this.loaders.set(type, loader);
    return this.register(type, { name: type, lazy: true, __lazy: true }, { ...options, lazy: true });
  }

  getPlugin(type) {
    if (this.plugins.has(type)) return this.plugins.get(type);
    return null;
  }

  hasPlugin(type) {
    return this.plugins.has(type);
  }

  async resolve(type) {
    if (this.plugins.has(type)) return this.plugins.get(type);
    if (this.loaders.has(type)) {
      this._stats.lazyLoaded++;
      try {
        const loaded = await Promise.race([
          Promise.resolve(this.loaders.get(type)()),
          new Promise((_, rej) => setTimeout(() => rej(new Error('load timeout')), this.loadTimeout)),
        ]);
        const plugin = loaded?.default || loaded;
        if (!plugin) throw new Error('loader returned nothing');
        this.plugins.set(type, plugin);
        this.enabled.set(type, true);
        return plugin;
      } catch (err) {
        this._stats.errors++;
        this._log('error', `lazy load failed for ${type}: ${err.message}`);
        throw err;
      }
    }
    return null;
  }

  async initPlugin(path, file, surface, tools) {
    const type = file.type;
    const plugin = await this.resolve(type);
    if (!plugin) {
      const fallback = await this.resolve('BINARY') || await this.resolve('TEXT');
      if (!fallback) throw new Error(`No plugin for type: ${type}`);
      return this._runPlugin(path, file, surface, tools, fallback, 'fallback');
    }
    if (!this._checkDependencies(type)) {
      throw new Error(`Missing dependencies for ${type}`);
    }
    return this._runPlugin(path, file, surface, tools, plugin, type);
  }

  async _runPlugin(path, file, surface, tools, plugin, resolvedType) {
    if (this.instances.has(path)) this.destroyPlugin(path);
    if (typeof plugin.init !== 'function') {
      throw new Error(`plugin ${resolvedType} missing init`);
    }
    const start = performance.now();
    try {
      const target = this.sandboxed.get(resolvedType) ? this._sandbox(surface, tools) : { surface, tools };
      const instance = await Promise.race([
        Promise.resolve(plugin.init(target.surface, target.tools, file)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('init timeout')), this.loadTimeout)),
      ]);
      const wrapped = {
        __plugin: plugin,
        __type: resolvedType,
        __path: path,
        __startedAt: start,
        __duration: performance.now() - start,
        instance: instance || {},
        save: instance && typeof instance.save === 'function' ? instance.save.bind(instance) : null,
        destroy: instance && typeof instance.destroy === 'function' ? instance.destroy.bind(instance) : null,
      };
      this.instances.set(path, wrapped);
      this._stats.initialized++;
      this._emit('initialized', { path, type: resolvedType, duration: wrapped.__duration });
      return wrapped;
    } catch (err) {
      this._stats.errors++;
      this._log('error', `init failed for ${path} (${resolvedType}): ${err.message}`);
      throw err;
    }
  }

  async savePlugin(path) {
    const entry = this.instances.get(path);
    if (!entry) return null;
    if (typeof entry.save === 'function') {
      try { return await entry.save(); }
      catch (e) { this._stats.errors++; throw e; }
    }
    return null;
  }

  destroyPlugin(path) {
    const entry = this.instances.get(path);
    if (!entry) return false;
    try {
      if (typeof entry.destroy === 'function') entry.destroy();
      else if (entry.instance && typeof entry.instance.destroy === 'function') entry.instance.destroy();
      this._stats.destroyed++;
    } catch (err) {
      this._stats.errors++;
      this._log('error', `destroy failed for ${path}: ${err.message}`);
    }
    this.instances.delete(path);
    return true;
  }

  _destroyInstance(type) {
    for (const [path, entry] of this.instances) {
      if (entry.__type === type) this.destroyPlugin(path);
    }
  }

  async hotSwap(type, newPlugin, options = {}) {
    const oldPlugin = this.plugins.get(type);
    if (!oldPlugin) return this.register(type, newPlugin, options);
    const affectedPaths = [];
    for (const [path, entry] of this.instances) {
      if (entry.__type === type) affectedPaths.push(path);
    }
    this._stats.hotSwaps++;
    for (const path of affectedPaths) this.destroyPlugin(path);
    const meta = this.register(type, newPlugin, options);
    this._emit('hot-swapped', { type, affectedPaths, meta });
    return meta;
  }

  setPriority(type, priority) {
    if (!this.plugins.has(type)) return false;
    this.priority.set(type, priority);
    this._emit('priority', { type, priority });
    return true;
  }

  setEnabled(type, enabled) {
    this.enabled.set(type, !!enabled);
    this._emit('enabled', { type, enabled: !!enabled });
  }

  isEnabled(type) {
    return this.enabled.get(type) !== false;
  }

  registerAlias(alias, targetType) {
    const plugin = this.plugins.get(targetType);
    if (!plugin) return false;
    this.plugins.set(alias, plugin);
    this.priority.set(alias, this.priority.get(targetType) || 0);
    return true;
  }

  listPlugins() {
    const out = [];
    const seen = new Set();
    for (const [type, plugin] of this.plugins) {
      if (seen.has(plugin)) continue;
      seen.add(plugin);
      out.push({
        type,
        name: plugin.name || type,
        version: this.version.get(type),
        priority: this.priority.get(type),
        dependencies: this.dependencies.get(type) || [],
        sandboxed: this.sandboxed.get(type) || false,
        enabled: this.enabled.get(type) !== false,
        loaded: !plugin.__lazy,
      });
    }
    return out.sort((a, b) => b.priority - a.priority);
  }

  getRegisteredTypes() {
    return Array.from(this.plugins.keys());
  }

  listInstances() {
    return Array.from(this.instances.entries()).map(([path, entry]) => ({
      path,
      type: entry.__type,
      duration: entry.__duration,
      startedAt: entry.__startedAt,
    }));
  }

  getStats() {
    return {
      ...this._stats,
      pluginCount: this.plugins.size,
      instanceCount: this.instances.size,
      loaders: this.loaders.size,
      sandboxed: Array.from(this.sandboxed.values()).filter(Boolean).length,
    };
  }

  getLog() {
    return [...this.log];
  }

  clearLog() {
    this.log = [];
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _checkDependencies(type) {
    const deps = this.dependencies.get(type) || [];
    for (const dep of deps) {
      if (!this.plugins.has(dep) && !this.loaders.has(dep)) return false;
    }
    return true;
  }

  async loadDependencies(type) {
    const deps = this.dependencies.get(type) || [];
    for (const dep of deps) {
      if (!this.plugins.has(dep)) await this.resolve(dep);
    }
    return true;
  }

  _sandbox(surface, tools) {
    const safeDiv = (parent) => {
      const div = document.createElement('div');
      div.style.cssText = 'width:100%;height:100%;position:relative;overflow:auto;';
      return div;
    };
    const safeSurface = safeDiv(surface);
    const safeTools = safeDiv(tools);
    if (surface) {
      surface.innerHTML = '';
      surface.appendChild(safeSurface);
    }
    if (tools) {
      tools.innerHTML = '';
      tools.appendChild(safeTools);
    }
    return { surface: safeSurface, tools: safeTools };
  }

  _log(level, message) {
    this.log.push({ level, message, ts: Date.now() });
    if (this.log.length > this.maxLog) this.log.shift();
  }

  _emit(type, payload) {
    for (const fn of this._listeners) {
      try { fn({ type, ...payload, ts: Date.now() }); } catch {}
    }
  }

  destroyAll() {
    for (const path of Array.from(this.instances.keys())) this.destroyPlugin(path);
    return this._stats.destroyed;
  }

  reset() {
    this.destroyAll();
    this.plugins.clear();
    this.instances.clear();
    this.loaders.clear();
    this.priority.clear();
    this.dependencies.clear();
    this.version.clear();
    this.sandboxed.clear();
    this.enabled.clear();
    this.log = [];
    this._stats = {
      registered: 0, unregistered: 0, initialized: 0,
      destroyed: 0, errors: 0, lazyLoaded: 0, hotSwaps: 0,
    };
  }
}
