const STUNT_KEYS = {
  KeyZ: "rollLeft",
  KeyC: "rollRight",
  KeyX: "loop",
};

const GAME_KEYS = new Set([
  "Space",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Tab",
  "Enter",
  "ShiftLeft",
  "ShiftRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "KeyZ",
  "KeyX",
  "KeyC",
  "KeyB",
  "KeyF",
  "KeyP",
  "KeyR",
  "KeyH",
  "KeyO",
  "KeyK",
  "KeyT",
  "KeyG",
]);

// Pointer-lock deltas are in CSS pixels; this many pixels pushes the virtual stick to full deflection.
const STICK_TRAVEL = 340;

export class Input {
  constructor(target, { requireLock = true } = {}) {
    this.target = target;
    this.requireLock = requireLock;
    this.keys = new Set();
    this.stuntQueue = [];
    this.pressQueue = [];
    this.mouseDown = false;
    this.secondaryDown = false;
    this.flightTarget = { x: 0, y: 0 };
    this.mouseSensitivity = 1;
    this.invertY = false;
    this.locked = false;
    this.everLocked = false;
    this.flightPaused = false;
    this.onLockChange = null;
    this.onConfirm = null;
    // Raw mouse travel and wheel clicks since the last read, for the photo camera.
    this.look = { x: 0, y: 0, wheel: 0 };

    this.onKeyDown = (event) => {
      if (event.target instanceof HTMLElement && event.target.matches("input, select, textarea")) {
        return;
      }
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
      if (GAME_KEYS.has(event.code) && !hasModifier) {
        event.preventDefault();
      }
      if (!event.repeat) {
        if (event.code === "Enter" && !hasModifier && this.onConfirm) {
          this.onConfirm();
          return;
        }
        if (STUNT_KEYS[event.code]) {
          this.stuntQueue.push(STUNT_KEYS[event.code]);
        }
        this.pressQueue.push(event.code);
      }
      this.keys.add(event.code);
    };

    this.onKeyUp = (event) => {
      this.keys.delete(event.code);
    };

    this.onMouseMove = (event) => {
      this.look.x += event.movementX;
      this.look.y += event.movementY;
      if (!this.canFly || this.flightPaused) {
        return;
      }
      const scale = this.mouseSensitivity / STICK_TRAVEL;
      const clamp = (value) => Math.max(-1, Math.min(1, value));
      this.flightTarget.x = clamp(this.flightTarget.x + event.movementX * scale);
      this.flightTarget.y = clamp(this.flightTarget.y + event.movementY * scale * (this.invertY ? -1 : 1));
    };

    this.onMouseDown = (event) => {
      if (!this.canFly) {
        this.requestLock();
        return;
      }
      if (event.button === 0) {
        this.mouseDown = true;
      } else if (event.button === 2) {
        this.secondaryDown = true;
      }
    };

    this.onMouseUp = (event) => {
      if (event.button === 0) {
        this.mouseDown = false;
      } else if (event.button === 2) {
        this.secondaryDown = false;
      }
    };

    this.onContextMenu = (event) => event.preventDefault();

    this.onWheel = (event) => {
      this.look.wheel += Math.sign(event.deltaY);
    };

    this.onPointerLockChange = () => {
      this.locked = document.pointerLockElement === this.target;
      this.everLocked ||= this.locked;
      if (!this.locked) {
        this.releaseAll();
      }
      this.onLockChange?.(this.locked);
    };

    // Embedded browsers can refuse pointer lock outright. If it has never worked here, stop
    // insisting on it and steer from plain mouse movement, or the game would stay paused forever.
    this.onLockError = () => {
      if (!this.everLocked && this.requireLock) {
        this.requireLock = false;
        this.onLockChange?.(true);
      }
    };

    // A key held while the window loses focus never delivers its keyup.
    this.onBlur = () => this.releaseAll();
  }

  attach() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("pointerlockerror", this.onLockError);
    this.target.addEventListener("mousedown", this.onMouseDown);
    this.target.addEventListener("contextmenu", this.onContextMenu);
    this.target.addEventListener("wheel", this.onWheel, { passive: true });
  }

  detach() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("pointerlockerror", this.onLockError);
    this.target.removeEventListener("mousedown", this.onMouseDown);
    this.target.removeEventListener("contextmenu", this.onContextMenu);
    this.target.removeEventListener("wheel", this.onWheel);
  }

  consumeLook() {
    const look = { ...this.look };
    this.look.x = 0;
    this.look.y = 0;
    this.look.wheel = 0;
    return look;
  }

  requestLock() {
    if (this.locked || !this.requireLock) {
      return;
    }
    if (!this.target.requestPointerLock) {
      this.onLockError();
      return;
    }
    // Browsers also reject a re-lock for about a second after Esc; then the next click simply tries again.
    Promise.resolve(this.target.requestPointerLock()).catch(this.onLockError);
  }

  releaseLock() {
    if (document.pointerLockElement === this.target) {
      document.exitPointerLock();
    }
  }

  get canFly() {
    return this.locked || !this.requireLock;
  }

  releaseAll() {
    this.keys.clear();
    this.mouseDown = false;
    this.secondaryDown = false;
    this.stuntQueue = [];
  }

  isPressed(code) {
    return this.keys.has(code);
  }

  consumeStunts() {
    const queued = this.stuntQueue;
    this.stuntQueue = [];
    return queued;
  }

  consumePresses() {
    const queued = this.pressQueue;
    this.pressQueue = [];
    return queued;
  }

  getFlightTarget() {
    return this.flightTarget;
  }

  getAimUiPosition() {
    return { x: 50 + this.flightTarget.x * 34, y: 50 + this.flightTarget.y * 34 };
  }

  get fire() {
    return this.mouseDown || this.isPressed("Space");
  }

  get missile() {
    return this.secondaryDown || this.isPressed("KeyF");
  }

  get throttle() {
    return this.isPressed("ShiftLeft") || this.isPressed("ShiftRight") ? 1 : 0;
  }

  get brake() {
    return this.isPressed("KeyB") ? 1 : 0;
  }

  get rollLeft() {
    return this.isPressed("KeyA") || this.isPressed("ArrowLeft");
  }

  get rollRight() {
    return this.isPressed("KeyD") || this.isPressed("ArrowRight");
  }

  get pitchUp() {
    return this.isPressed("KeyW") || this.isPressed("ArrowDown");
  }

  get pitchDown() {
    return this.isPressed("KeyS") || this.isPressed("ArrowUp");
  }

  get throttleUp() {
    return this.isPressed("KeyT");
  }

  get throttleDown() {
    return this.isPressed("KeyG");
  }

  get rudderLeft() {
    return this.isPressed("KeyQ");
  }

  get rudderRight() {
    return this.isPressed("KeyE");
  }

  get restart() {
    return this.isPressed("KeyR");
  }

  setMouseSensitivity(value) {
    this.mouseSensitivity = Math.max(0.3, Math.min(2.5, value));
  }

  clearAimToCenter() {
    this.flightTarget.x = 0;
    this.flightTarget.y = 0;
  }
}
