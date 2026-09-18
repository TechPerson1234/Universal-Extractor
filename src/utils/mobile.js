const ORIENTATIONS = { PORTRAIT: 'portrait', LANDSCAPE: 'landscape', UNKNOWN: 'unknown' };
const PLATFORMS = { IOS: 'ios', ANDROID: 'android', WINDOWS: 'windows', MACOS: 'macos', LINUX: 'linux', CHROMEOS: 'chromeos', UNKNOWN: 'unknown' };
const BROWSERS = { CHROME: 'chrome', FIREFOX: 'firefox', SAFARI: 'safari', EDGE: 'edge', OPERA: 'opera', SAMSUNG: 'samsung', UC: 'uc', UNKNOWN: 'unknown' };

export class DeviceInfo {
  constructor() {
    this._listeners = new Set();
    this._setupResizeListener();
    this._setupOrientationListener();
    this._setupNetworkListener();
    this._setupBatteryListener();
    this._setupVisibilityListener();
    this._setupViewportFix();
    this._setupMediaQueryListeners();
  }

  isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  }

  isTablet() {
    const ua = navigator.userAgent;
    return /iPad/i.test(ua) ||
      (/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  isDesktop() {
    return !this.isMobile() && !this.isTablet();
  }

  isTouch() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  isPointer() {
    return window.PointerEvent !== undefined;
  }

  isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      navigator.standalone === true;
  }

  isPWA() {
    return this.isStandalone();
  }

  getPlatform() {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return PLATFORMS.IOS;
    if (/Android/.test(ua)) return PLATFORMS.ANDROID;
    if (/CrOS/.test(ua)) return PLATFORMS.CHROMEOS;
    if (/Windows/.test(ua)) return PLATFORMS.WINDOWS;
    if (/Macintosh|Mac OS X/.test(ua)) return PLATFORMS.MACOS;
    if (/Linux/.test(ua)) return PLATFORMS.LINUX;
    return PLATFORMS.UNKNOWN;
  }

  getBrowser() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return BROWSERS.EDGE;
    if (/OPR\/|Opera/.test(ua)) return BROWSERS.OPERA;
    if (/SamsungBrowser/.test(ua)) return BROWSERS.SAMSUNG;
    if (/UCBrowser/.test(ua)) return BROWSERS.UC;
    if (/Firefox/.test(ua)) return BROWSERS.FIREFOX;
    if (/Chrome/.test(ua) && !/Edg/.test(ua)) return BROWSERS.CHROME;
    if (/Safari/.test(ua)) return BROWSERS.SAFARI;
    return BROWSERS.UNKNOWN;
  }

  getBrowserVersion() {
    const ua = navigator.userAgent;
    const patterns = {
      edge: /Edg\/(\d+\.\d+)/,
      opera: /(?:OPR|Opera)\/(\d+\.\d+)/,
      samsung: /SamsungBrowser\/(\d+\.\d+)/,
      chrome: /Chrome\/(\d+\.\d+)/,
      firefox: /Firefox\/(\d+\.\d+)/,
      safari: /Version\/(\d+\.\d+).*Safari/,
    };
    const browser = this.getBrowser();
    const match = ua.match(patterns[browser]);
    return match ? match[1] : null;
  }

  getOSVersion() {
    const ua = navigator.userAgent;
    const platform = this.getPlatform();
    const patterns = {
      ios: /OS (\d+_\d+(?:_\d+)?)/,
      android: /Android (\d+(?:\.\d+)*)/,
      windows: /Windows NT (\d+\.\d+)/,
      macos: /Mac OS X (\d+[._]\d+(?:[._]\d+)?)/,
      linux: /Linux/,
    };
    const match = ua.match(patterns[platform]);
    return match ? match[1].replace(/_/g, '.') : null;
  }

  isIOS() { return this.getPlatform() === PLATFORMS.IOS; }
  isAndroid() { return this.getPlatform() === PLATFORMS.ANDROID; }
  isChrome() { return this.getBrowser() === BROWSERS.CHROME; }
  isSafari() { return this.getBrowser() === BROWSERS.SAFARI; }

  getViewport() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      visualWidth: window.visualViewport ? window.visualViewport.width : window.innerWidth,
      visualHeight: window.visualViewport ? window.visualViewport.height : window.innerHeight,
      screenWidth: screen.width,
      screenHeight: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      dpr: window.devicePixelRatio || 1,
    };
  }

  getOrientation() {
    if (window.screen && window.screen.orientation && window.screen.orientation.type) {
      return window.screen.orientation.type.startsWith('portrait')
        ? ORIENTATIONS.PORTRAIT
        : ORIENTATIONS.LANDSCAPE;
    }
    if (window.matchMedia('(orientation: portrait)').matches) return ORIENTATIONS.PORTRAIT;
    if (window.matchMedia('(orientation: landscape)').matches) return ORIENTATIONS.LANDSCAPE;
    return window.innerHeight > window.innerWidth ? ORIENTATIONS.PORTRAIT : ORIENTATIONS.LANDSCAPE;
  }

  isPortrait() { return this.getOrientation() === ORIENTATIONS.PORTRAIT; }
  isLandscape() { return this.getOrientation() === ORIENTATIONS.LANDSCAPE; }

  getSafeAreaInsets() {
    const style = getComputedStyle(document.documentElement);
    const parse = (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? 0 : n;
    };
    return {
      top: parse(style.getPropertyValue('env(safe-area-inset-top)') || style.getPropertyValue('--sat') || '0'),
      right: parse(style.getPropertyValue('env(safe-area-inset-right)') || style.getPropertyValue('--sar') || '0'),
      bottom: parse(style.getPropertyValue('env(safe-area-inset-bottom)') || style.getPropertyValue('--sab') || '0'),
      left: parse(style.getPropertyValue('env(safe-area-inset-left)') || style.getPropertyValue('--sal') || '0'),
    };
  }

  vibrate(pattern) {
    if (navigator.vibrate) {
      try { return navigator.vibrate(pattern); } catch { return false; }
    }
    return false;
  }

  vibrateShort() { return this.vibrate(20); }
  vibrateMedium() { return this.vibrate(50); }
  vibrateLong() { return this.vibrate(200); }
  vibrateDouble() { return this.vibrate([30, 50, 30]); }
  vibrateSuccess() { return this.vibrate([20, 30, 20]); }
  vibrateError() { return this.vibrate([100, 50, 100]); }

  async requestWakeLock(type = 'screen') {
    if (!navigator.wakeLock) return null;
    try {
      const lock = await navigator.wakeLock.request(type);
      lock.addEventListener('release', () => {
        this._emit('wakelock-released', { type });
      });
      this._wakeLock = lock;
      this._emit('wakelock-acquired', { type });
      return lock;
    } catch (err) {
      this._emit('wakelock-error', { error: err });
      return null;
    }
  }

  async releaseWakeLock() {
    if (this._wakeLock) {
      try {
        await this._wakeLock.release();
        this._wakeLock = null;
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async toggleFullscreen(element = document.documentElement) {
    try {
      if (!document.fullscreenElement) {
        const fn = element.requestFullscreen || element.webkitRequestFullscreen || element.msRequestFullscreen;
        if (fn) await fn.call(element);
        this._emit('fullscreen-change', { fullscreen: true });
        return true;
      } else {
        const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (fn) await fn.call(document);
        this._emit('fullscreen-change', { fullscreen: false });
        return false;
      }
    } catch (err) {
      this._emit('fullscreen-error', { error: err });
      return false;
    }
  }

  isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  }

  async lockOrientation(orientation = 'portrait') {
    if (!screen.orientation || !screen.orientation.lock) return false;
    try {
      await screen.orientation.lock(orientation);
      return true;
    } catch {
      return false;
    }
  }

  unlockOrientation() {
    if (screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); return true; } catch { return false; }
    }
    return false;
  }

  getNetworkInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) {
      return {
        online: navigator.onLine !== false,
        type: null, effectiveType: null,
        downlink: null, rtt: null, saveData: false,
      };
    }
    return {
      online: navigator.onLine !== false,
      type: conn.type || null,
      effectiveType: conn.effectiveType || null,
      downlink: conn.downlink || null,
      downlinkMax: conn.downlinkMax || null,
      rtt: conn.rtt || null,
      saveData: conn.saveData || false,
    };
  }

  isSlowConnection() {
    const info = this.getNetworkInfo();
    return info.effectiveType === 'slow-2g' || info.effectiveType === '2g' || info.saveData;
  }

  async getBatteryInfo() {
    if (!navigator.getBattery) return null;
    try {
      const battery = await navigator.getBattery();
      return {
        level: battery.level,
        charging: battery.charging,
        chargingTime: battery.chargingTime,
        dischargingTime: battery.dischargingTime,
        battery,
      };
    } catch {
      return null;
    }
  }

  getHardwareInfo() {
    return {
      cpuCores: navigator.hardwareConcurrency || 1,
      deviceMemory: navigator.deviceMemory || null,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      dpr: window.devicePixelRatio || 1,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
      languages: navigator.languages || [navigator.language],
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      vendor: navigator.vendor,
    };
  }

  getScreenInfo() {
    return {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      orientation: this.getOrientation(),
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
      isRetina: window.devicePixelRatio >= 2,
      isHDR: screen.colorDepth >= 30,
    };
  }

  hasNotch() {
    const insets = this.getSafeAreaInsets();
    return insets.top > 20 || insets.bottom > 20;
  }

  prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  prefersDarkMode() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  prefersHighContrast() {
    return window.matchMedia('(prefers-contrast: more)').matches;
  }

  isOnline() {
    return navigator.onLine !== false;
  }

  _setupResizeListener() {
    let rafId = null;
    const handler = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        this._emit('resize', this.getViewport());
      });
    };
    window.addEventListener('resize', handler, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handler, { passive: true });
    }
  }

  _setupOrientationListener() {
    const handler = () => {
      this._emit('orientation', { orientation: this.getOrientation(), angle: screen.orientation ? screen.orientation.angle : null });
    };
    if (screen.orientation) {
      screen.orientation.addEventListener('change', handler);
    } else {
      window.addEventListener('orientationchange', () => setTimeout(handler, 100));
      window.matchMedia('(orientation: portrait)').addEventListener('change', handler);
    }
  }

  _setupNetworkListener() {
    window.addEventListener('online', () => this._emit('online', this.getNetworkInfo()));
    window.addEventListener('offline', () => this._emit('offline', this.getNetworkInfo()));
    const conn = navigator.connection;
    if (conn && conn.addEventListener) {
      conn.addEventListener('change', () => this._emit('network-change', this.getNetworkInfo()));
    }
  }

  async _setupBatteryListener() {
    const info = await this.getBatteryInfo();
    if (!info) return;
    info.battery.addEventListener('levelchange', () => {
      this._emit('battery-change', { level: info.battery.level, charging: info.battery.charging });
    });
    info.battery.addEventListener('chargingchange', () => {
      this._emit('battery-change', { level: info.battery.level, charging: info.battery.charging });
    });
  }

  _setupVisibilityListener() {
    document.addEventListener('visibilitychange', () => {
      this._emit('visibility', { state: document.visibilityState });
    });
  }

  _setupViewportFix() {
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
      document.documentElement.style.setProperty('--dvh', `${(window.visualViewport ? window.visualViewport.height : window.innerHeight) * 0.01}px`);
    };
    setVH();
    window.addEventListener('resize', setVH, { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setVH, { passive: true });
  }

  _setupMediaQueryListeners() {
    const queries = {
      darkMode: '(prefers-color-scheme: dark)',
      reducedMotion: '(prefers-reduced-motion: reduce)',
      highContrast: '(prefers-contrast: more)',
      portrait: '(orientation: portrait)',
      landscape: '(orientation: landscape)',
      standalone: '(display-mode: standalone)',
      hover: '(hover: hover)',
      pointer: '(pointer: fine)',
    };
    for (const [name, query] of Object.entries(queries)) {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', (e) => {
        this._emit('media-query', { name, matches: e.matches, query });
      });
    }
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

  getSummary() {
    return {
      platform: this.getPlatform(),
      browser: this.getBrowser(),
      browserVersion: this.getBrowserVersion(),
      osVersion: this.getOSVersion(),
      isMobile: this.isMobile(),
      isTablet: this.isTablet(),
      isDesktop: this.isDesktop(),
      isTouch: this.isTouch(),
      isStandalone: this.isStandalone(),
      orientation: this.getOrientation(),
      viewport: this.getViewport(),
      screen: this.getScreenInfo(),
      network: this.getNetworkInfo(),
      hardware: this.getHardwareInfo(),
      prefersDarkMode: this.prefersDarkMode(),
      prefersReducedMotion: this.prefersReducedMotion(),
      hasNotch: this.hasNotch(),
    };
  }

  destroy() {
    this._listeners.clear();
  }
}

export class OrientationManager {
  constructor() {
    this.current = this._detect();
    this._listeners = new Set();
    this._bind();
  }

  _detect() {
    if (window.matchMedia('(orientation: portrait)').matches) return 'portrait';
    if (window.matchMedia('(orientation: landscape)').matches) return 'landscape';
    return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
  }

  _bind() {
    const handler = () => {
      const next = this._detect();
      if (next !== this.current) {
        this.current = next;
        for (const fn of this._listeners) {
          try { fn({ orientation: next, angle: screen.orientation ? screen.orientation.angle : null }); } catch {}
        }
      }
    };
    if (screen.orientation) screen.orientation.addEventListener('change', handler);
    else {
      window.addEventListener('orientationchange', () => setTimeout(handler, 100));
      window.matchMedia('(orientation: portrait)').addEventListener('change', handler);
    }
  }

  isPortrait() { return this.current === 'portrait'; }
  isLandscape() { return this.current === 'landscape'; }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}

export class SafeAreaManager {
  constructor() {
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this._detect();
    window.addEventListener('resize', () => this._detect(), { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this._detect(), { passive: true });
  }

  _detect() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);pointer-events:none;visibility:hidden;';
    document.body.appendChild(el);
    const style = getComputedStyle(el);
    this.insets = {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    };
    document.body.removeChild(el);
  }

  getInsets() { return { ...this.insets }; }
  hasTop() { return this.insets.top > 0; }
  hasBottom() { return this.insets.bottom > 0; }
  applyTo(element) {
    if (!element) return;
    element.style.paddingTop = this.insets.top + 'px';
    element.style.paddingRight = this.insets.right + 'px';
    element.style.paddingBottom = this.insets.bottom + 'px';
    element.style.paddingLeft = this.insets.left + 'px';
  }
}

export const deviceInfo = new DeviceInfo();
export const orientationManager = new OrientationManager();
export const safeAreaManager = new SafeAreaManager();

export function isMobile() { return deviceInfo.isMobile(); }
export function isTablet() { return deviceInfo.isTablet(); }
export function isDesktop() { return deviceInfo.isDesktop(); }
export function isTouch() { return deviceInfo.isTouch(); }
export function isStandalone() { return deviceInfo.isStandalone(); }
export function isIOS() { return deviceInfo.isIOS(); }
export function isAndroid() { return deviceInfo.isAndroid(); }
export function isOnline() { return deviceInfo.isOnline(); }
export function getPlatform() { return deviceInfo.getPlatform(); }
export function getBrowser() { return deviceInfo.getBrowser(); }
export function getOrientation() { return deviceInfo.getOrientation(); }
export function vibrate(pattern) { return deviceInfo.vibrate(pattern); }
export function vibrateSuccess() { return deviceInfo.vibrateSuccess(); }
export function vibrateError() { return deviceInfo.vibrateError(); }
export async function requestWakeLock(type) { return deviceInfo.requestWakeLock(type); }
export async function releaseWakeLock() { return deviceInfo.releaseWakeLock(); }
export async function toggleFullscreen(el) { return deviceInfo.toggleFullscreen(el); }
