const ANIM_DURATION = 220;
const SWIPE_THRESHOLD = 80;

const DEFAULT_DURATIONS = {
  info: 3500,
  success: 2500,
  warning: 4000,
  error: 6000,
  progress: 0,
};

const ICON_MAP = {
  info: 'fa-info-circle',
  success: 'fa-check-circle',
  warning: 'fa-exclamation-triangle',
  error: 'fa-times-circle',
  progress: 'fa-spinner fa-spin',
};

const COLOR_MAP = {
  info: 'var(--nexus-cyan)',
  success: '#00ff41',
  warning: '#ffcc00',
  error: '#ff003c',
  progress: '#8a2be2',
};

export class Notifications {
  constructor(container, options = {}) {
    this.container = container || document.body;
    this.maxVisible = options.maxVisible || 5;
    this.position = options.position || 'top-right';
    this.defaultDuration = options.defaultDuration || 3000;
    this.notifications = [];
    this._byId = new Map();
    this._counter = 0;
    this._injectStyles();
    this._createHost();
  }

  _injectStyles() {
    if (document.getElementById('nexus-notif-styles')) return;
    const style = document.createElement('style');
    style.id = 'nexus-notif-styles';
    style.textContent = `
      @keyframes nx-slide-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes nx-slide-in-left { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes nx-slide-in-up { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes nx-fade-out { to { opacity: 0; transform: translateX(24px); } }
      @keyframes nx-progress { from { transform: scaleX(1); } to { transform: scaleX(0); } }
      .nx-toast { animation: nx-slide-in ${ANIM_DURATION}ms cubic-bezier(0.2, 0.9, 0.3, 1); }
      .nx-toast.dismissing { opacity: 0; transform: translateX(24px); transition: all ${ANIM_DURATION}ms ease-in; }
      .nx-toast .nx-bar { animation: nx-progress linear forwards; transform-origin: left; }
    `;
    document.head.appendChild(style);
  }

  _createHost() {
    const host = document.createElement('div');
    host.id = 'nexus-notifications';
    const positions = {
      'top-right': 'top:70px;right:16px;align-items:flex-end;',
      'top-left': 'top:70px;left:16px;align-items:flex-start;',
      'bottom-right': 'bottom:70px;right:16px;align-items:flex-end;',
      'bottom-left': 'bottom:70px;left:16px;align-items:flex-start;',
      'top-center': 'top:70px;left:50%;transform:translateX(-50%);align-items:center;',
      'bottom-center': 'bottom:70px;left:50%;transform:translateX(-50%);align-items:center;',
    };
    const posStyle = positions[this.position] || positions['top-right'];
    host.style.cssText = `position:fixed;${posStyle}display:flex;flex-direction:column;gap:8px;z-index:10000;max-width:min(380px,calc(100vw - 32px));pointer-events:none;`;
    document.body.appendChild(host);
    this.host = host;
  }

  show(message, type = 'info', duration = null, actions = [], options = {}) {
    const id = `nx-toast-${++this._counter}`;
    const actualDuration = duration !== null ? duration : (DEFAULT_DURATIONS[type] ?? this.defaultDuration);

    const toast = document.createElement('div');
    toast.className = 'nx-toast nexus-touch';
    toast.dataset.id = id;
    toast.dataset.type = type;
    toast.style.cssText = `
      pointer-events:auto;position:relative;overflow:hidden;
      background:var(--bg-panel,#1a1a1a);
      border:1px solid ${COLOR_MAP[type] || '#666'};
      border-radius:6px;padding:10px 12px;
      box-shadow:0 8px 24px rgba(0,0,0,0.55);
      display:flex;flex-direction:column;gap:6px;
      min-width:220px;max-width:100%;
      font-family:'Segoe UI',system-ui,sans-serif;
      color:white;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:flex-start;gap:10px;';

    const icon = document.createElement('i');
    icon.className = `fas ${ICON_MAP[type] || 'fa-info-circle'}`;
    icon.style.cssText = `color:${COLOR_MAP[type] || '#666'};font-size:15px;flex-shrink:0;margin-top:2px;`;
    header.appendChild(icon);

    const content = document.createElement('div');
    content.style.cssText = 'flex:1;min-width:0;';

    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:13px;line-height:1.4;word-break:break-word;';
    msg.textContent = message;
    content.appendChild(msg);

    if (options.subtext) {
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:11px;color:#888;margin-top:3px;';
      sub.textContent = options.subtext;
      content.appendChild(sub);
    }

    header.appendChild(content);

    const closeBtn = document.createElement('i');
    closeBtn.className = 'fas fa-times';
    closeBtn.style.cssText = 'color:#666;font-size:12px;cursor:pointer;padding:2px;flex-shrink:0;';
    closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#fff');
    closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = '#666');
    closeBtn.addEventListener('click', () => this._dismiss(id));
    header.appendChild(closeBtn);

    toast.appendChild(header);

    if (actions.length) {
      const actionBar = document.createElement('div');
      actionBar.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:2px;';
      for (const act of actions) {
        const btn = document.createElement('button');
        btn.className = 'nexus-touch';
        btn.textContent = act.label;
        btn.style.cssText = `padding:4px 10px;font-size:11px;border-radius:4px;border:1px solid ${COLOR_MAP[type]};background:transparent;color:${COLOR_MAP[type]};cursor:pointer;font-family:inherit;transition:background 0.12s;`;
        btn.addEventListener('mouseenter', () => btn.style.background = COLOR_MAP[type] + '22');
        btn.addEventListener('mouseleave', () => btn.style.background = 'transparent');
        btn.addEventListener('click', () => {
          try { act.callback?.(); } catch (e) { console.error(e); }
          if (act.dismiss !== false) this._dismiss(id);
        });
        actionBar.appendChild(btn);
      }
      toast.appendChild(actionBar);
    }

    if (options.progress != null) {
      const progressWrap = document.createElement('div');
      progressWrap.style.cssText = 'height:3px;background:#222;border-radius:2px;overflow:hidden;margin-top:2px;';
      const bar = document.createElement('div');
      bar.style.cssText = 'height:100%;background:' + (COLOR_MAP[type] || '#666') + ';width:' + Math.max(0, Math.min(100, options.progress)) + '%;transition:width 0.3s;';
      progressWrap.appendChild(bar);
      toast.appendChild(progressWrap);
      toast._progressBar = bar;
    }

    if (actualDuration > 0) {
      const timer = document.createElement('div');
      timer.className = 'nx-bar';
      timer.style.cssText = `position:absolute;bottom:0;left:0;height:2px;width:100%;background:${COLOR_MAP[type] || '#666'};opacity:0.4;animation-duration:${actualDuration}ms;`;
      toast.appendChild(timer);
      toast._timerEl = timer;
    }

    this.host.appendChild(toast);

    const entry = { id, toast, type, createdAt: Date.now(), duration: actualDuration, options };
    this.notifications.push(entry);
    this._byId.set(id, entry);

    if (actualDuration > 0 && !options.persist) {
      entry.timeoutId = setTimeout(() => this._dismiss(id), actualDuration);
    }

    if (options.onClick) {
      toast.style.cursor = 'pointer';
      toast.addEventListener('click', (e) => {
        if (e.target === closeBtn || e.target.tagName === 'BUTTON' || e.target.tagName === 'I') return;
        try { options.onClick(); } catch {}
      });
    }

    this._attachSwipe(toast, id);
    this._enforceLimit();

    return id;
  }

  update(id, patch = {}) {
    const entry = this._byId.get(id);
    if (!entry) return false;
    const { toast } = entry;
    if (patch.message != null) {
      const msgEl = toast.querySelector('div > div');
      if (msgEl) msgEl.textContent = patch.message;
    }
    if (patch.progress != null && toast._progressBar) {
      toast._progressBar.style.width = Math.max(0, Math.min(100, patch.progress)) + '%';
    }
    if (patch.duration != null) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      if (patch.duration > 0) {
        entry.timeoutId = setTimeout(() => this._dismiss(id), patch.duration);
      }
    }
    return true;
  }

  progress(message, options = {}) {
    return this.show(message, 'progress', 0, [], { progress: 0, persist: true, ...options });
  }

  success(message, duration = 2500) {
    return this.show(message, 'success', duration);
  }

  error(message, duration = 6000) {
    return this.show(message, 'error', duration);
  }

  warning(message, duration = 4000) {
    return this.show(message, 'warning', duration);
  }

  info(message, duration = 3000) {
    return this.show(message, 'info', duration);
  }

  _dismiss(id) {
    const entry = this._byId.get(id);
    if (!entry) return;
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    const { toast } = entry;
    toast.classList.add('dismissing');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      const idx = this.notifications.indexOf(entry);
      if (idx !== -1) this.notifications.splice(idx, 1);
      this._byId.delete(id);
    }, ANIM_DURATION);
  }

  dismissAll() {
    for (const id of Array.from(this._byId.keys())) this._dismiss(id);
  }

  clear() {
    this.host.innerHTML = '';
    for (const entry of this.notifications) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
    }
    this.notifications = [];
    this._byId.clear();
  }

  _enforceLimit() {
    while (this.host.children.length > this.maxVisible) {
      const first = this.host.firstElementChild;
      if (!first) break;
      this._dismiss(first.dataset.id);
    }
  }

  _attachSwipe(el, id) {
    let startX = 0, startY = 0;
    let currentX = 0;
    let dragging = false;

    const onStart = (clientX, clientY) => {
      startX = clientX;
      startY = clientY;
      currentX = clientX;
      dragging = true;
      el.style.transition = 'none';
    };
    const onMove = (clientX, clientY) => {
      if (!dragging) return;
      currentX = clientX;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (Math.abs(dx) > Math.abs(dy)) {
        el.style.transform = `translateX(${dx}px)`;
        el.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 200));
      }
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      const dx = currentX - startX;
      el.style.transition = '';
      if (Math.abs(dx) > SWIPE_THRESHOLD) {
        this._dismiss(id);
      } else {
        el.style.transform = '';
        el.style.opacity = '';
      }
    };

    el.addEventListener('touchstart', (e) => onStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    el.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
  }

  getStats() {
    return {
      count: this.notifications.length,
      byType: this.notifications.reduce((acc, n) => {
        acc[n.type] = (acc[n.type] || 0) + 1;
        return acc;
      }, {}),
    };
  }

  destroy() {
    this.clear();
    if (this.host && this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
    }
  }
}
