// input.js — keyboard/gamepad/touch input state and key bindings

const Input = (() => {
  // Simulation inputs are the only ones a replay records. Camera keys are
  // deliberately excluded: where someone pointed the view can never change the
  // outcome of a run, so a recorded run stays valid however it is watched.
  const SIM = { LEFT: 1, RIGHT: 2, JUMP: 4, DOWN: 8 };

  // Two ways to hold the game, and they disagree about what the arrow keys are
  // for. Modern moves on the letters and looks with the arrows; retro moves on
  // the arrows and looks with the letters. Down is down in both: at a run it
  // slides, standing still it crouches.
  //
  // The simulation only ever sees the four bits above, so a scheme is a way of
  // typing rather than a rule of the game — the same run replays identically
  // whichever one recorded it.
  const SCHEMES = {
    modern: {
      id: "modern",
      label: "Modern",
      bindings: {
        KeyA: SIM.LEFT,
        KeyD: SIM.RIGHT,
        KeyW: SIM.JUMP,
        Space: SIM.JUMP,
        KeyS: SIM.DOWN,
      },
      view: {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      },
      controls: [
        { action: "Move", keys: "A / D" },
        { action: "Jump", keys: "W or Space" },
        { action: "Wall jump", keys: "W or Space on a wall" },
        { action: "Slide / crouch", keys: "S" },
        { action: "Camera", keys: "Arrow keys" },
        { action: "Sweep", keys: "Shift + arrows" },
      ],
    },
    retro: {
      id: "retro",
      label: "Retro Arcade",
      bindings: {
        ArrowLeft: SIM.LEFT,
        ArrowRight: SIM.RIGHT,
        KeyZ: SIM.JUMP,
        Space: SIM.JUMP,
        ArrowDown: SIM.DOWN,
      },
      view: {
        KeyA: { x: -1, y: 0 },
        KeyD: { x: 1, y: 0 },
        KeyW: { x: 0, y: -1 },
        KeyS: { x: 0, y: 1 },
      },
      controls: [
        { action: "Move", keys: "Left / Right" },
        { action: "Jump", keys: "Z or Space" },
        { action: "Wall jump", keys: "Z or Space on a wall" },
        { action: "Slide / crouch", keys: "Down" },
        { action: "Camera", keys: "W A S D" },
        { action: "Sweep", keys: "Shift + WASD" },
      ],
    },
  };

  let scheme = SCHEMES.modern;
  let BINDINGS = scheme.bindings;
  let VIEW = scheme.view;

  // Held for a faster sweep of the map. Watched but never swallowed — shift on
  // its own has no default worth preventing.
  const MODIFIERS = { ShiftLeft: 1, ShiftRight: 1 };

  const down = new Set();
  let mask = 0;
  let latched = 0;
  let attached = false;

  function watched(code) {
    return code in BINDINGS || code in VIEW || code in MODIFIERS;
  }

  // Menus keep their keys: space still activates a focused button and the seed
  // field still accepts typing.
  function isUiTarget(target) {
    if (!target || !target.tagName) return false;
    return (
      target.isContentEditable === true ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.tagName === "BUTTON"
    );
  }

  function recompute() {
    mask = 0;
    down.forEach((code) => {
      if (BINDINGS[code]) mask |= BINDINGS[code];
    });
  }

  function onKeyDown(event) {
    if (!watched(event.code) || isUiTarget(event.target)) return;
    if (!(event.code in MODIFIERS)) event.preventDefault(); // space and arrows would scroll
    down.add(event.code);
    recompute();
  }

  function onKeyUp(event) {
    if (!watched(event.code)) return;
    if (!isUiTarget(event.target)) event.preventDefault();
    down.delete(event.code);
    recompute();
  }

  // Alt-tabbing away mid-jump otherwise leaves the key stuck down forever.
  function onBlur() {
    down.clear();
    recompute();
  }

  function attach(target = window) {
    if (attached) return;
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    attached = true;
  }

  function detach(target = window) {
    if (!attached) return;
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    down.clear();
    recompute();
    attached = false;
  }

  // One call per simulation step. The mask is what a replay stores; the edges
  // are what "jump was pressed this frame" is read from.
  function poll() {
    const pressed = mask & ~latched;
    const released = latched & ~mask;
    latched = mask;
    return { mask, pressed, released };
  }

  function held(bit) {
    return (mask & bit) !== 0;
  }

  // Not recorded, not simulated: this only ever moves the view.
  function fastView() {
    return down.has("ShiftLeft") || down.has("ShiftRight");
  }

  function cameraAxis() {
    let x = 0;
    let y = 0;
    down.forEach((code) => {
      const dir = VIEW[code];
      if (!dir) return;
      x += dir.x;
      y += dir.y;
    });
    return {
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
    };
  }

  // Switching scheme drops every key that was down. Half a keypress held across
  // a rebinding is a key the game thinks is still held under a binding that no
  // longer exists — which is how a player ends up walking into a wall for ever.
  function setScheme(id) {
    if (!SCHEMES[id] || scheme.id === id) return scheme.id;
    scheme = SCHEMES[id];
    BINDINGS = scheme.bindings;
    VIEW = scheme.view;
    down.clear();
    recompute();
    latched = 0;
    try {
      localStorage.setItem("platformer.scheme", id);
    } catch (err) {
      // Private windows and blocked storage: the choice just does not persist.
    }
    return scheme.id;
  }

  function schemeId() {
    return scheme.id;
  }

  function schemes() {
    return Object.values(SCHEMES).map((s) => ({ id: s.id, label: s.label }));
  }

  function controls() {
    return scheme.controls;
  }

  try {
    const saved = localStorage.getItem("platformer.scheme");
    if (saved && SCHEMES[saved]) {
      scheme = SCHEMES[saved];
      BINDINGS = scheme.bindings;
      VIEW = scheme.view;
    }
  } catch (err) {
    // No stored choice to honour; modern it is.
  }

  return {
    SIM,
    MODIFIERS,
    attach,
    detach,
    poll,
    held,
    fastView,
    cameraAxis,
    setScheme,
    schemeId,
    schemes,
    controls,
  };
})();
