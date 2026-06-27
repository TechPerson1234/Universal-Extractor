// =============================================================================
// src/core/ThemeManager.js
// =============================================================================
// Theme engine – applies CSS custom properties for themes, supports
// predefined themes and custom user-defined themes via CSS variables.
// =============================================================================

export class ThemeManager {
  constructor() {
    this.currentTheme = 'cyberpunk';
    this.customTheme = null; // user-defined overrides
    this.themes = {
      cyberpunk: {
        '--bg-void': '#050505',
        '--bg-surface': '#111111',
        '--bg-panel': '#1a1a1a',
        '--nexus-cyan': '#00f0ff',
        '--nexus-purple': '#8a2be2',
        '--nexus-red': '#ff003c',
        '--text-main': '#e0e0e0',
        '--text-muted': '#666666',
      },
      matrix: {
        '--bg-void': '#0a0f0a',
        '--bg-surface': '#0f1a0f',
        '--bg-panel': '#1a2a1a',
        '--nexus-cyan': '#00ff41',
        '--nexus-purple': '#00cc33',
        '--nexus-red': '#ff3366',
        '--text-main': '#ccffcc',
        '--text-muted': '#669966',
      },
      light: {
        '--bg-void': '#f0f0f0',
        '--bg-surface': '#ffffff',
        '--bg-panel': '#e0e0e0',
        '--nexus-cyan': '#0066cc',
        '--nexus-purple': '#6600cc',
        '--nexus-red': '#cc0033',
        '--text-main': '#111111',
        '--text-muted': '#666666',
      },
      dark: {
        '--bg-void': '#121212',
        '--bg-surface': '#1e1e1e',
        '--bg-panel': '#2d2d2d',
        '--nexus-cyan': '#4fc3f7',
        '--nexus-purple': '#ce93d8',
        '--nexus-red': '#ef5350',
        '--text-main': '#e0e0e0',
        '--text-muted': '#9e9e9e',
      }
    };
    // Load saved theme
    const saved = localStorage.getItem('nexus-theme');
    if (saved && this.themes[saved]) {
      this.currentTheme = saved;
    } else {
      // Default
      this.currentTheme = 'cyberpunk';
    }
    // Apply immediately
    this.apply(this.currentTheme);
  }

  /**
   * Apply a named theme or custom theme object
   * @param {string|Object} theme - Theme name or object with CSS variable key-value pairs
   */
  apply(theme) {
    let variables = {};
    if (typeof theme === 'string') {
      if (this.themes[theme]) {
        variables = this.themes[theme];
        this.currentTheme = theme;
        localStorage.setItem('nexus-theme', theme);
      } else {
        console.warn('Theme not found:', theme);
        return;
      }
    } else if (typeof theme === 'object') {
      // Custom theme object
      variables = theme;
      this.customTheme = theme;
      this.currentTheme = 'custom';
      localStorage.setItem('nexus-theme', 'custom');
    } else {
      return;
    }

    // Apply variables to :root
    const root = document.documentElement;
    for (const [key, value] of Object.entries(variables)) {
      root.style.setProperty(key, value);
    }
  }

  /**
   * Get current theme variables
   */
  getCurrentTheme() {
    if (this.currentTheme === 'custom' && this.customTheme) {
      return this.customTheme;
    }
    return this.themes[this.currentTheme] || {};
  }

  /**
   * Get list of available theme names
   */
  getThemeNames() {
    return Object.keys(this.themes);
  }

  /**
   * Set a custom theme (object of CSS variables)
   */
  setCustomTheme(variables) {
    this.customTheme = variables;
    this.apply(variables);
  }

  /**
   * Reset to default theme (cyberpunk)
   */
  reset() {
    this.apply('cyberpunk');
  }

  /**
   * Toggle between predefined themes (for quick switch)
   */
  toggle() {
    const names = this.getThemeNames();
    const idx = names.indexOf(this.currentTheme);
    const next = names[(idx + 1) % names.length];
    this.apply(next);
    return next;
  }
}