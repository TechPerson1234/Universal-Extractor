const DEFAULT_LONG_PRESS_MS = 500;
const DEFAULT_SWIPE_THRESHOLD = 60;
const DEFAULT_TAP_THRESHOLD = 10;
const DEFAULT_TAP_TIMEOUT = 300;
const DEFAULT_DOUBLE_TAP_MS = 300;
const DEFAULT_PINCH_THRESHOLD = 0.05;

export class GestureManager {
  constructor(element, options = {}) {
    this.element = element;
    this.options = {
      longPressMs: options.longPressMs || DEFAULT_LONG_PRESS_MS,
      swipeThreshold: options.swipeThreshold || DEFAULT_SWIPE_THRESHOLD,
      tapThreshold: options.tapThreshold || DEFAULT_TAP_THRESHOLD,
      tapTimeout: options.tapTimeout || DEFAULT_TAP_TIMEOUT,
      doubleTapMs: options.doubleTapMs || DEFAULT_DOUBLE_TAP_MS,
      preventDefault: options.preventDefault !== false,
      capture: options.capture || false,
      passive: options.passive !== false,
    };
    this.listeners = {
      tap: new Set(), doubletap: new Set(), longpress: new Set(),
      swipe: new Set(), swipeleft: new Set(), swiperight: new Set(),
      swipeup: new Set(), swipedown: new Set(),
      panstart: new Set(), panmove: new Set(), panend: new Set(),
      pinchstart: new Set(), pinchmove: new Set(), pinchend: new Set(),
      rotatestart: new Set(), rotatemove: new Set(), rotateend: new Set(),
      press: new Set(), release: new Set(),
    };
    this._activePointers = new Map();
    this._state = {
      startX: 0, startY: 0, lastX: 0, lastY: 0,
      startTime: 0, moved: false, longPressFired: false,
      lastTapTime: 0, lastTapX: 0, lastTapY: 0,
      initialDistance: 0, initialAngle: 0, initialMidX: 0, initialMidY: 0,
      isPanning: false, isPinching: false, isRotating: false,
    };
    this._longPressTimer = null;
    this._tapTimer = null;
    this._enabled = true;
    this._bind();
  }

  on(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = new Set();
    this.listeners[event].add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    if (this.listeners[event]) this.listeners[event].delete(handler);
  }

  once(event, handler) {
    const off = this.on(event, (data) => {
      off();
      handler(data);
    });
    return off;
  }

  emit(event, data) {
    if (this.listeners[event]) {
      for (const handler of this.listeners[event]) {
        try { handler(data); } catch (err) { console.error('[GestureManager]', err); }
      }
    }
  }

  enable() { this._enabled = true; }
  disable() { this._enabled = false; this._reset(); }

  _bind() {
    const opts = { passive: this.options.passive, capture: this.options.capture };
    this._handlers = {
      pointerdown: this._onPointerDown.bind(this),
      pointermove: this._onPointerMove.bind(this),
      pointerup: this._onPointerUp.bind(this),
      pointercancel: this._onPointerCancel.bind(this),
      touchstart: this._onTouchStart.bind(this),
      touchmove: this._onTouchMove.bind(this),
      touchend: this._onTouchEnd.bind(this),
      touchcancel: this._onTouchCancel.bind(this),
    };
    if (window.PointerEvent) {
      this.element.addEventListener('pointerdown', this._handlers.pointerdown, opts);
      this.element.addEventListener('pointermove', this._handlers.pointermove, opts);
      this.element.addEventListener('pointerup', this._handlers.pointerup, opts);
      this.element.addEventListener('pointercancel', this._handlers.pointercancel, opts);
    } else {
      this.element.addEventListener('touchstart', this._handlers.touchstart, opts);
      this.element.addEventListener('touchmove', this._handlers.touchmove, opts);
      this.element.addEventListener('touchend', this._handlers.touchend, opts);
      this.element.addEventListener('touchcancel', this._handlers.touchcancel, opts);
    }
  }

  _onPointerDown(e) {
    if (!this._enabled) return;
    this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._handleStart(e, e.pointerId, e.clientX, e.clientY);
  }

  _onPointerMove(e) {
    if (!this._enabled) return;
    if (!this._activePointers.has(e.pointerId)) return;
    this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._handleMove(e, e.pointerId, e.clientX, e.clientY);
  }

  _onPointerUp(e) {
    if (!this._enabled) return;
    this._activePointers.delete(e.pointerId);
    this._handleEnd(e, e.pointerId, e.clientX, e.clientY);
  }

  _onPointerCancel(e) {
    this._activePointers.delete(e.pointerId);
    this._reset();
  }

  _onTouchStart(e) {
    if (!this._enabled) return;
    for (const touch of e.changedTouches) {
      this._activePointers.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      this._handleStart(e, touch.identifier, touch.clientX, touch.clientY);
    }
  }

  _onTouchMove(e) {
    if (!this._enabled) return;
    for (const touch of e.changedTouches) {
      if (!this._activePointers.has(touch.identifier)) continue;
      this._activePointers.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
    const touch = e.changedTouches[0];
    this._handleMove(e, touch.identifier, touch.clientX, touch.clientY);
  }

  _onTouchEnd(e) {
    if (!this._enabled) return;
    for (const touch of e.changedTouches) {
      this._activePointers.delete(touch.identifier);
      this._handleEnd(e, touch.identifier, touch.clientX, touch.clientY);
    }
  }

  _onTouchCancel(e) {
    for (const touch of e.changedTouches) this._activePointers.delete(touch.identifier);
    this._reset();
  }

  _handleStart(e, id, x, y) {
    const s = this._state;
    s.startX = x;
    s.startY = y;
    s.lastX = x;
    s.lastY = y;
    s.startTime = performance.now();
    s.moved = false;
    s.longPressFired = false;

    if (this._activePointers.size === 2) {
      const points = Array.from(this._activePointers.values());
      const dx = points[1].x - points[0].x;
      const dy = points[1].y - points[0].y;
      s.initialDistance = Math.sqrt(dx * dx + dy * dy);
      s.initialAngle = Math.atan2(dy, dx);
      s.initialMidX = (points[0].x + points[1].x) / 2;
      s.initialMidY = (points[0].y + points[1].y) / 2;
      s.isPinching = true;
      s.isRotating = true;
      this.emit('pinchstart', {
        touches: points.map((p) => ({ x: p.x, y: p.y })),
        scale: 1,
        distance: s.initialDistance,
        clientX: s.initialMidX,
        clientY: s.initialMidY,
        originalEvent: e,
      });
      this.emit('rotatestart', {
        angle: 0,
        clientX: s.initialMidX,
        clientY: s.initialMidY,
        originalEvent: e,
      });
    } else if (this._activePointers.size === 1) {
      this.emit('press', { clientX: x, clientY: y, originalEvent: e });
      this._longPressTimer = setTimeout(() => {
        if (!s.moved) {
          s.longPressFired = true;
          this.emit('longpress', { clientX: x, clientY: y, duration: this.options.longPressMs, originalEvent: e });
          if (navigator.vibrate) navigator.vibrate(15);
        }
      }, this.options.longPressMs);
    }
  }

  _handleMove(e, id, x, y) {
    const s = this._state;
    const dx = x - s.startX;
    const dy = y - s.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (!s.moved && (absDx > this.options.tapThreshold || absDy > this.options.tapThreshold)) {
      s.moved = true;
      if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; }
    }

    if (this._activePointers.size === 2 && s.isPinching) {
      const points = Array.from(this._activePointers.values());
      const dx2 = points[1].x - points[0].x;
      const dy2 = points[1].y - points[0].y;
      const distance = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      const angle = Math.atan2(dy2, dx2);
      const midX = (points[0].x + points[1].x) / 2;
      const midY = (points[0].y + points[1].y) / 2;
      const scale = s.initialDistance ? distance / s.initialDistance : 1;
      this.emit('pinchmove', {
        scale,
        distance,
        deltaScale: scale - 1,
        clientX: midX,
        clientY: midY,
        originalEvent: e,
      });
      const angleDelta = angle - s.initialAngle;
      this.emit('rotatemove', {
        angle: angleDelta,
        angleDegrees: (angleDelta * 180) / Math.PI,
        clientX: midX,
        clientY: midY,
        originalEvent: e,
      });
      return;
    }

    if (this._activePointers.size === 1 && s.moved) {
      if (!s.isPanning) {
        s.isPanning = true;
        this.emit('panstart', {
          clientX: x, clientY: y,
          deltaX: 0, deltaY: 0,
          originalEvent: e,
        });
      } else {
        this.emit('panmove', {
          clientX: x,
          clientY: y,
          deltaX: dx,
          deltaY: dy,
          velocityX: dx / (performance.now() - s.startTime),
          velocityY: dy / (performance.now() - s.startTime),
          originalEvent: e,
        });
      }
    }
  }

  _handleEnd(e, id, x, y) {
    const s = this._state;
    if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; }

    if (this._activePointers.size === 0) {
      if (s.isPinching) {
        this.emit('pinchend', { clientX: x, clientY: y, originalEvent: e });
        this.emit('rotateend', { clientX: x, clientY: y, originalEvent: e });
        s.isPinching = false;
        s.isRotating = false;
        this._reset();
        return;
      }
      if (s.isPanning) {
        this.emit('panend', {
          clientX: x,
          clientY: y,
          deltaX: x - s.startX,
          deltaY: y - s.startY,
          originalEvent: e,
        });
        this._reset();
        return;
      }
      if (!s.moved) {
        const now = performance.now();
        const timeSinceLastTap = now - s.lastTapTime;
        const dx = x - s.lastTapX;
        const dy = y - s.lastTapY;
        const isNearLastTap = Math.sqrt(dx * dx + dy * dy) < this.options.tapThreshold * 2;
        if (timeSinceLastTap < this.options.doubleTapMs && isNearLastTap) {
          if (this._tapTimer) { clearTimeout(this._tapTimer); this._tapTimer = null; }
          this.emit('doubletap', {
            clientX: x, clientY: y,
            interval: timeSinceLastTap,
            originalEvent: e,
          });
          s.lastTapTime = 0;
        } else {
          s.lastTapTime = now;
          s.lastTapX = x;
          s.lastTapY = y;
          this._tapTimer = setTimeout(() => {
            this.emit('tap', {
              clientX: x, clientY: y,
              duration: now - s.startTime,
              originalEvent: e,
            });
            this._tapTimer = null;
          }, this.options.tapTimeout);
        }
      } else {
        const dx = x - s.startX;
        const dy = y - s.startY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const threshold = this.options.swipeThreshold;
        if (absDx > threshold || absDy > threshold) {
          let direction;
          if (absDx > absDy) direction = dx > 0 ? 'right' : 'left';
          else direction = dy > 0 ? 'down' : 'up';
          const distance = Math.sqrt(dx * dx + dy * dy);
          const duration = performance.now() - s.startTime;
          const velocity = distance / duration;
          const detail = {
            direction,
            deltaX: dx, deltaY: dy,
            distance, duration, velocity,
            clientX: x, clientY: y,
            originalEvent: e,
          };
          this.emit('swipe', detail);
          this.emit(`swipe${direction}`, detail);
        }
      }
      this._reset();
    } else {
      this.emit('release', { clientX: x, clientY: y, originalEvent: e });
    }
  }

  _reset() {
    if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; }
    this._state.moved = false;
    this._state.isPanning = false;
    this._state.isPinching = false;
    this._state.isRotating = false;
    this._state.initialDistance = 0;
    this._state.initialAngle = 0;
  }

  destroy() {
    if (this._longPressTimer) clearTimeout(this._longPressTimer);
    if (this._tapTimer) clearTimeout(this._tapTimer);
    const opts = { capture: this.options.capture };
    if (this._handlers) {
      this.element.removeEventListener('pointerdown', this._handlers.pointerdown, opts);
      this.element.removeEventListener('pointermove', this._handlers.pointermove, opts);
      this.element.removeEventListener('pointerup', this._handlers.pointerup, opts);
      this.element.removeEventListener('pointercancel', this._handlers.pointercancel, opts);
      this.element.removeEventListener('touchstart', this._handlers.touchstart, opts);
      this.element.removeEventListener('touchmove', this._handlers.touchmove, opts);
      this.element.removeEventListener('touchend', this._handlers.touchend, opts);
      this.element.removeEventListener('touchcancel', this._handlers.touchcancel, opts);
    }
    for (const set of Object.values(this.listeners)) set.clear();
    this._activePointers.clear();
  }
}

export function createGestureManager(element, options) {
  return new GestureManager(element, options);
}

export function bindTap(element, handler, options = {}) {
  const gm = new GestureManager(element, options);
  gm.on('tap', handler);
  return () => gm.destroy();
}

export function bindLongPress(element, handler, options = {}) {
  const gm = new GestureManager(element, options);
  gm.on('longpress', handler);
  return () => gm.destroy();
}

export function bindSwipe(element, handler, options = {}) {
  const gm = new GestureManager(element, options);
  gm.on('swipe', handler);
  return () => gm.destroy();
}

export function bindPinch(element, handler, options = {}) {
  const gm = new GestureManager(element, options);
  gm.on('pinchmove', handler);
  return () => gm.destroy();
}

export function bindPan(element, handlers = {}, options = {}) {
  const gm = new GestureManager(element, options);
  if (handlers.start) gm.on('panstart', handlers.start);
  if (handlers.move) gm.on('panmove', handlers.move);
  if (handlers.end) gm.on('panend', handlers.end);
  return () => gm.destroy();
}

export class SwipeActions {
  constructor(element, actions = []) {
    this.element = element;
    this.actions = actions;
    this.threshold = 60;
    this.gm = new GestureManager(element, { swipeThreshold: this.threshold });
    this._bind();
  }

  _bind() {
    this.gm.on('swipeleft', () => {
      const action = this.actions.find((a) => a.direction === 'left');
      if (action && action.handler) action.handler(this.element);
    });
    this.gm.on('swiperight', () => {
      const action = this.actions.find((a) => a.direction === 'right');
      if (action && action.handler) action.handler(this.element);
    });
  }

  destroy() {
    this.gm.destroy();
  }
}
