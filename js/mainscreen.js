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

  function build(viewW, viewH, boxes, doorRect) {
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
      // Player.update reads these off the level it is given. A menu has no
      // seed, no length and no career: it is a place, not a run.
      meters: width,
      mode: "menu",
      seed: "menu",
      menu: true,
    };
  }

  // The whole page, measured and turned into collision in one go.
  function fromPage(root, viewW, viewH) {
    return build(viewW, viewH, boxesFrom(root), doorFrom(root));
  }

  return { TILE, EDGE, CORRIDOR, STEPS, tileOf, boxesFrom, doorFrom, build, fromPage };
})();
