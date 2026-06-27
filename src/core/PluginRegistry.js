// =============================================================================
// src/core/PluginRegistry.js
// =============================================================================
// Manages plugin registration, lazy loading, and lifecycle.
// Plugins are objects with: type, name, init(surface, tools, file), save(), destroy().
// =============================================================================

// Import all plugins from the plugins file (will be loaded later)
// To avoid circular deps, we'll use a dynamic import or just a registry that plugins register themselves.
// We'll provide a register method, and the AllPlugins.js will import this and register.

export class PluginRegistry {
  constructor() {
    this.plugins = new Map(); // type -> plugin module
    this.activePlugin = null;
    this.pluginInstances = new Map(); // file path -> instance data
  }

  /**
   * Register a plugin for a file type
   * @param {string} type - File type (e.g., 'IMAGE', 'VIDEO')
   * @param {Object} plugin - Plugin object with required methods
   */
  register(type, plugin) {
    if (this.plugins.has(type)) {
      console.warn(`Plugin for type "${type}" already registered, overwriting.`);
    }
    this.plugins.set(type, plugin);
  }

  /**
   * Get a plugin by type (lazy load if not loaded)
   * @param {string} type
   * @returns {Object|null} Plugin module
   */
  getPlugin(type) {
    return this.plugins.get(type) || null;
  }

  /**
   * Load a plugin dynamically (if not already registered)
   * This could be used to load plugins from external files, but we'll keep it simple.
   * For now, all plugins are pre-registered in AllPlugins.js.
   */
  loadPlugin(type) {
    // Not needed for now, but could implement dynamic import
    return this.getPlugin(type);
  }

  /**
   * Initialize a plugin for a specific file
   * @param {string} path - File path
   * @param {Object} file - File object from VFS
   * @param {HTMLElement} surface - DOM element for main content
   * @param {HTMLElement} tools - DOM element for inspector tools
   * @returns {Promise<Object>} Plugin instance
   */
  async initPlugin(path, file, surface, tools) {
    const plugin = this.getPlugin(file.type);
    if (!plugin) {
      // Fallback to a generic binary/hex viewer
      const fallback = this.getPlugin('BINARY') || this.getPlugin('TEXT');
      if (fallback) {
        // Use fallback
        const instance = await fallback.init(surface, tools, file);
        this.pluginInstances.set(path, instance);
        return instance;
      }
      throw new Error(`No plugin for file type: ${file.type}`);
    }

    // Check if already instantiated for this path
    if (this.pluginInstances.has(path)) {
      // If we want to reuse? Better to destroy and re-init.
      this.destroyPlugin(path);
    }

    const instance = await plugin.init(surface, tools, file);
    this.pluginInstances.set(path, instance);
    return instance;
  }

  /**
   * Save the active plugin's content (if it has save method)
   * @param {string} path - File path
   */
  async savePlugin(path) {
    const instance = this.pluginInstances.get(path);
    if (instance && typeof instance.save === 'function') {
      return instance.save();
    }
    return null;
  }

  /**
   * Destroy a plugin instance (cleanup)
   * @param {string} path
   */
  destroyPlugin(path) {
    const instance = this.pluginInstances.get(path);
    if (instance && typeof instance.destroy === 'function') {
      instance.destroy();
    }
    this.pluginInstances.delete(path);
  }

  /**
   * Get all registered types
   */
  getRegisteredTypes() {
    return Array.from(this.plugins.keys());
  }
}

// We'll also expose a default instance? No, we'll let main create one.