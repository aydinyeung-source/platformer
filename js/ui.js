// ui.js — HUD, menus, buttons, screen transitions

const UI = (() => {
  const MARGIN = 20; // how far inside the view edge the arrow sits
  const SIZE = 11;

  function toScreen(camera, worldX, worldY) {
    return { x: worldX - camera.x, y: worldY - camera.y };
  }

  function isOffscreen(camera, worldX, worldY, pad = 0) {
    const point = toScreen(camera, worldX, worldY);
    return (
      point.x < pad ||
      point.y < pad ||
      point.x > camera.viewW - pad ||
      point.y > camera.viewH - pad
    );
  }

  // Points at something the camera has left behind. Direction alone would not
  // be enough: losing the runner is meant to cost you, so the arrow carries the
  // distance too — that is the difference between "off to the left" and "in
  // trouble 300 m to the left".
  function offscreenArrow(ctx, camera, target, options = {}) {
    if (!isOffscreen(camera, target.x, target.y)) return false;

    const colour = options.colour || "#c4632a";
    const outline = options.outline || "#ffffff";
    const margin = options.margin || MARGIN;
    const size = options.size || SIZE;

    const point = toScreen(camera, target.x, target.y);
    const cx = camera.viewW / 2;
    const cy = camera.viewH / 2;
    const dx = point.x - cx;
    const dy = point.y - cy;
    if (!dx && !dy) return false;

    // Slide out from the middle until the first edge of the inset frame is hit.
    const halfW = Math.max(1, cx - margin);
    const halfH = Math.max(1, cy - margin);
    const reach = Math.min(
      dx ? halfW / Math.abs(dx) : Infinity,
      dy ? halfH / Math.abs(dy) : Infinity
    );
    const ax = cx + dx * reach;
    const ay = cy + dy * reach;
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.7, size * 0.66);
    ctx.lineTo(-size * 0.7, -size * 0.66);
    ctx.closePath();
    // A paper-coloured edge keeps the arrow readable over dark terrain. Round
    // joins matter here: mitred corners on a sharp triangle throw off spikes.
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.restore();

    if (options.label) {
      const lx = ax - Math.cos(angle) * (size + 26);
      const ly = ay - Math.sin(angle) * (size + 26);
      ctx.save();
      ctx.font = options.font || '10px ui-monospace, Consolas, monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = outline;
      ctx.strokeText(options.label, lx, ly);
      ctx.fillStyle = colour;
      ctx.fillText(options.label, lx, ly);
      ctx.restore();
    }

    return true;
  }

  return { MARGIN, SIZE, toScreen, isOffscreen, offscreenArrow };
})();
