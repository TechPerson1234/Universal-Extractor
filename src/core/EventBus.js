// =============================================================================
// src/core/EventBus.js
// =============================================================================
// Central pub/sub with priority queues, wildcard matching, and once support.
// =============================================================================

export class EventBus {
  constructor() {
    // Map of event name -> array of listeners
    this.listeners = new Map();
    // For wildcard matching, we also store a pattern list
    this.wildcardListeners = []; // { pattern, listener, priority }
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name (can include * wildcard, e.g., "file:*")
   * @param {Function} callback
   * @param {Object} options - { priority: number (higher first), once: boolean }
   * @returns {Function} Unsubscribe function
   */
  on(event, callback, options = {}) {
    const { priority = 0, once = false } = options;

    if (event.includes('*')) {
      // Wildcard listener
      const entry = { pattern: event, callback, priority, once };
      this.wildcardListeners.push(entry);
      // Sort by priority descending
      this.wildcardListeners.sort((a, b) => b.priority - a.priority);
      return () => {
        const idx = this.wildcardListeners.indexOf(entry);
        if (idx !== -1) this.wildcardListeners.splice(idx, 1);
      };
    } else {
      // Exact match
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      const entry = { callback, priority, once };
      this.listeners.get(event).push(entry);
      // Sort by priority
      this.listeners.get(event).sort((a, b) => b.priority - a.priority);
      return () => {
        const arr = this.listeners.get(event);
        if (arr) {
          const idx = arr.indexOf(entry);
          if (idx !== -1) arr.splice(idx, 1);
          if (arr.length === 0) this.listeners.delete(event);
        }
      };
    }
  }

  /**
   * Subscribe once
   */
  once(event, callback, options = {}) {
    return this.on(event, callback, { ...options, once: true });
  }

  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {*} data - Data to pass to listeners
   */
  emit(event, data) {
    // Exact listeners
    const exactListeners = this.listeners.get(event) || [];
    // Wildcard listeners that match
    const wildcardMatches = this.wildcardListeners.filter(entry =>
      this._matchesPattern(event, entry.pattern)
    );

    // Combine and sort by priority (already sorted per list)
    const allListeners = [...exactListeners, ...wildcardMatches];
    // Sort globally by priority (though exact and wildcard each sorted, but we need overall order)
    allListeners.sort((a, b) => b.priority - a.priority);

    // Execute
    for (const entry of allListeners) {
      try {
        entry.callback(data);
      } catch (err) {
        console.error('Error in event listener:', err);
      }
      // If once, remove it
      if (entry.once) {
        // Remove from respective list
        if (entry.pattern) {
          const idx = this.wildcardListeners.indexOf(entry);
          if (idx !== -1) this.wildcardListeners.splice(idx, 1);
        } else {
          const arr = this.listeners.get(event);
          if (arr) {
            const idx = arr.indexOf(entry);
            if (idx !== -1) arr.splice(idx, 1);
            if (arr.length === 0) this.listeners.delete(event);
          }
        }
      }
    }
  }

  /**
   * Remove all listeners for an event (or all if no event)
   */
  off(event) {
    if (event) {
      this.listeners.delete(event);
      // Remove wildcard listeners that exactly match? We'll keep wildcards.
      // For wildcards, we might want to remove by pattern.
      this.wildcardListeners = this.wildcardListeners.filter(entry => entry.pattern !== event);
    } else {
      this.listeners.clear();
      this.wildcardListeners = [];
    }
  }

  /**
   * Check if an event name matches a pattern (supports * wildcard)
   */
  _matchesPattern(event, pattern) {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return event.startsWith(prefix);
    }
    if (pattern.startsWith('*')) {
      const suffix = pattern.slice(1);
      return event.endsWith(suffix);
    }
    return event === pattern;
  }

  /**
   * Get count of listeners for an event (for debugging)
   */
  listenerCount(event) {
    let count = (this.listeners.get(event) || []).length;
    count += this.wildcardListeners.filter(entry => this._matchesPattern(event, entry.pattern)).length;
    return count;
  }
}