// camera.js — the view window over a level. Panned by hand, never by the player.

const Camera = (() => {
  // The camera moves at one flat rate, measured in tiles like everything else,
  // so a pan covers a predictable amount of ground. The caller sets it from the
  // player run speed, which keeps the two in a fixed relationship.
  const DEFAULT_SPEED = 600; // px/second

  function create(options = {}) {
    return {
      x: 0,
      y: 0,
      viewW: options.viewW || 800,
      viewH: options.viewH || 200,
      worldW: options.worldW || 0,
      worldH: options.worldH || 0,
      speed: options.speed || DEFAULT_SPEED,
      // Room to rise above the world. Rock reaches the very top row in most
      // columns, so stopping dead at the world edge leaves a wall filling the
      // screen with no way to get above it and see what you are looking at.
      overscan: options.overscan || 0,
    };
  }

  function clamp(camera) {
    const maxX = Math.max(0, camera.worldW - camera.viewW);
    const maxY = Math.max(0, camera.worldH - camera.viewH);
    camera.x = Math.min(maxX, Math.max(0, camera.x));
    camera.y = Math.min(maxY, Math.max(-camera.overscan, camera.y));
    return camera;
  }

  function resize(camera, viewW, viewH) {
    camera.viewW = viewW;
    camera.viewH = viewH;
    return clamp(camera);
  }

  function setWorld(camera, worldW, worldH) {
    camera.worldW = worldW;
    camera.worldH = worldH;
    return clamp(camera);
  }

  function pan(camera, dx, dy) {
    camera.x += dx;
    camera.y += dy;
    return clamp(camera);
  }

  function update(camera, dt, axis, speed) {
    if (!axis.x && !axis.y) return camera;
    const rate = speed || camera.speed;
    return pan(camera, axis.x * rate * dt, axis.y * rate * dt);
  }

  function centerOn(camera, worldX, worldY) {
    camera.x = worldX - camera.viewW / 2;
    camera.y = worldY - camera.viewH / 2;
    return clamp(camera);
  }

  // Only the columns on screen get drawn, which is what keeps a 10 000 tile
  // level as cheap to render as a 1 000 tile one.
  function visibleTiles(camera, tilePx, cols, rows) {
    return {
      x0: Math.max(0, Math.floor(camera.x / tilePx)),
      x1: Math.min(cols - 1, Math.ceil((camera.x + camera.viewW) / tilePx)),
      y0: Math.max(0, Math.floor(camera.y / tilePx)),
      y1: Math.min(rows - 1, Math.ceil((camera.y + camera.viewH) / tilePx)),
    };
  }

  return { DEFAULT_SPEED, create, clamp, resize, setWorld, pan, update, centerOn, visibleTiles };
})();
