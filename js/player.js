// player.js — player state, movement, jumping, collision response

const Player = (() => {
  // Tuned against the promises the generator makes. A 26 tiles/second jump under
  // 90 tiles/second² gravity peaks at 3.7 tiles and covers 5.2 — enough for the
  // 3-tile climbs and 4-tile gaps levels are built from. Height is the easy
  // part; the hard part is not overshooting, because a floatier arc sails clean
  // over a three-tile pillar and into the pit behind it.
  const TUNING = {
    width: 0.72,
    height: 1.6,
    runSpeed: 9,
    accel: 70,
    friction: 65,
    airAccel: 42,
    gravity: 90,
    jumpSpeed: 26,
    cutJump: 0.45, // releasing early clips the arc — hold longer, jump higher
    minHold: 0.06, // a jump always gets off the ground before it can be cut
    maxFall: 55,
    coyote: 0.1, // grace after walking off an edge
    wallSlide: 9, // terminal speed while hugging a wall — a slow scrape, not a stop
    wallJumpY: 24,
    wallJumpX: 5.5,
    wallStick: 0.09, // input is ignored briefly so the push actually lands
    wallCoyote: 0.09,
    buffer: 0.12, // jump pressed just before landing still counts
  };

  function create(level) {
    const body = {
      x: level.spawn.x + (1 - TUNING.width) / 2,
      y: level.spawn.y + 1 - TUNING.height,
      w: TUNING.width,
      h: TUNING.height,
      vx: 0,
      vy: 0,
      onGround: true,
    };

    return {
      body,
      facing: 1,
      coyote: TUNING.coyote,
      buffer: 0,
      holding: false,
      holdTime: 0,
      wallDir: 0, // which side the last wall was on: -1 left, 1 right
      wallCoyote: 0,
      lockout: 0,
      onWall: false,
      falls: 0,
      time: 0,
      finished: false,
      // Where to put the player back when the ground gives out. There is no
      // death in this game, so every mistake has to resolve into a position.
      safe: { x: body.x, y: body.y },
      recovering: 0,
    };
  }

  function recover(player, level) {
    const body = player.body;
    body.x = player.safe.x;
    body.y = player.safe.y;

    // Give the retry a run-up. Putting the player back on the exact lip they
    // just failed from means the next jump starts from a standstill and fails
    // the same way — that is how a setback turns into a dead end.
    const footY = Math.round(body.y + body.h);
    let back = 0;
    while (back < 4) {
      const tx = Math.floor(body.x) - (back + 1);
      if (Level.at(level, tx, footY) !== Level.TILE.GROUND) break;
      if (Level.at(level, tx, footY - 1) !== Level.TILE.EMPTY) break;
      if (Level.at(level, tx, footY - 2) !== Level.TILE.EMPTY) break;
      back++;
    }
    body.x -= back;
    body.vx = 0;
    body.vy = 0;
    player.falls++;
    player.recovering = 0.35; // long enough to read as a setback, short enough to keep flow
  }

  function update(player, level, input, dt) {
    const body = player.body;

    if (!player.finished) player.time += dt;
    if (player.recovering > 0) player.recovering = Math.max(0, player.recovering - dt);

    // ------------------------------------------------------------------ walls
    const touching = Physics.walls(level, body);
    player.onWall = !body.onGround && (touching.left || touching.right);
    if (player.onWall) player.wallDir = touching.left ? -1 : 1;
    player.wallCoyote = player.onWall
      ? TUNING.wallCoyote
      : Math.max(0, player.wallCoyote - dt);
    player.lockout = Math.max(0, player.lockout - dt);

    // ------------------------------------------------------------ horizontal
    // Steering is ignored for a moment after a wall jump, otherwise holding
    // towards the wall cancels the push and you slide straight back down it.
    const steering = player.lockout > 0 ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const wanted = steering;
    if (wanted !== 0) player.facing = wanted;

    const target = wanted * TUNING.runSpeed;
    const rate = body.onGround ? (wanted === 0 ? TUNING.friction : TUNING.accel) : TUNING.airAccel;
    if (body.vx < target) body.vx = Math.min(target, body.vx + rate * dt);
    else if (body.vx > target) body.vx = Math.max(target, body.vx - rate * dt);

    // ----------------------------------------------------------------- jump
    player.coyote = body.onGround ? TUNING.coyote : Math.max(0, player.coyote - dt);
    player.buffer = input.jumpPressed ? TUNING.buffer : Math.max(0, player.buffer - dt);

    if (player.buffer > 0 && player.coyote > 0) {
      body.vy = -TUNING.jumpSpeed;
      body.onGround = false;
      player.buffer = 0;
      player.coyote = 0;
      player.holding = true;
      player.holdTime = 0;
    } else if (player.buffer > 0 && player.wallCoyote > 0) {
      // Off the wall and up. The push is deliberately small: with air control
      // you can drift back to the same face and climb a single wall, which is
      // what lets a level put a nine-tile step in your way.
      body.vy = -TUNING.wallJumpY;
      body.vx = -player.wallDir * TUNING.wallJumpX;
      player.buffer = 0;
      player.wallCoyote = 0;
      player.lockout = TUNING.wallStick;
      player.holding = true;
      player.holdTime = 0;
      player.facing = -player.wallDir;
    }

    // Let go on the way up and the rest of the arc is cut away. The minimum
    // hold matters: without it a jump pressed and released inside one frame is
    // clipped before it has risen at all, which reads as the jump not working.
    player.holdTime += dt;
    if (player.holding && !input.jumpHeld && body.vy < 0 && player.holdTime >= TUNING.minHold) {
      body.vy *= TUNING.cutJump;
      player.holding = false;
    }
    if (body.vy >= 0) player.holding = false;

    body.vy = Math.min(TUNING.maxFall, body.vy + TUNING.gravity * dt);

    // Scraping down a wall is slow enough to think on.
    if (player.onWall && body.vy > TUNING.wallSlide) body.vy = TUNING.wallSlide;

    Physics.move(level, body, dt);

    // -------------------------------------------------------------- contacts
    // Lava is a hazard like any other here: it costs you, it does not kill you.
    const scorched = Physics.overlaps(level, body, Level.TILE.LAVA).length;
    if (player.recovering === 0 && (scorched || Physics.overlaps(level, body, Level.TILE.SPIKE).length)) {
      recover(player, level);
      return player;
    }

    // Falling out of the world is the other way to lose your footing.
    if (body.y > level.height + 2) {
      recover(player, level);
      return player;
    }

    // Standing still on solid ground is what makes a spot worth returning to.
    if (body.onGround && player.recovering === 0) {
      const under = Level.floorAt(level, Math.round(body.x + body.w / 2));
      if (under !== null && Level.at(level, Math.round(body.x + body.w / 2), under - 1) !== Level.TILE.SPIKE) {
        player.safe.x = body.x;
        player.safe.y = body.y;
      }
    }

    // Finished by being in the doorway, not by crossing a line on the floor.
    if (!player.finished && Physics.overlaps(level, body, Level.TILE.DOOR).length) {
      player.finished = true;
    }

    return player;
  }

  function metres(player) {
    return Math.max(0, Math.round(player.body.x));
  }

  return { TUNING, create, update, recover, metres };
})();
