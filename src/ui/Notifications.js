// =============================================================================
// src/ui/Notifications.js
// =============================================================================
// Toast notification system with stacking, auto-dismiss, types, and actions.
// =============================================================================

export class Notifications {
  constructor(container) {
    this.container = container;
    this.notifications = [];
    this.maxVisible = 5;
    this.defaultDuration = 3000; // ms

    // Create a container for toasts
    this.toastContainer = document.createElement('div');
    this.toastContainer.style.position = 'fixed';
    this.toastContainer.style.top = '70px';
    this.toastContainer.style.right = '20px';
    this.toastContainer.style.zIndex = '9999';
    this.toastContainer.style.display = 'flex';
    this.toastContainer.style.flexDirection = 'column';
    this.toastContainer.style.gap = '8px';
    this.toastContainer.style.maxWidth = '400px';
    this.toastContainer.style.width = '100%';
    this.toastContainer.style.pointerEvents = 'none';
    document.body.appendChild(this.toastContainer);
  }

  /**
   * Show a notification
   * @param {string} message - Message text
   * @param {string} type - 'info', 'success', 'warning', 'error'
   * @param {number} duration - Milliseconds to show (0 for persistent)
   * @param {Object} actions - { label, callback }[]
   */
  show(message, type = 'info', duration = this.defaultDuration, actions = []) {
    const toast = document.createElement('div');
    toast.style.pointerEvents = 'auto';
    toast.style.backgroundColor = 'var(--bg-panel)';
    toast.style.border = `1px solid ${this._getColor(type)}`;
    toast.style.borderRadius = '6px';
    toast.style.padding = '12px 16px';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
    toast.style.display = 'flex';
    toast.style.flexDirection = 'column';
    toast.style.gap = '8px';
    toast.style.animation = 'slideIn 0.3s ease';

    // Header: icon + message
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '10px';

    const icon = document.createElement('i');
    const iconMap = {
      info: 'fa-info-circle',
      success: 'fa-check-circle',
      warning: 'fa-exclamation-triangle',
      error: 'fa-times-circle',
    };
    icon.className = `fas ${iconMap[type] || 'fa-info-circle'}`;
    icon.style.color = this._getColor(type);
    icon.style.fontSize = '18px';
    header.appendChild(icon);

    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    msgSpan.style.fontSize = '14px';
    msgSpan.style.color = 'white';
    msgSpan.style.flex = '1';
    header.appendChild(msgSpan);

    // Close button
    const closeBtn = document.createElement('i');
    closeBtn.className = 'fas fa-times';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.color = 'var(--text-muted)';
    closeBtn.style.fontSize = '14px';
    closeBtn.addEventListener('click', () => {
      this._remove(toast);
    });
    header.appendChild(closeBtn);

    toast.appendChild(header);

    // Actions
    if (actions.length) {
      const actionBar = document.createElement('div');
      actionBar.style.display = 'flex';
      actionBar.style.gap = '8px';
      actionBar.style.justifyContent = 'flex-end';
      for (const act of actions) {
        const btn = document.createElement('button');
        btn.textContent = act.label;
        btn.style.padding = '4px 12px';
        btn.style.borderRadius = '4px';
        btn.style.border = '1px solid var(--nexus-cyan)';
        btn.style.backgroundColor = 'transparent';
        btn.style.color = 'var(--nexus-cyan)';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '12px';
        btn.addEventListener('click', () => {
          if (act.callback) act.callback();
          this._remove(toast);
        });
        actionBar.appendChild(btn);
      }
      toast.appendChild(actionBar);
    }

    // Add to container
    this.toastContainer.appendChild(toast);
    this.notifications.push(toast);

    // Limit visible
    while (this.toastContainer.children.length > this.maxVisible) {
      const first = this.toastContainer.children[0];
      if (first) this._remove(first);
    }

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => {
        this._remove(toast);
      }, duration);
    }

    return toast;
  }

  /**
   * Remove a toast
   */
  _remove(toast) {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    }
    const idx = this.notifications.indexOf(toast);
    if (idx !== -1) this.notifications.splice(idx, 1);
  }

  /**
   * Clear all notifications
   */
  clear() {
    while (this.toastContainer.firstChild) {
      this._remove(this.toastContainer.firstChild);
    }
    this.notifications = [];
  }

  /**
   * Get color for type
   */
  _getColor(type) {
    switch (type) {
      case 'info': return 'var(--nexus-cyan)';
      case 'success': return '#00ff41';
      case 'warning': return '#ffcc00';
      case 'error': return '#ff003c';
      default: return '#666';
    }
  }
}

// Add a small keyframe for slideIn animation
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
  }
`;
document.head.appendChild(style);