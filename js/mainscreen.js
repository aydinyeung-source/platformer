// mainscreen.js — the menu, read as a level you can stand on

const Mainscreen = (() => {
  // Small. The runner is 1.6 tiles tall, so twenty pixels makes a character
  // about a thumbnail high — big enough to read the sprite on, small enough
  // that a card is something you climb rather than something you step over.
  const TILE = 20;

  // Walls down both sides and a floor along the bottom. The top is left open:
  // a jump that clears the screen comes back down, and a lid there would be a
  // ceiling nobody can see to duck.
  const EDGE = 1;

  // Rows above the floor that no card is allowed to reach. On a window too
  // short for the menu the page scrolls, and a card that runs off the bottom of
  // it becomes a wall from the floor to the ceiling with the runner shut in
  // behind it. Cutting every box off three rows up makes the floor a corridor
  // that always goes all the way to the door â the only promise this level
  // makes, and the one it has to keep at every window size.
  const CORRIDOR = 3;

  // The stepping stones between the cards and the door, in tiles rather than in
  // pixels. Laid out here and then handed to the page to position, instead of
  // placed in CSS and measured back: a staircase written in pixels only lines
  // up with the tile grid at some window heights, and at the others one of its
  // steps quietly becomes a tile taller than a jump can reach.
  //
  // Three up and five across, which is inside the envelope the whole game is
  // built to (RULES.maxStepUp is 3, RULES.maxGap is 4) with a tile to spare.
  const STEPS = [
    { rise: 3, from: 7, width: 5 },
    { rise: 6, from: 13, width: 5 },
    { rise: 9, from: 7, width: 5 },
  ];

  // Which tile a page coordinate falls on. Rounded rather than floored, so a
  // card whose edge sits two pixels into a tile does not get a whole tile of
  // solid rock the player can see it does not fill.
  function tileOf(px) {
    return Math.round(px / TILE);
  }

  // Everything the page has offered up as standable. A hidden panel measures
  // zero and is skipped, which is what keeps the runs tab from being solid
  // while it is not on screen.
  //
  // data-solid="platform" is one-way: thin bars — chip rows, the button row,
  // the stepping ledges — can be jumped up through and landed on. A card is
  // solid all the way through, because a card is big enough to be a building.
  function boxesFrom(root) {
    const boxes = [];
    Array.prototype.forEach.call(root.querySelectorAll("[data-solid]"), (el) => {
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
  // way nobody is told about. Rows, in tiles down from the top of the window:
  //
  //   0        the lid over the bridge
  //   1-2      two rows of headroom, which is exactly a standing body and no
  //            jump at all — sprint it, do not hop it
  //   3        the bridge deck, from the left wall to the mouth of the gym
  //   4-5      the vault landing, in the two rows under the bridge
  //   6        the gym's upper deck: run-up, chasm, far side
  //   10       the low roof over the skim pit
  //   13       the gym's lower deck, and the tops of the chimney walls
  //   25       the chimney floor
  //
  // Every distance in it is measured against the movement envelope rather than
  // picked by eye: the chasm is wider than a jump and narrower than an uncoil,
  // the roof is lower than a jump and higher than a skim, the chimney is two
  // wide, and the vault face is eight tall with nothing to bounce off.
  //
  // The route is a loop, and the exit is deliberately the hardest thing on it
  // to reach: the vault sits under the bridge with open air on one side and
  // eight blank tiles below, so the only way onto it is up its own face, from
  // the top of the chimney you just climbed out of.
  const SKY = {
    lid: 0,
    deck: 3,
    // Three rows under the bridge rather than two. A climber coming up the
    // face bonks the deck's underside on the way, and with only a body's
    // height of pocket there is no time to drift sideways onto the top before
    // falling back past it â the climb was possible and the landing was not.
    vault: 7,
    upper: 6,
    roof: 10,
    lower: 13,
    pitFloor: 25,

    mouth: 2, // columns of bridge past the vault before the gym deck starts
    runUp: 8, // deck before the chasm — a slide needs a run at it
    chasm: 7, // a jump covers 5.2 tiles, an uncoil about 7.9
    landing: 3,
    // Three, not two. Under a two-row roof a jump bonks after four tenths of a
    // tile and still carries about 1.9 across, which clears a two-wide hole;
    // three asks for 2.3, which only the skim's flat 2.7 will do.
    skimPit: 3,
    shaft: 2, // the chimney: its two faces, two columns apart
  };

  // The gym starts clear of the cards; the vault tower takes the two columns to
  // its left, tucked under the bridge.
  function skyPlan(width, cardsRight) {
    const g = Math.max(cardsRight + 3, EDGE + 6);
    const last = g + SKY.mouth + SKY.runUp + SKY.chasm + SKY.landing + 1;
    return { g, last, fits: last <= width - EDGE - 1 };
  }

  // Wide enough for the gauntlet and tall enough for the chimney to have a
  // floor of its own. Anything smaller and the secret is simply not there,
  // which is better than a gauntlet with one of its obstacles folded flat.
  function skyFits(width, height, cardsRight) {
    return skyPlan(width, cardsRight).fits && height > SKY.pitFloor + 4;
  }

  function carveSky(put, get, width, height, cardsRight) {
    const T = Level.TILE;
    if (!skyFits(width, height, cardsRight)) return null;

    const g = skyPlan(width, cardsRight).g;
    const u = g + SKY.mouth; // where the gym's upper deck begins
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

    function row(y, x0, x1) {
      for (let x = x0; x <= x1; x++) stone(x, y);
    }

    function column(x, y0, y1) {
      for (let y = y0; y <= y1; y++) stone(x, y);
    }

    // -------------------------------------------------------------- the bridge
    // Deck and lid stop at the mouth of the gym: past that the sky is open,
    // because an uncoil needs five clear rows over its head and a headhitter
    // corridor has two.
    row(SKY.deck, EDGE, u - 1);
    row(SKY.lid, EDGE, u - 1);
    for (let x = EDGE; x < u; x++) {
      clear(x, SKY.deck - 1);
      clear(x, SKY.deck - 2);
    }

    // --------------------------------------------------------- the vault tower
    // Eight tiles of blank face with nothing opposite it, so the only way up is
    // to kick off it and drift back onto it. Its top is the two-row pocket
    // under the bridge deck.
    column(g - 2, SKY.vault, SKY.lower + 1);
    column(g - 1, SKY.vault, SKY.lower + 1);
    const exit = { x: g - 2, y: SKY.vault - 3, w: 2, h: 3 };
    for (let y = exit.y; y < exit.y + exit.h; y++) {
      for (let x = exit.x; x < exit.x + exit.w; x++) clear(x, y);
    }

    // ------------------------------------------------------- the uncoil chasm
    const runEnd = u + SKY.runUp - 1;
    const farSide = runEnd + SKY.chasm + 1;
    const upperEnd = farSide + SKY.landing - 1;
    row(SKY.upper, u, runEnd);
    row(SKY.upper, farSide, upperEnd);

    // ----------------------------------------------------------- the skim pit
    // Entered by walking off the right-hand end of the upper deck, and run back
    // the other way: right to left, under a roof too low to jump beneath, over
    // a hole too wide to walk across.
    const lowRight = upperEnd + 1;
    const lowLeft = g + SKY.shaft + 2;
    row(SKY.lower, lowLeft, lowRight);
    row(SKY.roof, lowLeft, lowRight - 4);
    const pitAt = lowLeft + 4;
    for (let x = pitAt; x < pitAt + SKY.skimPit; x++) clear(x, SKY.lower);

    // ------------------------------------------------------------ the chimney
    // Two faces, two columns apart, twelve rows deep. Kicking the same face
    // twice barely lifts you; alternating them is a climb, and there is no
    // other way out.
    // Placed so the climber steps out of it onto the vault's own face: the
    // left wall's top is the one tile that has the tower beside it.
    const left = g;
    const rightWall = g + SKY.shaft + 1;
    column(left, SKY.lower, SKY.pitFloor);
    column(rightWall, SKY.lower, SKY.pitFloor);
    row(SKY.pitFloor, left, rightWall);
    for (let y = SKY.lower; y < SKY.pitFloor; y++) {
      for (let x = left + 1; x < rightWall; x++) clear(x, y);
    }

    return {
      tiles: laid,
      exit,
      // Where the runner is set down when the bridge appears: on the deck at
      // the left-hand end, in the headroom, facing the length of it.
      entry: { x: EDGE + 1, y: SKY.deck - 1 },
      gym: u,
    };
  }

  function build(viewW, viewH, boxes, doorRect, options) {
    const width = Math.max(12, Math.ceil(viewW / TILE));
    const height = Math.max(10, Math.ceil(viewH / TILE));
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
    for (let x = 0; x < width; x++) {
      for (let e = 0; e < EDGE; e++) put(x, height - 1 - e, T.GROUND);
    }

    const floorLine = height - EDGE - CORRIDOR;

    (boxes || []).forEach((box) => {
      const x0 = tileOf(box.rect.left);
      const y0 = tileOf(box.rect.top);
      const x1 = Math.max(x0 + 1, tileOf(box.rect.right));
      const y1 = Math.min(floorLine, Math.max(y0 + 1, tileOf(box.rect.bottom)));
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
    // spawn.y is the row the body's feet finish in, so the floor is the row
    // below it and the two rows the body actually occupies are this one and
    // the one above.
    const spawn = { x: EDGE + 1, y: height - EDGE - 1 };
    for (let y = spawn.y - 1; y <= spawn.y; y++) {
      for (let x = spawn.x; x <= spawn.x + 1; x++) put(x, y, T.EMPTY);
    }

    // The staircase, hung off the left side of the doorway and climbing away
    // from it. A step with anything already in it slides towards the door until
    // it finds clear air â half a ledge inside a card is a step you can see and
    // cannot stand on â and if there is nowhere clear for it, the staircase
    // stops there. The steps above a missing one are not steps, they are
    // decoration on a wall nobody can climb.
    const ledges = [];
    const anchor = doorRect ? tileOf(doorRect.left) : width - EDGE - 2;
    let below = null;

    for (const step of STEPS) {
      const y = height - EDGE - step.rise;
      if (y < 1) break;

      let placed = null;
      for (let from = step.from; from >= step.width && !placed; from--) {
        const x0 = anchor - from;
        const x1 = x0 + step.width;
        if (x0 < EDGE + 1 || x1 > width - EDGE) continue;
        // Reachable from the step under it, not just clear of everything.
        const gap = below ? Math.max(below.x - x1, x0 - (below.x + below.w)) : 0;
        if (gap > Level.RULES.maxGap) continue;
        let clear = true;
        for (let x = x0; x < x1; x++) if (get(x, y) !== T.EMPTY) clear = false;
        if (clear) placed = { x: x0, y, w: step.width };
      }

      if (!placed) break;
      for (let x = placed.x; x < placed.x + placed.w; x++) put(x, y, T.PLATFORM);
      ledges.push(placed);
      below = placed;
    }

    // The sky goes in over the top of the cards it clears â it is a second
    // world, not a decoration on this one â but under the door, which is the
    // one thing on the screen that always has to work.
    let sky = null;
    if (options && options.sky) {
      let cardsRight = EDGE;
      (boxes || []).forEach((box) => {
        cardsRight = Math.max(cardsRight, tileOf(box.rect.right));
      });
      sky = carveSky(put, get, width, height, cardsRight);
    }

    // The door is written last and over everything, because it is the one
    // thing on the screen that has to work.
    let door = null;
    if (doorRect) {
      const x0 = tileOf(doorRect.left);
      const y0 = tileOf(doorRect.top);
      const x1 = Math.max(x0 + 1, tileOf(doorRect.right));
      const y1 = Math.max(y0 + 1, tileOf(doorRect.bottom));
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
      ledges,
      sky,
      // Player.update reads these off the level it is given. A menu has no
      // seed, no length and no career: it is a place, not a run.
      meters: width,
      mode: "menu",
      seed: "menu",
      menu: true,
    };
  }

  // The whole page, measured and turned into collision in one go.
  function fromPage(root, viewW, viewH, options) {
    return build(viewW, viewH, boxesFrom(root), doorFrom(root), options);
  }

  // Whether the page is big enough for the secret at all. Asked before the
  // combo is allowed to do anything, so a window with no room for the gauntlet
  // simply has no secret rather than half of one.
  function skyRoom(root, viewW, viewH) {
    let cardsRight = EDGE;
    boxesFrom(root).forEach((box) => {
      cardsRight = Math.max(cardsRight, tileOf(box.rect.right));
    });
    return skyFits(Math.ceil(viewW / TILE), Math.ceil(viewH / TILE), cardsRight);
  }

  return { TILE, EDGE, CORRIDOR, STEPS, SKY, skyRoom, tileOf, boxesFrom, doorFrom, build, fromPage };
})();
