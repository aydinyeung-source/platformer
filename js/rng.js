// rng.js — deterministic seeded randomness: same seed in, same world out

const Rng = (() => {
  // Ambiguous glyphs (0/O, 1/I/L) are left out so seeds survive being read aloud.
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  // Separators are dropped so a shared seed survives being retyped with spaces,
  // dashes or lowercase: "k7q2 m4xb" and "K7Q2-M4XB" are the same world.
  function normalize(text) {
    return String(text == null ? "" : text)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  // xmur3 finalizer: any string down to one well-mixed 32-bit integer.
  function hash(text) {
    let h = 1779033703 ^ text.length;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // mulberry32 — small, fast, and identical in every browser.
  function stream(seedInt) {
    let a = seedInt >>> 0;

    function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    return {
      next,
      float(min, max) {
        return min + next() * (max - min);
      },
      int(min, max) {
        return Math.floor(min + next() * (max - min + 1));
      },
      chance(p) {
        return next() < p;
      },
      pick(list) {
        return list[Math.floor(next() * list.length)];
      },
      weighted(entries) {
        let total = 0;
        for (const entry of entries) total += Math.max(0, entry.weight);
        let roll = next() * total;
        for (const entry of entries) {
          roll -= Math.max(0, entry.weight);
          if (roll < 0) return entry.value;
        }
        return entries[entries.length - 1].value;
      },
    };
  }

  // Every system draws from its own named stream. Adding a feature that consumes
  // randomness then cannot shift the numbers every other system already sees,
  // so old seeds keep generating the levels people remember.
  function forSeed(seedText, streamName) {
    return stream(hash(keyFor(seedText) + "/" + streamName));
  }

  // The daily is meant to be the same run for everyone, so it keys off the UTC
  // date — a local date would hand two people in different zones different
  // levels and quietly break any shared leaderboard built on it later.
  function dailyISO(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  function dailySeed(date = new Date()) {
    const rng = stream(hash("DAILY/" + dailyISO(date)));
    let out = "";
    for (let i = 0; i < 8; i++) {
      if (i === 4) out += "-";
      out += ALPHABET[Math.floor(rng.next() * ALPHABET.length)];
    }
    return out;
  }

  // Any text at all becomes a world. Symbols alone would normalize down to
  // nothing, so those fall back to the raw string rather than all collapsing
  // onto the same empty seed.
  function keyFor(text) {
    const cleaned = normalize(text);
    if (cleaned) return cleaned;
    const raw = String(text == null ? "" : text).trim();
    // Encoded, not kept literally: the generator keys off this again, so keyFor
    // has to survive being applied twice or symbol-only seeds all collapse into
    // one world when the punctuation is stripped a second time.
    return raw ? "S" + hash(raw).toString(36).toUpperCase() : "0";
  }

  // The number a seed actually turns into — shown in the menu so the mechanism
  // is visible instead of magic.
  function numberFor(text) {
    return hash(keyFor(text));
  }

  // Random seeds are digits only: easier to read out, type and dictate. Ten of
  // them, not eight — the generator can express 2^32 maps, and 10^8 would let
  // the button reach only a fortieth of them.
  const RANDOM_DIGITS = 10;

  // One number the button does not hand out. Something else in this game keys
  // off it, and a thing you are supposed to go looking for stops being one the
  // moment it can be dealt to you by accident. Ten digits cannot spell the seed
  // it belongs to — that one is shorter — but they can still land on its hash,
  // and a hash is all anything downstream compares, so the guard is on the
  // number rather than on the text.
  const RESERVED = 0x8de3fcd5;

  function randomSeed() {
    for (let tries = 0; tries < 8; tries++) {
      let out = "";
      for (let i = 0; i < RANDOM_DIGITS; i++) {
        if (i === RANDOM_DIGITS / 2) out += "-";
        out += Math.floor(Math.random() * 10);
      }
      if (numberFor(out) !== RESERVED) return out;
    }
    // Eight collisions in a row is not luck, it is a broken Math.random. Take
    // the deterministic way out rather than looping for ever.
    return "1" + "0".repeat(RANDOM_DIGITS - 1);
  }

  return { normalize, keyFor, numberFor, hash, stream, forSeed, randomSeed, dailySeed, dailyISO, ALPHABET };
})();
