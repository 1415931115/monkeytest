/** Unified intents from keyboard/mouse (pointer lock) and touch controls. */
export class Input {
  moveX = 0;
  moveY = 0;
  sprint = false;
  harvest = false;
  lookDX = 0;
  lookDY = 0;
  private lightPressed = false;
  private keys = new Set<string>();
  private touchMove = { x: 0, y: 0 };
  private touchSprint = false;
  private touchHarvest = false;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private readonly cleanup: (() => void)[] = [];
  sensitivity = 0.0007; // yaw (horizontal)
  /** Pitch scale vs yaw — keep vertical look subdued. */
  verticalSensitivity = 0; // pitch locked off — horizontal look only
  /** True when keyboard/mouse input should drive the game (pointer locked). */
  pointerLocked = false;
  /**
   * Phone/tablet layout. Starts from the primary pointer (and the first real
   * touch) — never from a press on #touch-controls, which stay hidden until
   * this is true.
   */
  touchMode = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
    buttons: { light: HTMLElement; harvest: HTMLElement; sprint: HTMLElement; look: HTMLElement },
  ) {
    if (Input.prefersTouch()) this.enableTouchMode();
    // A tap on the title button (or anywhere) must flip touch mode before the
    // click handler starts the run. Hidden controls cannot be that first tap.
    const onTouch = () => this.enableTouchMode();
    window.addEventListener('touchstart', onTouch, { passive: true });
    this.cleanup.push(() => window.removeEventListener('touchstart', onTouch));
    this.on(window, 'pointerdown', (e) => {
      if ((e as PointerEvent).pointerType === 'touch') this.enableTouchMode();
    });

    this.on(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.code === 'KeyF' && !ev.repeat) this.lightPressed = true;
      this.keys.add(ev.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(ev.code)) ev.preventDefault();
    });
    this.on(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    this.on(window, 'blur', () => this.releaseAll());
    this.on(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    this.on(document, 'mousemove', (e) => {
      if (!this.pointerLocked) return;
      const ev = e as MouseEvent;
      // Clamp pointer-lock spikes (common on lock engage / alt-tab on Windows).
      const mx = Math.max(-40, Math.min(40, ev.movementX || 0));
      const my = Math.max(-40, Math.min(40, ev.movementY || 0));
      this.lookDX += mx * this.sensitivity;
      this.lookDY += my * this.verticalSensitivity;
    });
    this.on(document, 'mousedown', (e) => {
      if (this.pointerLocked && (e as MouseEvent).button === 0) this.keys.add('Mouse0');
    });
    this.on(document, 'mouseup', (e) => {
      if ((e as MouseEvent).button === 0) this.keys.delete('Mouse0');
    });
    this.on(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) {
        this.releaseAll();
        this.lookDX = 0;
        this.lookDY = 0;
      }
    });

    // --- touch: stick
    this.on(stick, 'pointerdown', (e) => {
      const ev = e as PointerEvent;
      this.touchMode = true;
      this.stickId = ev.pointerId;
      stick.setPointerCapture(ev.pointerId);
      this.updateStick(ev);
    });
    this.on(stick, 'pointermove', (e) => {
      const ev = e as PointerEvent;
      if (ev.pointerId === this.stickId) this.updateStick(ev);
    });
    const endStick = (e: Event) => {
      if ((e as PointerEvent).pointerId !== this.stickId) return;
      this.stickId = null;
      this.touchMove.x = 0;
      this.touchMove.y = 0;
      this.knob.style.transform = 'translate(-50%, -50%)';
    };
    for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) this.on(stick, n, endStick);

    // --- touch: look pad
    const look = buttons.look;
    this.on(look, 'pointerdown', (e) => {
      const ev = e as PointerEvent;
      this.touchMode = true;
      this.lookId = ev.pointerId;
      look.setPointerCapture(ev.pointerId);
      this.lookLast = { x: ev.clientX, y: ev.clientY };
    });
    this.on(look, 'pointermove', (e) => {
      const ev = e as PointerEvent;
      if (ev.pointerId !== this.lookId) return;
      this.lookDX += (ev.clientX - this.lookLast.x) * 0.0055;
      this.lookDY += (ev.clientY - this.lookLast.y) * 0; // vertical look disabled
      this.lookLast = { x: ev.clientX, y: ev.clientY };
    });
    const endLook = (e: Event) => {
      if ((e as PointerEvent).pointerId === this.lookId) this.lookId = null;
    };
    for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) this.on(look, n, endLook);

    // --- touch buttons
    this.on(buttons.light, 'pointerdown', (e) => {
      e.preventDefault();
      this.touchMode = true;
      this.lightPressed = true;
    });
    this.holdButton(buttons.harvest, (v) => (this.touchHarvest = v));
    this.holdButton(buttons.sprint, (v) => (this.touchSprint = v));
  }

  /** Coarse primary pointer, or a touch device that cannot hover. */
  private static prefersTouch(): boolean {
    if (typeof window.matchMedia !== 'function') return false;
    if (window.matchMedia('(pointer: coarse)').matches) return true;
    const hoverNone = window.matchMedia('(hover: none)').matches;
    const hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    return hoverNone && hasTouch;
  }

  private enableTouchMode(): void {
    if (this.touchMode) return;
    this.touchMode = true;
    document.body.classList.add('touch');
    // Drop a mouse lock acquired before the device revealed itself as touch,
    // so the loss-of-lock pause path does not fire (touchMode is already set).
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private holdButton(el: HTMLElement, set: (v: boolean) => void): void {
    this.on(el, 'pointerdown', (e) => {
      const ev = e as PointerEvent;
      ev.preventDefault();
      this.touchMode = true;
      el.setPointerCapture(ev.pointerId);
      el.classList.add('pressed');
      set(true);
    });
    const end = () => {
      el.classList.remove('pressed');
      set(false);
    };
    for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) this.on(el, n, end);
  }

  private updateStick(ev: PointerEvent): void {
    const rect = this.stick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const max = rect.width / 2;
    let dx = (ev.clientX - cx) / max;
    let dy = (ev.clientY - cy) / max;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.touchMove.x = dx;
    this.touchMove.y = -dy;
    this.knob.style.transform = `translate(calc(-50% + ${dx * max * 0.6}px), calc(-50% + ${dy * max * 0.6}px))`;
  }

  private on(target: EventTarget, name: string, fn: (e: Event) => void): void {
    target.addEventListener(name, fn, { passive: false });
    this.cleanup.push(() => target.removeEventListener(name, fn));
  }

  private releaseAll(): void {
    this.keys.clear();
    this.touchHarvest = false;
    this.touchSprint = false;
  }

  /** Sample intents for this frame. */
  poll(): void {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    x += this.touchMove.x;
    y += this.touchMove.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.moveX = x;
    this.moveY = y;
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint || (this.touchMode && Math.hypot(this.touchMove.x, this.touchMove.y) > 0.97 && this.touchSprint);
    this.harvest = k.has('KeyE') || k.has('Mouse0') || this.touchHarvest;
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  consumeLightToggle(): boolean {
    const v = this.lightPressed;
    this.lightPressed = false;
    return v;
  }

  /** Test/bot helper: simulate a key. */
  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  dispose(): void {
    for (const c of this.cleanup) c();
  }
}
