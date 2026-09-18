const STORAGE_KEY = 'nexus-install-state';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export class InstallPrompt {
  constructor(options = {}) {
    this.options = options;
    this.onInstall = options.onInstall || (() => {});
    this.onDismiss = options.onDismiss || (() => {});
    this.onOffline = options.onOffline || (() => {});
    this.onOnline = options.onOnline || (() => {});
    this.onUpdate = options.onUpdate || (() => {});

    this.deferredPrompt = null;
    this.installed = false;
    this.dismissedAt = 0;
    this.offline = !navigator.onLine;
    this.updateAvailable = false;
    this.installSource = null;
    this._bannerEl = null;
    this._offlineEl = null;
    this._updateEl = null;
    this._listeners = new Set();

    this._loadState();
    this._detectDisplayMode();
    this._setupEventListeners();
  }

  init() {
    if (this._isStandalone()) {
      this.installed = true;
      return { alreadyInstalled: true };
    }
    if (this._shouldAutoShow()) {
      setTimeout(() => this.show(), 3000);
    }
    this._renderOfflineIndicator();
    this._renderUpdateNotification();
    return { initialized: true };
  }

  _detectDisplayMode() {
    this.displayMode = 'browser';
    if (window.matchMedia('(display-mode: standalone)').matches) this.displayMode = 'standalone';
    else if (window.matchMedia('(display-mode: fullscreen)').matches) this.displayMode = 'fullscreen';
    else if (window.matchMedia('(display-mode: minimal-ui)').matches) this.displayMode = 'minimal-ui';
    if (navigator.standalone) this.displayMode = 'standalone';

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    mediaQuery.addEventListener('change', (e) => {
      this.displayMode = e.matches ? 'standalone' : 'browser';
      if (e.matches) {
        this.installed = true;
        this._hideAll();
      }
    });
  }

  _isStandalone() {
    return this.displayMode === 'standalone' || navigator.standalone === true;
  }

  _setupEventListeners() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.installSource = 'beforeinstallprompt';
      this._emit('installable', { platform: this._detectPlatform() });
      if (!this._isCooldownActive()) {
        this.show();
      }
    });

    window.addEventListener('appinstalled', () => {
      this.installed = true;
      this.deferredPrompt = null;
      this._saveState({ installed: true, installedAt: Date.now() });
      this._hideBanner();
      this._emit('installed', {});
      this.onInstall({ installed: true });
    });

    window.addEventListener('online', () => {
      this.offline = false;
      this._updateOfflineIndicator();
      this._emit('online', {});
      this.onOnline();
    });

    window.addEventListener('offline', () => {
      this.offline = true;
      this._updateOfflineIndicator();
      this._emit('offline', {});
      this.onOffline();
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type } = event.data || {};
        if (type === 'UPDATE_AVAILABLE') {
          this.showUpdateNotification();
        }
      });
    }
  }

  async promptInstall() {
    if (this.installed) {
      this._emit('already-installed', {});
      return { outcome: 'already-installed' };
    }
    if (!this.deferredPrompt) {
      this._emit('install-unavailable', { reason: 'no-prompt' });
      this._showManualInstructions();
      return { outcome: 'manual' };
    }
    try {
      this.deferredPrompt.prompt();
      const choice = await this.deferredPrompt.userChoice;
      this.deferredPrompt = null;
      if (choice.outcome === 'accepted') {
        this._emit('install-accepted', { platform: choice.platform });
        this.onInstall({ installed: true, platform: choice.platform });
        this._hideBanner();
        this._saveState({ installed: true, installedAt: Date.now() });
      } else {
        this._emit('install-dismissed', {});
        this._saveState({ dismissedAt: Date.now() });
        this._hideBanner();
      }
      return choice;
    } catch (err) {
      this._emit('install-error', { error: err });
      return { outcome: 'error', error: err };
    }
  }

  dismiss() {
    this._saveState({ dismissedAt: Date.now() });
    this._hideBanner();
    this._emit('banner-dismissed', {});
    this.onDismiss();
  }

  show() {
    if (this.installed || this._isStandalone()) return;
    if (this._isCooldownActive()) return;
    if (this._bannerEl) return;
    this._renderInstallBanner();
  }

  hide() {
    this._hideBanner();
  }

  showUpdateNotification() {
    this.updateAvailable = true;
    this._renderUpdateNotification(true);
  }

  async applyUpdate() {
    if (!this.updateAvailable) return false;
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
      }
      this._emit('update-applying', {});
      this.onUpdate({ applying: true });
      setTimeout(() => window.location.reload(), 300);
      return true;
    } catch (err) {
      this._emit('update-error', { error: err });
      return false;
    }
  }

  _renderInstallBanner() {
    const platform = this._detectPlatform();
    const banner = document.createElement('div');
    banner.id = 'nexus-install-banner';
    banner.style.cssText = `
      position:fixed;bottom:20px;left:20px;right:20px;max-width:420px;margin:0 auto;
      background:linear-gradient(135deg,#1a1a1a,#0f0f0f);
      border:1px solid var(--nexus-cyan,#00f0ff);
      border-radius:10px;padding:14px 16px;
      box-shadow:0 12px 40px rgba(0,0,0,0.85), 0 0 24px rgba(0,240,255,0.15);
      z-index:9998;display:flex;gap:12px;align-items:flex-start;
      font-family:'Segoe UI',system-ui,sans-serif;
      animation:nexus-slide-up 0.35s cubic-bezier(0.2,0.9,0.3,1);
    `;

    const icon = document.createElement('div');
    icon.innerHTML = '<i class="fas fa-biohazard"></i>';
    icon.style.cssText = `
      width:40px;height:40px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
      background:rgba(0,240,255,0.1);border:1px solid var(--nexus-cyan,#00f0ff);
      border-radius:8px;color:var(--nexus-cyan,#00f0ff);font-size:20px;
    `;
    banner.appendChild(icon);

    const content = document.createElement('div');
    content.style.cssText = 'flex:1;min-width:0;';

    const title = document.createElement('div');
    title.textContent = 'Install NEXUS EXTRACTOR';
    title.style.cssText = 'color:#fff;font-weight:bold;font-size:14px;margin-bottom:4px;';
    content.appendChild(title);

    const desc = document.createElement('div');
    desc.textContent = this._getPlatformMessage(platform);
    desc.style.cssText = 'color:#888;font-size:12px;line-height:1.4;margin-bottom:12px;';
    content.appendChild(desc);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;';

    const installBtn = document.createElement('button');
    installBtn.textContent = 'Install';
    installBtn.style.cssText = `
      flex:1;padding:7px 14px;background:var(--nexus-cyan,#00f0ff);color:#000;
      border:none;border-radius:5px;cursor:pointer;font-weight:bold;font-size:12px;
      font-family:inherit;transition:opacity 0.15s;
    `;
    installBtn.addEventListener('mouseenter', () => installBtn.style.opacity = '0.85');
    installBtn.addEventListener('mouseleave', () => installBtn.style.opacity = '1');
    installBtn.addEventListener('click', () => this.promptInstall());
    actions.appendChild(installBtn);

    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Not now';
    dismissBtn.style.cssText = `
      padding:7px 14px;background:transparent;color:#888;
      border:1px solid #333;border-radius:5px;cursor:pointer;font-size:12px;
      font-family:inherit;transition:all 0.15s;
    `;
    dismissBtn.addEventListener('mouseenter', () => {
      dismissBtn.style.color = '#ccc';
      dismissBtn.style.borderColor = '#555';
    });
    dismissBtn.addEventListener('mouseleave', () => {
      dismissBtn.style.color = '#888';
      dismissBtn.style.borderColor = '#333';
    });
    dismissBtn.addEventListener('click', () => this.dismiss());
    actions.appendChild(dismissBtn);

    content.appendChild(actions);
    banner.appendChild(content);

    document.body.appendChild(banner);
    this._bannerEl = banner;
  }

  _showManualInstructions() {
    const platform = this._detectPlatform();
    const existing = document.getElementById('nexus-manual-install');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'nexus-manual-install';
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;
      display:flex;align-items:center;justify-content:center;padding:20px;
      backdrop-filter:blur(6px);
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#1a1a1a;border:1px solid #333;border-radius:10px;
      padding:24px;max-width:440px;width:100%;font-family:'Segoe UI',system-ui,sans-serif;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="color:#00f0ff;font-size:16px;font-weight:bold;">Install Manually</h3>
        <button id="nexus-manual-close" style="background:none;border:none;color:#666;font-size:22px;cursor:pointer;line-height:1;">&times;</button>
      </div>
      <div style="color:#ccc;font-size:13px;line-height:1.7;">
        ${this._getManualInstructions(platform)}
      </div>
      <button id="nexus-manual-ok" style="width:100%;margin-top:20px;padding:10px;background:var(--nexus-cyan,#00f0ff);color:#000;border:none;border-radius:5px;cursor:pointer;font-weight:bold;font-size:13px;">Got it</button>
    `;

    modal.appendChild(panel);
    document.body.appendChild(modal);

    const close = () => modal.remove();
    panel.querySelector('#nexus-manual-close').addEventListener('click', close);
    panel.querySelector('#nexus-manual-ok').addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
  }

  _renderOfflineIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'nexus-offline-indicator';
    indicator.style.cssText = `
      position:fixed;top:0;left:0;right:0;height:3px;
      background:transparent;z-index:9997;pointer-events:none;
      transition:background 0.3s;
    `;
    document.body.appendChild(indicator);
    this._offlineEl = indicator;
    this._updateOfflineIndicator();
  }

  _updateOfflineIndicator() {
    if (!this._offlineEl) return;
    if (this.offline) {
      this._offlineEl.style.background = 'linear-gradient(90deg,#ff003c,#ffcc00,#ff003c)';
      this._offlineEl.style.animation = 'nexus-offline-pulse 2s ease-in-out infinite';
      this._offlineEl.title = 'You are offline — NEXUS works offline';
    } else {
      this._offlineEl.style.background = 'transparent';
      this._offlineEl.style.animation = '';
      this._offlineEl.title = '';
    }
  }

  _renderUpdateNotification(show = false) {
    const existing = document.getElementById('nexus-update-toast');
    if (existing) existing.remove();
    if (!show) return;

    const toast = document.createElement('div');
    toast.id = 'nexus-update-toast';
    toast.style.cssText = `
      position:fixed;top:70px;right:20px;background:#1a1a1a;
      border:1px solid #8a2be2;border-radius:8px;padding:14px 16px;
      max-width:340px;z-index:9998;box-shadow:0 12px 32px rgba(0,0,0,0.85);
      font-family:'Segoe UI',system-ui,sans-serif;
      animation:nexus-slide-in-right 0.3s ease;
    `;

    toast.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <i class="fas fa-sync-alt" style="color:#8a2be2;font-size:16px;margin-top:2px;"></i>
        <div style="flex:1;">
          <div style="color:#fff;font-weight:bold;font-size:13px;margin-bottom:4px;">Update Available</div>
          <div style="color:#888;font-size:11px;margin-bottom:12px;">A new version of NEXUS is ready.</div>
          <div style="display:flex;gap:6px;">
            <button id="nexus-update-apply" style="flex:1;padding:6px 10px;background:#8a2be2;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">Update Now</button>
            <button id="nexus-update-later" style="padding:6px 10px;background:transparent;color:#666;border:1px solid #333;border-radius:4px;cursor:pointer;font-size:11px;">Later</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(toast);
    toast.querySelector('#nexus-update-apply').addEventListener('click', () => {
      this.applyUpdate();
      toast.remove();
    });
    toast.querySelector('#nexus-update-later').addEventListener('click', () => toast.remove());
    this._updateEl = toast;
  }

  _hideBanner() {
    if (this._bannerEl) {
      this._bannerEl.style.opacity = '0';
      this._bannerEl.style.transform = 'translateY(20px)';
      this._bannerEl.style.transition = 'all 0.25s ease';
      setTimeout(() => {
        if (this._bannerEl && this._bannerEl.parentNode) this._bannerEl.remove();
        this._bannerEl = null;
      }, 250);
    }
  }

  _hideAll() {
    this._hideBanner();
    if (this._updateEl) {
      this._updateEl.remove();
      this._updateEl = null;
    }
  }

  _shouldAutoShow() {
    if (this.installed || this._isStandalone()) return false;
    if (this._isCooldownActive()) return false;
    return true;
  }

  _isCooldownActive() {
    if (!this.dismissedAt) return false;
    return Date.now() - this.dismissedAt < DISMISS_COOLDOWN_MS;
  }

  _detectPlatform() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'android';
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Macintosh/.test(ua) && 'ontouchend' in document) return 'ios';
    if (/Windows/.test(ua)) return 'windows';
    if (/Macintosh/.test(ua)) return 'macos';
    if (/Linux/.test(ua)) return 'linux';
    return 'unknown';
  }

  _getPlatformMessage(platform) {
    const messages = {
      android: 'Add NEXUS to your home screen for the full app experience.',
      ios: 'Tap Share → Add to Home Screen to install NEXUS.',
      windows: 'Install NEXUS as a desktop app for offline access.',
      macos: 'Install NEXUS as a desktop app for offline access.',
      linux: 'Install NEXUS for offline access and native integration.',
      unknown: 'Install NEXUS for a native app experience and offline access.',
    };
    return messages[platform] || messages.unknown;
  }

  _getManualInstructions(platform) {
    const steps = {
      ios: `
        <ol style="padding-left:20px;margin:8px 0;">
          <li>Tap the <strong style="color:#00f0ff;">Share</strong> button <i class="fas fa-share"></i> in Safari</li>
          <li>Scroll down and tap <strong style="color:#00f0ff;">Add to Home Screen</strong></li>
          <li>Tap <strong style="color:#00f0ff;">Add</strong> to confirm</li>
        </ol>
      `,
      android: `
        <ol style="padding-left:20px;margin:8px 0;">
          <li>Tap the <strong style="color:#00f0ff;">menu</strong> button <i class="fas fa-ellipsis-v"></i> in Chrome</li>
          <li>Tap <strong style="color:#00f0ff;">Install app</strong> or <strong style="color:#00f0ff;">Add to Home screen</strong></li>
          <li>Confirm by tapping <strong style="color:#00f0ff;">Install</strong></li>
        </ol>
      `,
      windows: `
        <ol style="padding-left:20px;margin:8px 0;">
          <li>Click the <strong style="color:#00f0ff;">install</strong> icon <i class="fas fa-plus-square"></i> in the address bar</li>
          <li>Or use the menu: <strong style="color:#00f0ff;">⋮ → Apps → Install this site as an app</strong></li>
        </ol>
      `,
      macos: `
        <ol style="padding-left:20px;margin:8px 0;">
          <li>In Chrome, click the <strong style="color:#00f0ff;">install</strong> icon in the address bar</li>
          <li>In Safari, use <strong style="color:#00f0ff;">File → Add to Dock</strong></li>
        </ol>
      `,
      linux: `
        <ol style="padding-left:20px;margin:8px 0;">
          <li>Look for the <strong style="color:#00f0ff;">install</strong> icon in your browser's address bar</li>
          <li>Or use the browser menu and select <strong style="color:#00f0ff;">Install app</strong></li>
        </ol>
      `,
      unknown: `
        <p>Look for the <strong style="color:#00f0ff;">install</strong> icon in your browser's address bar, or check the browser menu for "Install app".</p>
      `,
    };
    return steps[platform] || steps.unknown;
  }

  _loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        this.installed = state.installed || false;
        this.dismissedAt = state.dismissedAt || 0;
      }
    } catch {}
  }

  _saveState(patch) {
    try {
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
    } catch {}
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(type, data) {
    for (const fn of this._listeners) {
      try { fn({ type, data, ts: Date.now() }); } catch {}
    }
  }

  getState() {
    return {
      installed: this.installed,
      installedAt: this._loadState().installedAt,
      dismissedAt: this.dismissedAt,
      displayMode: this.displayMode,
      offline: this.offline,
      canPrompt: !!this.deferredPrompt,
      updateAvailable: this.updateAvailable,
      platform: this._detectPlatform(),
      isStandalone: this._isStandalone(),
    };
  }

  destroy() {
    this._hideAll();
    if (this._offlineEl && this._offlineEl.parentNode) this._offlineEl.remove();
    this._listeners.clear();
  }
}

if (typeof document !== 'undefined' && !document.getElementById('nexus-pwa-styles')) {
  const style = document.createElement('style');
  style.id = 'nexus-pwa-styles';
  style.textContent = `
    @keyframes nexus-slide-up {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes nexus-slide-in-right {
      from { opacity: 0; transform: translateX(30px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes nexus-offline-pulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

export const installPrompt = new InstallPrompt();
