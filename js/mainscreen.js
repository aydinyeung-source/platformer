// mainscreen.js — the menu, read as a level you can stand on

const Mainscreen = (() => {
  // Everything a body is measured in is tiles — 1.6 of them tall, nine of them
  // a second at a run — so the tile is the character's size, and at twenty
  // pixels the menu runner stood a third the height of the one in the caves.
  //
  // Thirty is where the things this number decides stop fighting. The runner is
  // forty-eight pixels, which reads as a character rather than a token. And a
  // card edge snaps to within half a tile of where it is drawn, which at half
  // of thirty is a margin you have to look for.
  //
  // It used to be settled by a third demand — the secret wanted thirty rows of
  // window and two pixels more of tile would not give it them. That is gone
  // with the chimney it was measuring; the tunnel that replaced it fits any
  // window the menu itself fits in. Thirty stands on the two reasons above.
  //
  // A function of the window rather than a constant, because a small window
  // should not be a menu three rows tall.
  // Floored rather than rounded, which sounds like a detail and is not. Rounding
  // up hands back a tile that divides the window into fewer rows than a smaller
  // one would: an 800 pixel window rounded to 29 and got 27 rows, while a 768
  // pixel window took 27 and got 28. Taller window, less room — and in the band
  // that lost a row, the gauntlet stopped fitting. Flooring makes rows climb
  // with the window instead of wobbling, and costs at most a pixel of tile.
  function tileFor(viewH) {
    return Math.max(24, Math.min(30, Math.floor(viewH / 28)));
  }

  // A closed box: walls down both sides, a floor along the bottom, a lid across
  // the top.
  //
  // The lid was left off for a long time on the grounds that a jump clearing
  // the screen comes back down on its own. A jump does. A wall kick does not —
  // two faces to bounce between and nothing overhead is a climb with no top to
  // it, and the runner leaves the window and does not come back. The old
  // objection was that a lid is a ceiling nobody can see to duck, and it is
  // wrong here for one reason: this ceiling is the top of the window, which is
  // the one edge in the world that needs no drawing to be obvious.
  const EDGE = 1;

  // Rows under the lid that no card may reach — the mirror of CORRIDOR below.
  // A body is 1.6 tiles tall, so a card whose top row sits closer than this to
  // the ceiling is a surface with no room to stand on: land there and the head
  // is inside the lid, which is not a landing, it is being wedged between two
  // solid things. Cards are cut off here for the same reason they are cut off
  // above the floor.
  const HEADROOM = 2;

  // Rows above the floor that no card is allowed to reach. On a window too
  // short for the menu the page scrolls, and a card that runs off the bottom of
  // it becomes a wall from the floor to the ceiling with the runner shut in
  // behind it. Cutting every box off three rows up makes the floor a corridor
  // that always goes all the way to the door â the only promise this level
  // makes, and the one it has to keep at every window size.
  const CORRIDOR = 3;

  // Which tile a page coordinate falls on. Rounded rather than floored, so a
  // card whose edge sits a little way into a tile does not get a whole tile of
  // solid rock the player can see it does not fill. Rounding is also the
  // smallest error available: with a tile this size a card edge can be half of
  // one away from where it is drawn, and half a tile up is no better a lie than
  // half a tile down.
  function tileOf(px, tile) {
    return Math.round(px / tile);
  }

  // Everything the page has offered up as standable. A hidden panel measures
  // zero and is skipped, which is what keeps the runs tab from being solid
  // while it is not on screen.
  //
  // data-solid="platform" is one-way: thin bars — chip rows, the shelf the
  // door stands on — can be jumped up through and landed on. A card is solid
  // all the way through, because a card is big enough to be a building.
  //
  // One card is one box. Anything marked solid inside something else already
  // marked solid is skipped: its rect is inside the outer one anyway, and the
  // only thing measuring it again can do is round an edge to a different tile
  // and leave a lip on a surface that is meant to be flat. The card decides
  // where its own ground is, not the widgets sitting on it.
  function boxesFrom(root) {
    const boxes = [];
    const marked = Array.prototype.slice.call(root.querySelectorAll("[data-solid]"));

    marked.forEach((el) => {
      if (marked.some((outer) => outer !== el && outer.contains(el))) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      boxes.push({ rect, platform: el.getAttribute("data-solid") === "platform" });
    });
    return boxes;
  }

  function doorFrom(root) {
    const el = root.querySelector("[data-door]");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return rect.width < 1 || rect.height < 1 ? null : rect;
  }

  // ----------------------------------------------------------------- the sky
  //
  // A second world above the menu, built only when somebody asks for it in a
  // way nobody is told about. It is one tunnel at present, stripped back from
  // the gauntlet that used to be here — the vault tower, the uncoil chasm, the
  // skim pit and the chimney are all gone, and their tuned distances are in the
  // history rather than sitting here describing things nobody can walk into.
  //
  // Rows, in tiles down from the top of the window:
  //
  //   0        the ceiling, which is the menu's own lid and needs no carving
  //   1-2      two rows of headroom, which is exactly a standing body and no
  //            jump at all — sprint it, do not hop it
  //   3        the tunnel floor
  //
  // And a hole at the left-hand end: the shaft, which is the way up to all of
  // it and the only thing the tunnel does not floor over.
  const SKY = {
    lid: 0,
    deck: 3,
    // The climbing shaft: open columns with the left pillar down one side and
    // the chimney wall down the other.
    //
    // Two, and the width is the difficulty. A chimney is climbed by kicking
    // from one face to the other, so a narrow one is the kinder one — the far
    // wall arrives before the apex does and there is time in hand to take the
    // next kick. Three across and the crossing takes as long as the rise: you
    // land on the far face exactly as you stop going up, every time, which is a
    // climb that only just works.
    shaft: 2,
  };

  // Every column the left-hand end is made of. The shaft, the wall that closes
  // it, and the first column of tunnel floor past that.
  function skyPlan() {
    const shaftFrom = EDGE;
    const shaftTo = shaftFrom + SKY.shaft - 1;
    const wall = shaftTo + 1;
    return { shaftFrom, shaftTo, wall, start: wall + 1 };
  }

  // The left-hand end, and enough tunnel past it to be worth walking down.
  const MIN_TUNNEL = 8;
  const MIN_WIDTH = skyPlan().start + MIN_TUNNEL + EDGE;

  // Room for the ceiling, the headroom and the floor, and a row under it so the
  // deck is not sitting on the menu's own floor.
  const MIN_HEIGHT = SKY.deck + 2;

  // Two questions about the grid and nothing about the page.
  function skyFits(width, height) {
    return width >= MIN_WIDTH && height >= MIN_HEIGHT;
  }

  function carveSky(put, get, width, height) {
    const T = Level.TILE;
    if (!skyFits(width, height)) return null;

    const plan = skyPlan();
    const laid = [];

    function stone(x, y) {
      if (x < EDGE || x >= width - EDGE || y < 0 || y >= height) return;
      put(x, y, T.GROUND);
      laid.push({ x, y });
    }

    function clear(x, y) {
      if (x < EDGE || x >= width - EDGE || y < 0 || y >= height) return;
      put(x, y, T.EMPTY);
    }

    // ------------------------------------------------------------- the tunnel
    //
    // Floor from the far side of the gap to the right-hand wall, and the two
    // rows above it opened out. The ceiling is not carved at all: row zero is
    // the lid the menu already has on it, drawn as the cornice, and laying sky
    // stone over the whole width would put a dark slab across a marble ceiling
    // to say a thing that is already true.
    const last = width - EDGE - 1;
    for (let x = plan.start; x <= last; x++) {
      stone(x, SKY.deck);
      clear(x, SKY.deck - 1);
      clear(x, SKY.deck - 2);
    }

    // -------------------------------------------------------------- the shaft
    //
    // No floor is laid across it — the point of it is the floor that is not
    // there. The headroom is opened anyway, over the shaft and over the wall
    // that closes it, so a climber stepping off the top of that wall has two
    // clear rows to do it in rather than a ceiling to crack their head on.
    for (let x = plan.shaftFrom; x <= plan.wall; x++) {
      clear(x, SKY.deck - 1);
      clear(x, SKY.deck - 2);
    }

    // ------------------------------------------------------------ the chimney
    //
    // The way up, and the reason the shaft is left open. This is the face
    // opposite the pillar, run from the deck all the way down — and two faces
    // is a climb, where one is a scramble that runs out at nine tiles, which is
    // nothing against the height of a window.
    //
    // It stops a row short of the line cards are cut off at, for the reason
    // cards are cut off there: the corridor along the floor has to run the
    // width of the window, and a wall standing in it is the one thing this
    // level never builds. That leaves the bottom few rows open on both sides,
    // so the shaft is walked into rather than dropped into.
    //
    // It stops a row below the deck rather than level with it, so the tile at
    // the top of the wall is open air and the shaft runs the whole way up into
    // the tunnel's own headroom. The climb comes out beside the deck instead of
    // onto it.
    const chimneyFoot = height - EDGE - CORRIDOR - 1;
    for (let y = SKY.deck + 1; y <= chimneyFoot; y++) stone(plan.wall, y);

    // There is no exit box. The gap was one for a while — drop through it and
    // the sky came down with you — and it is not any more: once this is built
    // it stays built. Falling down the shaft puts the runner back on the menu
    // with the tunnel still overhead, and the climb back up is the way in.

    // The far end of the tunnel, standing on the deck with its back to the
    // right-hand pillar. It is a place rather than a mechanism: two tiles of
    // doorway in the two rows of headroom, which is the whole height there is
    // up here. Nothing is carved for it — a door you can walk through is a door
    // with no tile in the way — so this is only where it is, and what walks
    // into it is decided by whoever is holding the box.
    const door = { x: width - EDGE - 2, y: SKY.deck - 2, w: 2, h: 2 };

    return {
      tiles: laid,
      door,
      // Set down one column into the floor, with the gap at their back.
      entry: { x: plan.start + 1, y: SKY.deck - 1 },
    };
  }


  function build(viewW, viewH, boxes, doorRect, options) {
    // Whole tiles only. Rounded up, the right-hand wall and the floor ran off
    // the edge of the window; rounded down, both sit inside it with a sliver of
    // unplayable margin outside that nothing can reach.
    const TILE = tileFor(viewH);
    const width = Math.max(12, Math.floor(viewW / TILE));
    const height = Math.max(10, Math.floor(viewH / TILE));
    const tiles = new Uint8Array(width * height);
    const T = Level.TILE;

    function put(x, y, tile) {
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      tiles[y * width + x] = tile;
    }

    function get(x, y) {
      if (x < 0 || x >= width || y < 0 || y >= height) return T.EMPTY;
      return tiles[y * width + x];
    }

    for (let y = 0; y < height; y++) {
      for (let e = 0; e < EDGE; e++) {
        put(e, y, T.GROUND);
        put(width - 1 - e, y, T.GROUND);
      }
    }
    // Floor and lid. The lid is what makes this a box rather than a well.
    for (let x = 0; x < width; x++) {
      for (let e = 0; e < EDGE; e++) {
        put(x, e, T.GROUND);
        put(x, height - 1 - e, T.GROUND);
      }
    }

    const roofLine = EDGE + HEADROOM;
    const floorLine = height - EDGE - CORRIDOR;

    // Rock first, one-way bars second, whatever order the page listed them in.
    // The guard below can only hold once the rock is down: a chip row measured
    // before the card beneath it would write a one-way tile into that card's
    // top surface, and a card you drop through is worse than no card at all.
    const solids = (boxes || []).slice()
      .sort((a, b) => Number(a.platform) - Number(b.platform));

    solids.forEach((box) => {
      const x0 = tileOf(box.rect.left, TILE);
      const y0 = Math.max(roofLine, tileOf(box.rect.top, TILE));
      const x1 = Math.max(x0 + 1, tileOf(box.rect.right, TILE));
      const y1 = Math.min(floorLine, Math.max(y0 + 1, tileOf(box.rect.bottom, TILE)));
      const tile = box.platform ? T.PLATFORM : T.GROUND;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          // A thin bar laid across a card must not punch a one-way hole in it.
          if (box.platform && get(x, y) === T.GROUND) continue;
          put(x, y, tile);
        }
      }
    });

    // Standing room at the left end of the floor, so a card that reaches the
    // bottom of the window cannot bury the runner in itself on the first frame.
    // The bottom left corner. spawn.y is the row the body's feet finish in, so
    // the floor is the row below it and the two rows the body actually occupies
    // are this one and the one above.
    const spawn = {
      x: Math.min(width - EDGE - 2, Math.max(EDGE + 1, tileOf(30, TILE))),
      y: height - EDGE - 1,
    };
    for (let y = spawn.y - 1; y <= spawn.y; y++) {
      for (let x = spawn.x; x <= spawn.x + 1; x++) put(x, y, T.EMPTY);
    }

    // The sky goes in over the top of the cards it clears â it is a second
    // world, not a decoration on this one â but under the door, which is the
    // one thing on the screen that always has to work.
    let sky = null;
    if (options && options.sky) sky = carveSky(put, get, width, height);

    // The door is written last and over everything, because it is the one
    // thing on the screen that has to work.
    let door = null;
    if (doorRect) {
      const x0 = tileOf(doorRect.left, TILE);
      const y0 = tileOf(doorRect.top, TILE);
      const x1 = Math.max(x0 + 1, tileOf(doorRect.right, TILE));
      const y1 = Math.max(y0 + 1, tileOf(doorRect.bottom, TILE));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) put(x, y, T.DOOR);
      }
      door = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    return {
      width,
      height,
      tiles,
      spawn,
      door,
      sky,
      // How many pixels a tile of this level is worth. Carried on the level
      // rather than asked of the module, because it depends on the window the
      // level was built for — and anything drawing this level has to use the
      // same number the collision was laid out with or the two come apart.
      tile: TILE,
      // Player.update reads these off the level it is given. A menu has no
      // seed, no length and no career: it is a place, not a run.
      meters: width,
      mode: "menu",
      seed: "menu",
      menu: true,
    };
  }

  // ---------------------------------------------------------------- the gym
  //
  // The second storey, and the first level here with no page behind it. The
  // menu is the page read as collision; this is a room of its own, and all it
  // borrows is the grid — the same tile, worked out from the same window, so a
  // runner who walks out of one and into the other is the same size in both.
  //
  // Empty on purpose. It is a box with a door in it and nothing else yet, and
  // an empty room that is honestly empty is better than one furnished with
  // guesses about what will go in it.
  function createGym(viewW, viewH) {
    const TILE = tileFor(viewH);
    const width = Math.max(12, Math.floor(viewW / TILE));
    const height = Math.max(10, Math.floor(viewH / TILE));
    const tiles = new Uint8Array(width * height);
    const T = Level.TILE;

    const put = (x, y, tile) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      tiles[y * width + x] = tile;
    };

    // The same closed box the menu is, and drawn by the same code — walls down
    // both sides, a floor along the bottom, a lid across the top.
    for (let y = 0; y < height; y++) {
      for (let e = 0; e < EDGE; e++) {
        put(e, y, T.GROUND);
        put(width - 1 - e, y, T.GROUND);
      }
    }
    for (let x = 0; x < width; x++) {
      for (let e = 0; e < EDGE; e++) {
        put(x, e, T.GROUND);
        put(x, height - 1 - e, T.GROUND);
      }
    }

    return {
      width,
      height,
      tiles,
      tile: TILE,
      // Set down at the far end from the door, so the room is crossed rather
      // than arrived in and left again.
      spawn: { x: Math.max(EDGE + 1, width - EDGE - 3), y: height - EDGE - 1 },
      // The way back up. A box rather than tiles, like the tunnel's own door:
      // a door you walk through is a door with nothing in the way.
      door: { x: 2, y: height - 3, w: 2, h: 2 },
      gym: true,
      // Player.update reads these off whatever level it is given.
      meters: width,
      mode: "gym",
      seed: "gym",
      menu: true,
    };
  }

  // The whole page, measured and turned into collision in one go.
  function fromPage(root, viewW, viewH, options) {
    return build(viewW, viewH, boxesFrom(root), doorFrom(root), options);
  }

  // Whether the window is big enough for the secret at all — a grid question
  // now, with nothing to measure on the page. Floored the way build counts
  // them: rounding up would answer yes to a window the carver then finds it has
  // no room in.
  function skyRoom(viewW, viewH) {
    const tile = tileFor(viewH);
    return skyFits(Math.floor(viewW / tile), Math.floor(viewH / tile));
  }

  return {
    EDGE, HEADROOM, CORRIDOR, SKY,
    tileFor, skyRoom, tileOf, boxesFrom, doorFrom, build, fromPage, createGym,
  };
})();
