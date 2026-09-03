// physics.js — gravity, collision detection, movement resolution

const Physics = (() => {
  const EPS = 1e-6;

  function solidAt(level, tx, ty) {
    const tile = Level.at(level, tx, ty);
    if (tile === Level.TILE.GROUND) return true;
    if (tile !== Level.TILE.CRUMBLE) return false;

    // Crumbling stone is solid until this run has broken it, and the set of
    // what is broken belongs to the run rather than to the level. The same seed
    // carves the same blocks every time; which of them are currently missing is
    // a thing about the last few seconds, and the map should not remember it.
    //
    // A level with no set — the menu, the gym, a replay watched from a world
    // where nobody has stood anywhere — has nothing broken in it.
    return !(level.broken && level.broken.has(ty * level.width + tx));
  }

  function oneWayAt(level, tx, ty) {
    return Level.at(level, tx, ty) === Level.TILE.PLATFORM;
  }

  // Bodies are axis-aligned boxes measured in tiles, anchored top-left. Axes are
  // resolved one at a time — moving X, settling it, then moving Y — which is
  // what stops a body from catching on the seam between two flush tiles.
  function moveX(level, body, dx) {
    body.x += dx;

    // The world ends at its edges, and every tile outside them reads as empty
    // rather than solid — so nothing but this stops a runner walking off the
    // side of the map into space that was never carved because it is not there.
    if (body.x < 0) {
      body.x = 0;
      body.vx = 0;
    } else if (body.x > level.width - body.w) {
      body.x = level.width - body.w;
      body.vx = 0;
    }

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

  // A hazard's reach ought to match what is drawn. The padding is what keeps
  // brushing the lip of a pool from counting as falling in it, so a jump that
  // just clears the far edge is a jump that cleared it.
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
