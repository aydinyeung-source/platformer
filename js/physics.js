// physics.js — gravity, collision detection, movement resolution

const Physics = (() => {
  const EPS = 1e-6;

  function solidAt(level, tx, ty) {
    return Level.at(level, tx, ty) === Level.TILE.GROUND;
  }

  function oneWayAt(level, tx, ty) {
    return Level.at(level, tx, ty) === Level.TILE.PLATFORM;
  }

  // Bodies are axis-aligned boxes measured in tiles, anchored top-left. Axes are
  // resolved one at a time — moving X, settling it, then moving Y — which is
  // what stops a body from catching on the seam between two flush tiles.
  function moveX(level, body, dx) {
    body.x += dx;
    if (dx > -EPS && dx < EPS) return;

    const top = Math.floor(body.y + EPS);
    const bottom = Math.floor(body.y + body.h - EPS);
    const edge = dx > 0 ? Math.floor(body.x + body.w - EPS) : Math.floor(body.x + EPS);

    for (let ty = top; ty <= bottom; ty++) {
      if (!solidAt(level, edge, ty)) continue;
      body.x = dx > 0 ? edge - body.w : edge + 1;
      body.vx = 0;
      return;
    }
  }

  function moveY(level, body, dy) {
    const previousBottom = body.y + body.h;
    body.y += dy;
    body.onGround = false;
    if (dy > -EPS && dy < EPS) return;

    const left = Math.floor(body.x + EPS);
    const right = Math.floor(body.x + body.w - EPS);

    if (dy > 0) {
      const edge = Math.floor(body.y + body.h - EPS);
      for (let tx = left; tx <= right; tx++) {
        // Shelves only catch a body that was already above them, so you can
        // jump up through one and land on it on the way down.
        const landed =
          solidAt(level, tx, edge) ||
          (oneWayAt(level, tx, edge) && previousBottom <= edge + EPS);
        if (!landed) continue;
        body.y = edge - body.h;
        body.vy = 0;
        body.onGround = true;
        return;
      }
      return;
    }

    const edge = Math.floor(body.y + EPS);
    for (let tx = left; tx <= right; tx++) {
      if (!solidAt(level, tx, edge)) continue;
      body.y = edge + 1;
      body.vy = 0;
      return;
    }
  }

  // The whole simulation runs on a fixed step, so no body ever travels more than
  // a fraction of a tile per move and nothing can tunnel through thin ground.
  function move(level, body, dt) {
    moveX(level, body, body.vx * dt);
    moveY(level, body, body.vy * dt);
  }

  // Which side, if either, the body is pressed against. Probing just outside the
  // box rather than reading the last collision means a wall is still "there" on
  // the frame after you stop moving into it, which is what makes wall jumps feel
  // reliable instead of frame-perfect.
  function walls(level, body) {
    const top = Math.floor(body.y + EPS);
    const bottom = Math.floor(body.y + body.h - EPS);
    const leftX = Math.floor(body.x - 0.08);
    const rightX = Math.floor(body.x + body.w + 0.08);

    let left = false;
    let right = false;
    for (let ty = top; ty <= bottom; ty++) {
      if (solidAt(level, leftX, ty)) left = true;
      if (solidAt(level, rightX, ty)) right = true;
    }
    return { left, right };
  }

  // Hazards are drawn as small shapes sitting on the floor and their reach ought
  // to match. A full-tile hitbox makes a spike unjumpable under a low ceiling,
  // because clearing it means lifting your feet a whole tile — which is exactly
  // the height a four-row tunnel will not give you.
  function touching(level, body, want, padX, padY) {
    const left = Math.floor(body.x + EPS);
    const right = Math.floor(body.x + body.w - EPS);
    const top = Math.floor(body.y + EPS);
    const bottom = Math.floor(body.y + body.h - EPS);

    for (let tx = left; tx <= right; tx++) {
      for (let ty = top; ty <= bottom; ty++) {
        if (Level.at(level, tx, ty) !== want) continue;
        const hx0 = tx + padX;
        const hx1 = tx + 1 - padX;
        const hy0 = ty + padY;
        if (body.x < hx1 && body.x + body.w > hx0 && body.y + body.h > hy0 && body.y < ty + 1) {
          return true;
        }
      }
    }
    return false;
  }

  // Which tile types a box is currently overlapping — used where the whole tile
  // counts, not just the shape drawn in it.
  function overlaps(level, body, want) {
    const found = [];
    const left = Math.floor(body.x + EPS);
    const right = Math.floor(body.x + body.w - EPS);
    const top = Math.floor(body.y + EPS);
    const bottom = Math.floor(body.y + body.h - EPS);

    for (let tx = left; tx <= right; tx++) {
      for (let ty = top; ty <= bottom; ty++) {
        if (Level.at(level, tx, ty) === want) found.push({ x: tx, y: ty });
      }
    }
    return found;
  }

  return { solidAt, oneWayAt, moveX, moveY, move, walls, overlaps, touching };
})();
