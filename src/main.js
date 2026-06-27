// =============================================================================
// src/main.js
// =============================================================================
// Entry point – Bootstraps the application, sets up dependency injection,
// error boundaries, and initializes the core modules.
// =============================================================================

import { App } from './core/App.js';
import { EventBus } from './core/EventBus.js';
import { StateManager } from './core/StateManager.js';
import { VFS } from './core/VFS.js';
import { ThemeManager } from './core/ThemeManager.js';
import { PluginRegistry } from './core/PluginRegistry.js';

// Simple DI container – holds shared instances
const DI = {
  eventBus: null,
  stateManager: null,
  vfs: null,
  themeManager: null,
  pluginRegistry: null,
  app: null,
};

/**
 * Bootstrap the application
 * @param {Object} options - { onProgress, onReady, onError }
 */
export async function bootstrap(options = {}) {
  const { onProgress = () => {}, onReady = () => {}, onError = () => {} } = options;

  try {
    onProgress('Initializing EventBus...');
    DI.eventBus = new EventBus();

    onProgress('Initializing ThemeManager...');
    DI.themeManager = new ThemeManager();

    onProgress('Initializing PluginRegistry...');
    DI.pluginRegistry = new PluginRegistry();

    onProgress('Initializing StateManager...');
    DI.stateManager = new StateManager();

    onProgress('Initializing VFS (IndexedDB)...');
    DI.vfs = new VFS({ persistence: true });

    onProgress('Loading VFS from storage...');
    await DI.vfs.loadFromDB();

    onProgress('Creating App instance...');
    DI.app = new App({
      eventBus: DI.eventBus,
      stateManager: DI.stateManager,
      vfs: DI.vfs,
      themeManager: DI.themeManager,
      pluginRegistry: DI.pluginRegistry,
    });

    onProgress('Mounting UI...');
    DI.app.mount(document.getElementById('app'));

    onProgress('NEXUS ready.');

    // Expose DI globally for debugging (optional)
    window.__NEXUS_DI = DI;

    onReady();
  } catch (err) {
    console.error('Fatal error during bootstrap:', err);
    onError(err);
  }
}

// Global error boundary for unhandled exceptions
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error || event.message);
  // Optionally, show a notification via app if available
  if (DI.app) {
    DI.app.showError?.(event.error || event.message);
  }
});

// Unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  if (DI.app) {
    DI.app.showError?.(event.reason);
  }
});