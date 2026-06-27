// =============================================================================
// src/core/StateManager.js
// =============================================================================
// Manages undo/redo history with compression (simple JSON serialization).
// Stores snapshots of application state.
// =============================================================================

export class StateManager {
  constructor(options = {}) {
    this.maxHistory = options.maxHistory || 50;
    this.history = [];
    this.currentIndex = -1;
    this.enabled = true;

    // Load persisted history from localStorage
    this._loadPersisted();
  }

  /**
   * Push a new state onto the history
   * @param {Object} state - The state to save (should be serializable)
   */
  pushState(state) {
    if (!this.enabled) return;

    // If we are not at the end of history, discard future states
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }

    // Add new state (deep clone)
    const cloned = this._cloneState(state);
    this.history.push(cloned);
    this.currentIndex = this.history.length - 1;

    // Trim history if exceeds max
    if (this.history.length > this.maxHistory) {
      this.history.shift();
      this.currentIndex--;
    }

    // Persist to localStorage
    this._persist();
  }

  /**
   * Undo: move back one step
   * @returns {Object|null} The restored state, or null if none
   */
  undo() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      const state = this._cloneState(this.history[this.currentIndex]);
      this._persist();
      return state;
    }
    return null;
  }

  /**
   * Redo: move forward one step
   * @returns {Object|null} The restored state, or null if none
   */
  redo() {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      const state = this._cloneState(this.history[this.currentIndex]);
      this._persist();
      return state;
    }
    return null;
  }

  /**
   * Get the current state (the one at currentIndex)
   */
  getCurrentState() {
    if (this.currentIndex >= 0 && this.currentIndex < this.history.length) {
      return this._cloneState(this.history[this.currentIndex]);
    }
    return null;
  }

  /**
   * Clear all history
   */
  clear() {
    this.history = [];
    this.currentIndex = -1;
    this._persist();
  }

  /**
   * Enable/disable state recording (useful during bulk operations)
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  _cloneState(state) {
    // Deep clone using JSON (works for plain objects with no functions)
    return JSON.parse(JSON.stringify(state));
  }

  _persist() {
    try {
      const data = JSON.stringify({
        history: this.history,
        currentIndex: this.currentIndex,
      });
      localStorage.setItem('nexus-history', data);
    } catch (e) {
      // Silently ignore (storage full or not supported)
    }
  }

  _loadPersisted() {
    try {
      const raw = localStorage.getItem('nexus-history');
      if (raw) {
        const data = JSON.parse(raw);
        this.history = data.history || [];
        this.currentIndex = data.currentIndex ?? -1;
        // Ensure currentIndex is valid
        if (this.currentIndex >= this.history.length) {
          this.currentIndex = this.history.length - 1;
        }
      }
    } catch (e) {
      // Ignore
    }
  }
}