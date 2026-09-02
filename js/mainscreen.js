// mainscreen.js — the menu, read as a level you can stand on

const Mainscreen = (() => {
  // Everything a body is measured in is tiles — 1.6 of them tall, nine of them
  // a second at a run — so the tile is the character's size, and at twenty
  // pixels the menu runner stood a third the height of the one in the caves.
  //
  // Thirty is where the three things this number decides stop fighting. The
  // runner is forty-eight pixels, which reads as a character rather than a
  // token. A card edge snaps to within half a tile of where it is drawn, and
  // half of thirty is a margin you have to look for.
  //
  // And thirty is what the gauntlet costs. It wants more than twenty-nine rows
  // of window to exist at all, and a 1080p screen gives about 920 of them once
  // the taskbar and the browser's own furniture are gone — thirty rows at a
  // thirty pixel tile, and thirty-one at 940. Two pixels larger and the secret
  // is a thing that only appears in fullscreen, which is a strange rule for a
  // secret to have.
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

    // ---------------------------------------------------------------- columns
    //
    // Fixed, like every row above them, and they were not always. The gauntlet
    // used to be placed relative to the widest card on the page — measured in
    // pixels, converted to tiles, and pushed three columns clear of it — which
    // sounds careful and behaves badly. The panel is up to 820 pixels wide
    // wherever it is drawn, so on a narrow window the cards eat the same number
    // of tiles while there are far fewer of them to go round: the gauntlet was
    // shoved to a column past the right-hand wall, skyFits said no, and the
    // secret quietly did not exist under about 1700 pixels of window.
    //
    // The cards are not in the way in any case. This is a second world laid
    // over the menu, not a room squeezed in beside it, and while it is up the
    // runner is in it. So the columns are simply stated here with the rows.
    bridge: 6, // the bridge deck's left end
    gym: 10, // the chimney's left wall; the vault tower stands just left of it
    mouth: 2, // columns of bridge past the vault before the gym deck starts
    runUp: 8, // deck before the chasm — a slide needs a run at it
    chasm: 7, // a jump covers 5.2 tiles, an uncoil about 7.9
    // Two, which is what is left after the grid stopped rounding up: an
    // overshoot is not punished anyway, it drops onto the lower deck and
    // carries on.
    landing: 2,
    // Three, not two. Under a two-row roof a jump bonks after four tenths of a
    // tile and still carries about 1.9 across, which clears a two-wide hole;
    // three asks for 2.3, which only the skim's flat 2.7 will do.
    skimPit: 3,
    shaft: 2, // the chimney: its two faces, two columns apart
  };

  // Where everything lands, worked out once from the columns above. Nothing in
  // here depends on the window or on anything the page happens to be showing —
  // the gauntlet is the same shape on every screen that has room for it.
  //
  // The corner left of the bridge stays empty on purpose. Columns nought to
  // five are where the climb that summons this happens, and dropping a deck
  // into them would build the secret on top of the player asking for it.
  function skyPlan() {
    const g = SKY.gym;
    const u = g + SKY.mouth; // where the gym's upper deck begins
    const runEnd = u + SKY.runUp - 1;
    const farSide = runEnd + SKY.chasm + 1;
    const upperEnd = farSide + SKY.landing - 1;
    return { g, u, runEnd, farSide, upperEnd, last: upperEnd + 1 };
  }

  // The narrowest window the whole thing fits inside, derived rather than
  // guessed: the last column it uses, plus the wall, plus the column the wall
  // needs beside it.
  const MIN_WIDTH = skyPlan().last + EDGE + 1;

  // How deep the chimney can go in a window this tall.
  //
  // It used to be a flat twenty-five and the gate in front of it demanded four
  // rows of slack, which is where the old "taller than twenty-nine rows" came
  // from — and on any laptop that is no secret at all. The four rows were never
  // padding, though: the chimney's two walls stand on their own floor, and if
  // that floor is level with the menu's then the walls run down through the
  // corridor along the bottom of the screen and stand in it. That corridor
  // running the whole width of the window is the one promise this level makes.
  //
  // So the chimney is cut to fit instead of the secret being refused. It stops
  // one row above the line cards are already cut off at, which keeps the
  // corridor clear at any size, and it keeps its full depth wherever there is
  // room for it.
  function pitFloorFor(height) {
    return Math.min(SKY.pitFloor, height - EDGE - CORRIDOR - 1);
  }

  // What it may not be cut down past. A chimney is only a chimney while it is
  // taller than one wall can be climbed — Level.RULES.maxWallClimb is nine, so
  // ten rows is the least that still forces the alternating kicks the whole
  // obstacle exists to teach. Shorter than that it is a step, and a gauntlet
  // with one of its obstacles folded flat is worse than no gauntlet: better to
  // have no secret on a window this small than a hollow one.
  const MIN_CHIMNEY = 10;

  // Two questions about the grid and nothing else: is it wide enough to hold
  // the gauntlet, and deep enough for the chimney to still be a chimney.
  function skyFits(width, height) {
    return width >= MIN_WIDTH && pitFloorFor(height) - SKY.lower >= MIN_CHIMNEY;
  }

  function carveSky(put, get, width, height) {
    const T = Level.TILE;
    if (!skyFits(width, height)) return null;

    const plan = skyPlan();
    const g = plan.g;
    const u = plan.u;
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
    //
    // It starts at column six rather than at the wall, so the corner the player
    // just climbed to summon it is left the way they found it — the same six
    // columns the combo is watching. A deck laid through there would appear
    // inside the runner who asked for it.
    row(SKY.deck, SKY.bridge, u - 1);
    row(SKY.lid, SKY.bridge, u - 1);
    for (let x = SKY.bridge; x < u; x++) {
      clear(x, SKY.deck - 1);
      clear(x, SKY.deck - 2);
    }

    // The menu has a lid on it now, and the gym is the one place that takes it
    // back off. The chasm past the mouth is crossed by an uncoil, which leaves
    // a deck six rows down and rises nearly five tiles; under the lid it tops
    // out at row one instead, carries about five tiles rather than nearly eight,
    // and lands in the middle of a seven tile hole. The gauntlet is a hidden
    // room reached on purpose, so the escape the lid exists to stop is not a
    // risk here — and the jump does not work without the sky.
    for (let x = u; x < width - EDGE; x++) clear(x, SKY.lid);

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
    const runEnd = plan.runEnd;
    const upperEnd = plan.upperEnd;
    row(SKY.upper, u, runEnd);
    row(SKY.upper, plan.farSide, upperEnd);

    // ----------------------------------------------------------- the skim pit
    // Entered by walking off the right-hand end of the upper deck, and run back
    // the other way: right to left, under a roof too low to jump beneath, over
    // a hole too wide to walk across.
    //
    // The deck runs all the way to the right-hand wall, so this storey visibly
    // lands on the pillar there instead of stopping a column or two short of it
    // and leaving the upper floor hanging in the air beside a column that is
    // plainly not holding it up. The upper deck deliberately does not: walking
    // off its right-hand end is how you get down here, and a deck against the
    // wall has no end to walk off.
    const lowRight = width - EDGE - 1;
    const lowLeft = g + SKY.shaft + 2;
    // Where you land coming off the end of the upper deck. The roof stops four
    // columns short of it and always did — that gap is the way in. It is
    // measured from here rather than from the deck's right-hand end, because
    // the deck now runs on to the wall and a roof that followed it would close
    // over the very hole you drop through.
    const dropIn = upperEnd + 1;
    row(SKY.lower, lowLeft, lowRight);
    row(SKY.roof, lowLeft, dropIn - 4);
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
    const pit = pitFloorFor(height);
    column(left, SKY.lower, pit);
    column(rightWall, SKY.lower, pit);
    row(pit, left, rightWall);
    for (let y = SKY.lower; y < pit; y++) {
      for (let x = left + 1; x < rightWall; x++) clear(x, y);
    }

    return {
      tiles: laid,
      exit,
      // Where the runner is set down when the bridge appears: on the deck at
      // the left-hand end, in the headroom, facing the length of it.
      entry: { x: SKY.bridge + 1, y: SKY.deck - 1 },
      gym: u,
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
    tileFor, skyRoom, tileOf, boxesFrom, doorFrom, build, fromPage,
  };
})();
