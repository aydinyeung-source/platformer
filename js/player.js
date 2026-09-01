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
    // Kicking off the wall opposite the one you last kicked is a chimney climb
    // rather than a scrape up a single face, and it pays what a chimney climb
    // is worth: higher, and hard enough across to put you on the far wall with
    // the height to kick again. Same wall twice and it is the ordinary push.
    chimneyY: 28.5,
    chimneyX: 8,
    wallStick: 0.09, // input is ignored briefly so the push actually lands
    wallCoyote: 0.09,
    buffer: 0.12, // jump pressed just before landing still counts
    doorFade: 0.6, // seconds the runner takes to step into the doorway

    // The slide. Half height, so it fits where standing does not; a burst of
    // speed that decays to a crawl, so holding it down is not a way to travel
    // faster; and a cooldown, so tapping it is not either.
    slideHeight: 0.8,
    slideEntry: 0.6, // of run speed — a slide is carried into, not dropped into
    slideBoost: 1.35, // of run speed, at the moment it starts
    crawlSpeed: 0.45, // of run speed, where it ends up
    slideDecay: 0.35, // seconds from one to the other
    slideCooldown: 0.2,

    // Two things fall out of a slide, and the game says nothing about either.
    //
    // Jump while still down and you skim: barely off the floor, so it fits
    // under a two-row roof, and far enough forward to cross sunken lava that
    // has no business being crossable.
    skimVy: 12, // rises 0.8 of a tile — under a 2-row ceiling, that is the lot
    skimVx: 10,

    // Jump in the three frames after standing up and you uncoil: a tile higher
    // than a jump otherwise reaches, with the slide's speed still under you.
    uncoil: 0.05,
    uncoilJump: 29.2,
  };

  // Room for the taller body to come back. Standing up inside a crawlway would
  // put your head in the rock, so it is refused rather than resolved.
  function canStand(level, body) {
    const feet = body.y + body.h;
    const x0 = Math.floor(body.x + 0.001);
    const x1 = Math.floor(body.x + body.w - 0.001);
    const y0 = Math.floor(feet - TUNING.height + 0.001);
    const y1 = Math.floor(body.y + 0.001);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) if (Physics.solidAt(level, tx, ty)) return false;
    }
    return true;
  }

  // Height changes keep the feet where they are, so ducking never posts you
  // through the floor and standing never leaves you hovering.
  function setHeight(body, h) {
    body.y += body.h - h;
    body.h = h;
  }

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
      lastWallKicked: 0, // -1 left wall, 1 right wall, 0 since standing on the ground
      sliding: false,
      skimming: false,
      slideTime: 0,
      slideDir: 1,
      slideCool: 0,
      uncoil: 0,
      falls: 0,
      time: 0,
      finished: false,
      entering: 0, // 1 at the doorway, 0 once through it
      // Where to put the player back when the ground gives out. There is no
      // death in this game, so every mistake has to resolve into a position.
      safe: { x: body.x, y: body.y },
      recovering: 0,
    };
  }

  function recover(player, level) {
    const body = player.body;
    // Back on your feet, literally: safe spots are recorded standing, so the
    // body has to be standing to be put back in one.
    body.h = TUNING.height;
    player.sliding = false;
    player.skimming = false;
    player.uncoil = 0;
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

    // Once through the door there is nothing left to simulate. The runner stands
    // in the doorway and fades into it; gravity, input and the clock are all
    // done with, and none of them get a say in how the run ended.
    if (player.finished) {
      player.entering = Math.max(0, player.entering - dt / TUNING.doorFade);
      body.vx = 0;
      body.vy = 0;
      return player;
    }

    player.time += dt;
    if (player.recovering > 0) player.recovering = Math.max(0, player.recovering - dt);

    // ------------------------------------------------------------------ walls
    const touching = Physics.walls(level, body);
    player.onWall = !body.onGround && (touching.left || touching.right);
    if (player.onWall) player.wallDir = touching.left ? -1 : 1;
    player.wallCoyote = player.onWall
      ? TUNING.wallCoyote
      : Math.max(0, player.wallCoyote - dt);
    player.lockout = Math.max(0, player.lockout - dt);

    // ------------------------------------------------------------- sliding
    // Something you carry into rather than a crouch you drop into: it needs a
    // run behind it, it drops you to half height, and it gives back speed you
    // would not otherwise keep.
    const wantSlide = input.slideHeld === true;
    player.slideCool = Math.max(0, player.slideCool - dt);

    if (!player.sliding && wantSlide && body.onGround && player.slideCool === 0 &&
        player.recovering === 0) {
      // Down at a run is a slide; down standing still is a crouch. Same key,
      // same posture, and the difference is only whether you brought any speed
      // to it — so a crouch starts where a slide has already finished, at a
      // crawl, and cannot be used to skip the run-up.
      const running = Math.abs(body.vx) >= TUNING.runSpeed * TUNING.slideEntry;
      player.sliding = true;
      player.slideTime = running ? 0 : TUNING.slideDecay;
      player.slideDir = running ? (body.vx < 0 ? -1 : 1) : player.facing;
      setHeight(body, TUNING.slideHeight);
      if (running) body.vx = player.slideDir * TUNING.runSpeed * TUNING.slideBoost;
    }

    if (player.sliding) {
      player.slideTime += dt;

      // Standing up is not always yours to decide. Under a low roof you stay
      // down however hard you let go of the key, which is what makes a two-row
      // passage a place you travel rather than a place you get stuck.
      if (!wantSlide && body.onGround && canStand(level, body)) {
        setHeight(body, TUNING.height);
        player.sliding = false;
        player.skimming = false;
        player.slideCool = TUNING.slideCooldown;
        // Coiled. See the jump below: this is the window, and nothing says so.
        player.uncoil = TUNING.uncoil;
      } else if (body.onGround) {
        // Boost first, crawl by the end of it, smoothly in between. Held down
        // for ever it is a crawl, so holding it is not a way to go faster.
        const t = Math.min(1, player.slideTime / TUNING.slideDecay);

        if (t < 1) {
          // Still carrying the slide: committed to the direction you went down
          // in, because that is what makes it a slide and not a walk.
          body.vx = player.slideDir * TUNING.runSpeed * TUNING.slideBoost +
            player.slideDir * TUNING.runSpeed * (TUNING.crawlSpeed - TUNING.slideBoost) * t;
        } else {
          // Spent. Now it is a crouch, and a crouch steers: left and right
          // crawl and turn, nothing at all stays put. This is also the way out
          // from under a roof too low to stand up beneath, which would
          // otherwise be a corridor you committed to before you could see it.
          const turn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
          if (turn !== 0) {
            player.slideDir = turn;
            player.facing = turn;
          }
          body.vx = turn === 0 ? 0 : turn * TUNING.runSpeed * TUNING.crawlSpeed;
        }
      }
    }
    player.uncoil = Math.max(0, player.uncoil - dt);

    // ------------------------------------------------------------ horizontal
    // Steering is ignored for a moment after a wall jump, otherwise holding
    // towards the wall cancels the push and you slide straight back down it.
    // A slide has no steering on the ground either: you committed to a
    // direction when you went down.
    const grounded = player.sliding && body.onGround;
    const steering = player.lockout > 0 || grounded
      ? 0
      : (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const wanted = steering;
    if (wanted !== 0 && !player.sliding) player.facing = wanted;

    if (!grounded) {
      const target = wanted * TUNING.runSpeed;
      const rate = body.onGround ? (wanted === 0 ? TUNING.friction : TUNING.accel) : TUNING.airAccel;
      // Momentum earned in a slide survives the jump. In the air, above running
      // pace and still going that way, nothing drags you back down to it — that
      // is what carries a skim across a gap and an uncoil beyond one.
      const carrying = !body.onGround &&
        Math.abs(body.vx) > TUNING.runSpeed &&
        (player.skimming || Math.sign(body.vx) === Math.sign(wanted));
      if (!carrying) {
        if (body.vx < target) body.vx = Math.min(target, body.vx + rate * dt);
        else if (body.vx > target) body.vx = Math.max(target, body.vx - rate * dt);
      }
    }

    // ----------------------------------------------------------------- jump
    player.coyote = body.onGround ? TUNING.coyote : Math.max(0, player.coyote - dt);
    player.buffer = input.jumpPressed ? TUNING.buffer : Math.max(0, player.buffer - dt);

    if (player.buffer > 0 && player.coyote > 0) {
      if (player.sliding && body.onGround) {
        // The skim. Flat and fast rather than high: it rises less than a tile,
        // so it stays under a two-row roof, and it carries far enough across to
        // clear the sunken lava that a walk cannot. Not cuttable — a skim you
        // could clip short would drop you in the pool.
        body.vy = -TUNING.skimVy;
        body.vx = player.slideDir * TUNING.skimVx;
        player.skimming = true;
        player.holding = false;
      } else {
        // The uncoil. Jump in the three frames after standing out of a slide
        // and the spring goes into the jump: a tile higher than a jump can
        // otherwise reach, with the slide's speed still under you.
        const uncoiled = player.uncoil > 0 && body.onGround;
        body.vy = -(uncoiled ? TUNING.uncoilJump : TUNING.jumpSpeed);
        player.uncoil = 0;
        player.holding = true;
      }
      body.onGround = false;
      player.buffer = 0;
      player.coyote = 0;
      player.holdTime = 0;
    } else if (player.buffer > 0 && player.wallCoyote > 0) {
      // Off the wall and up. Off a single face the push is deliberately small:
      // with air control you can drift back to the same wall and climb it,
      // which is what lets a level put a nine-tile step in your way. Alternate
      // faces and it is a chimney, and a chimney pays better.
      const chimney = player.wallDir !== player.lastWallKicked;
      body.vy = -(chimney ? TUNING.chimneyY : TUNING.wallJumpY);
      body.vx = -player.wallDir * (chimney ? TUNING.chimneyX : TUNING.wallJumpX);
      player.lastWallKicked = player.wallDir;
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

    // A skim ends where it lands. Whether you stay down after it is decided
    // next step, by the key and by the roof.
    if (player.skimming && body.onGround) player.skimming = false;
    // Standing on the ground forgets which wall you came off, so the next climb
    // starts fresh and its first kick counts as an alternating one.
    if (body.onGround) player.lastWallKicked = 0;

    // -------------------------------------------------------------- contacts
    // Lava costs a recovery: it puts you back on your feet somewhere safe and
    // takes the time off you. It lies in the floor and fills its tile, so it is
    // caught on a hair of overlap rather than half a tile of one.
    if (player.recovering === 0 && Physics.touching(level, body, Level.TILE.LAVA, 0.08, 0.12)) {
      recover(player, level);
      return player;
    }

    // Falling out of the world is the other way to lose your footing.
    if (body.y > level.height + 2) {
      recover(player, level);
      return player;
    }

    // Standing still on solid ground is what makes a spot worth returning to.
    // Never mid-slide: that position is half a body high, and coming back to it
    // standing would post you into the ceiling that made you duck.
    if (body.onGround && player.recovering === 0 && !player.sliding) {
      player.safe.x = body.x;
      player.safe.y = body.y;
    }

    // Finished by being in the doorway, not by crossing a line on the floor.
    // Through it rather than past it: the run stops dead where the door is,
    // instead of carrying its momentum out the far side of the frame.
    if (!player.finished && Physics.overlaps(level, body, Level.TILE.DOOR).length) {
      player.finished = true;
      player.entering = 1;
      body.vx = 0;
      body.vy = 0;
    }

    return player;
  }

  function metres(player) {
    return Math.max(0, Math.round(player.body.x));
  }

  return { TUNING, create, update, recover, metres };
})();
