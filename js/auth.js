// auth.js — username-only accounts on Supabase, over plain fetch

(() => {
  // Both values are public by design and safe to ship: the anon key is a client
  // credential. The service_role key must never appear in browser code.
  const SUPABASE_URL = "https://xqtxialikeuwbixbazcd.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxdHhpYWxpa2V1d2JpeGJhemNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMTc5ODMsImV4cCI6MjEwMzU5Mzk4M30.5BH-OkGvGsorQ16iDsDUzA5Wxko5LihbgIHK1kQiCLg";

  const DOMAIN = "platformer.local";
  const SESSION_KEY = "platformer.session";
  const DEVICE_KEY = "platformer.device";
  const HEARTBEAT_MS = 8000;
  const REFRESH_MARGIN = 10 * 60; // refresh once the token is this close to expiry
  const NAME_RULE = /^[a-zA-Z0-9_]{3,20}$/;

  // Supabase Auth is built around email addresses; this game is not. Every
  // username maps to an address that is never shown and never receives mail.
  // Lowercasing here is what makes usernames case-insensitive, and because
  // auth.users already enforces one row per address, uniqueness comes free.
  function addressFor(username) {
    return username.toLowerCase() + "@" + DOMAIN;
  }

  // --------------------------------------------------------------- transport

  async function readResponse(response) {
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = {};
    }
    if (!response.ok) {
      throw new Error(
        data.msg || data.error_description || data.message || "Request failed (" + response.status + ")"
      );
    }
    return data;
  }

  function post(path, body) {
    return fetch(SUPABASE_URL + "/auth/v1/" + path, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(readResponse);
  }

  const signUp = (username, password) =>
    post("signup", { email: addressFor(username), password, data: { username } });

  const logIn = (username, password) =>
    post("token?grant_type=password", { email: addressFor(username), password });

  const refresh = (refreshToken) =>
    post("token?grant_type=refresh_token", { refresh_token: refreshToken });

  const getUser = (accessToken) =>
    fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + accessToken },
    }).then(readResponse);

  // Supabase speaks in email terms. The player never should.
  function humanise(message) {
    const text = String(message || "");
    if (/invalid login credentials/i.test(text)) return "Wrong username or password.";
    if (/already registered|exists/i.test(text)) return "That username is taken.";
    if (/password/i.test(text) && /least|short/i.test(text)) {
      return "Password must be at least 6 characters.";
    }
    return text;
  }

  // ----------------------------------------------------------------- session

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function saveSession(session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) {
      /* private mode — the session just will not survive a reload */
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  // Supabase returns a lifetime, not a deadline. Store the deadline so a later
  // page load can tell how much of the hour is left.
  function stamp(session) {
    if (session && !session.expires_at && session.expires_in) {
      session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in;
    }
    return session;
  }

  // Every authenticated request in the game goes through this. Read the session
  // fresh each time so a refreshed token is picked up without anyone being told.
  function authed(path, options = {}) {
    const session = loadSession();
    if (!session || !session.access_token) return Promise.reject(new Error("Not logged in"));
    return fetch(SUPABASE_URL + path, {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + session.access_token,
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }).then(readResponse);
  }

  const claimSession = (id) =>
    authed("/rest/v1/rpc/claim_session", { method: "POST", body: { new_session: id } });

  const heartbeat = () => authed("/rest/v1/rpc/heartbeat", { method: "POST", body: {} });

  // ------------------------------------------------------------ one device

  function newDeviceId() {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
          });
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch (e) {}
    return id;
  }

  function myDeviceId() {
    try {
      return localStorage.getItem(DEVICE_KEY);
    } catch (e) {
      return null;
    }
  }

  // An access token lasts an hour; a good run of this game can outlast one, and
  // then every authenticated call starts failing at once. Renew it early.
  async function maybeRefresh() {
    const session = loadSession();
    if (!session || !session.expires_at || !session.refresh_token) return;
    if (session.expires_at - Math.floor(Date.now() / 1000) > REFRESH_MARGIN) return;

    const next = stamp(await refresh(session.refresh_token));
    saveSession(next);
    // Anything using authed() re-reads storage and never notices. Anything
    // holding its own copy of the token does, so announce it.
    window.dispatchEvent(new CustomEvent("platformer:token", { detail: { session: next } }));
  }

  let beat = null;

  function stopBeat() {
    if (beat !== null) window.clearInterval(beat);
    beat = null;
  }

  async function tick() {
    try {
      await maybeRefresh();
      const result = await heartbeat();
      const claimed = result && (result.session || (Array.isArray(result) && result[0] && result[0].session));
      const mine = myDeviceId();
      if (claimed && mine && claimed !== mine) kicked();
    } catch (e) {
      // A dropped request is not proof of anything. Only a session that comes
      // back belonging to someone else signs this tab out.
    }
  }

  function startBeat() {
    stopBeat();
    beat = window.setInterval(tick, HEARTBEAT_MS);
  }

  // --------------------------------------------------------------- the gate

  const authSection = document.getElementById("auth");
  const appSection = document.querySelector(".app");
  const form = document.getElementById("auth-form");
  const usernameInput = document.getElementById("auth-username");
  const passwordInput = document.getElementById("auth-password");
  const confirmInput = document.getElementById("auth-confirm");
  const confirmField = document.getElementById("auth-confirm-field");
  const loginButton = document.getElementById("auth-login");
  const signupButton = document.getElementById("auth-signup");
  const guestButton = document.getElementById("auth-guest");
  const messageLine = document.getElementById("auth-message");
  const modeLine = document.querySelector(".auth__mode");
  const playerSlot = document.querySelector("[data-player]");

  function setMessage(text, isError) {
    messageLine.textContent = text || "";
    messageLine.classList.toggle("is-error", Boolean(isError));
  }

  function displayName(user) {
    const meta = user && user.user_metadata;
    if (meta && meta.username) return meta.username;
    const email = (user && user.email) || "";
    return email.split("@")[0] || "Player";
  }

  // Which portal this is embedded on, if it is embedded on one.
  //
  // A page in an iframe can tell two things about where it is: the address it
  // was served from, and the page that framed it. Both are guesses — a referrer
  // can be stripped and the CDN domains are not promises — so this only ever
  // adds a name to a sentence that is true without one.
  //
  // Worth the trouble because the sentence is about somebody else's password.
  // A game asking for one inside a portal looks exactly like a game fishing for
  // the portal's own, and saying "not your Newgrounds account" to a player on
  // Newgrounds answers that where "not your account elsewhere" does not.
  function hostSite() {
    const where = (document.referrer || "") + " " + location.hostname;
    if (/newgrounds\.com|ungrounded\.net|ngfiles\.com/i.test(where)) return "Newgrounds";
    if (/itch\.io|itch\.zone|hwcdn\.net/i.test(where)) return "itch.io";
    return null;
  }

  function sayWhoseAccount() {
    const line = document.getElementById("auth-host");
    if (!line) return;
    const site = hostSite();
    line.textContent = site
      ? "This login connects to an external database for cross-platform saves and is" +
        " entirely independent of your " + site + " account."
      : "This login connects to an external database for cross-platform saves. It is" +
        " not connected to any other account you have.";
  }

  // Playing without an account. Remembered, because a guest who has to walk
  // past the login card on every single load has not been let past it — they
  // have been asked the same question again, which is the thing they declined.
  const GUEST_KEY = "platformer.guest";

  function isGuest() {
    try {
      return localStorage.getItem(GUEST_KEY) === "1";
    } catch (err) {
      return false; // storage blocked: the card comes back, which is no worse
    }
  }

  function setGuest(on) {
    try {
      if (on) localStorage.setItem(GUEST_KEY, "1");
      else localStorage.removeItem(GUEST_KEY);
    } catch (err) {}
  }

  function unlock(user, as) {
    const name = as || displayName(user);
    if (playerSlot) playerSlot.textContent = name;
    authSection.hidden = true;
    appSection.hidden = false;
    window.dispatchEvent(new CustomEvent("platformer:unlocked", { detail: { username: name } }));
  }

  // No session, no heartbeat, no request of any kind. Everything the game does
  // on its own — carving, running, ghosts, the tutorial, the career total — is
  // local already and carries on working; the only thing missing is the half
  // that was always the cloud's.
  function playGuest() {
    stopBeat();
    clearSession();
    setGuest(true);
    setMessage("");
    unlock(null, "Guest");
  }

  function lock() {
    appSection.hidden = true;
    authSection.hidden = false;
    window.dispatchEvent(new CustomEvent("platformer:locked"));
  }

  // Two ways to end up back at the login card, and they are not the same event.
  //
  // Leaving is something you did: it wants no colour on the message and no
  // explanation, because you know what you just pressed. Being kicked is
  // something that happened to you while you were reading the screen, and it
  // needs to say why or it reads as the game having lost your account.
  //
  // They were one function until the gear menu existed, which meant logging out
  // on purpose told you your account had been used on another device — an
  // alarming thing to be told about a thing you did yourself.
  function signOut(text, isError) {
    stopBeat();
    clearSession();
    setGuest(false);
    resetForm();
    lock();
    setMessage(text, isError);
  }

  function logOut() {
    signOut("Logged out.", false);
  }

  function kicked() {
    signOut("Signed out — this account was used on another device.", true);
  }

  // ------------------------------------------------------------------ form

  // The markup marks "Log in" as primary, so that is the mode the panel opens
  // in. Sign-up has to be selected first — which is also when the confirm field
  // has to appear, so there is nowhere else that step could live.
  let mode = "login";

  function selectMode(next) {
    mode = next;
    const signing = next === "signup";
    confirmField.hidden = !signing;
    loginButton.classList.toggle("is-primary", !signing);
    signupButton.classList.toggle("is-primary", signing);
    passwordInput.setAttribute("autocomplete", signing ? "new-password" : "current-password");
    modeLine.textContent = signing ? "Create an account" : "Log in or sign up";
    setMessage("");
  }

  function resetForm() {
    form.reset();
    selectMode("login");
  }

  function busy(state) {
    loginButton.disabled = state;
    signupButton.disabled = state;
  }

  async function submit() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!NAME_RULE.test(username)) {
      return setMessage("Usernames are 3-20 letters, numbers or underscores.", true);
    }
    if (!password) return setMessage("Enter a password.", true);
    if (mode === "signup" && password !== confirmInput.value) {
      return setMessage("Passwords do not match.", true);
    }

    busy(true);
    setMessage(mode === "signup" ? "Creating account..." : "Logging in...");

    try {
      const session = stamp(
        mode === "signup" ? await signUp(username, password) : await logIn(username, password)
      );

      // A signup that returns a user but no token means email confirmation is
      // still switched on, and there is no inbox behind these addresses.
      if (!session.access_token) {
        throw new Error(
          "Account created, but this project still has email confirmation switched on — turn it off in Authentication settings, then log in."
        );
      }

      saveSession(session);
      setGuest(false);
      await claimSession(newDeviceId());
      const user = session.user || (await getUser(session.access_token));
      startBeat();
      unlock(user);
      setMessage("");
    } catch (error) {
      setMessage(humanise(error.message), true);
    } finally {
      busy(false);
    }
  }

  loginButton.addEventListener("click", () => {
    if (mode !== "login") return selectMode("login");
    submit();
  });

  signupButton.addEventListener("click", () => {
    if (mode !== "signup") return selectMode("signup");
    submit();
  });

  if (guestButton) guestButton.addEventListener("click", playGuest);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });

  // ---------------------------------------------------------------- restore

  // A request that never arrived is not the server saying no. fetch rejects
  // with a TypeError when it cannot reach anything at all, where a refusal
  // comes back as a response and is thrown out of readResponse — so the two are
  // told apart by which of them threw, rather than by reading the message.
  function unreachable(error) {
    return error instanceof TypeError || navigator.onLine === false;
  }

  async function restore() {
    const session = loadSession();
    if (!session || !session.access_token) {
      // A guest who chose this last time is not asked again.
      if (isGuest()) return unlock(null, "Guest");
      return lock();
    }

    try {
      unlock(await getUser(session.access_token));
    } catch (first) {
      try {
        // No point asking twice when the first ask never left the building.
        if (unreachable(first)) throw first;
        const next = stamp(await refresh(session.refresh_token));
        saveSession(next);
        unlock(next.user || (await getUser(next.access_token)));
      } catch (second) {
        if (!unreachable(second)) {
          clearSession();
          return lock();
        }

        // Offline. The session already on this device is the only evidence
        // there is, so it is taken: the game is entirely local once it has
        // loaded, and an installed app that shows a login screen whenever the
        // wifi is down is not an offline game. It is not the last word either
        // — the heartbeat below is still running, and the first tick that
        // reaches the server signs this tab out if the account has moved on.
        // Everything the cloud is actually for keeps failing meanwhile, which
        // the code that calls it already expects.
        unlock(session.user || null);
      }
    }

    startBeat();
    tick(); // catches a tab that was claimed elsewhere while it was closed
  }

  sayWhoseAccount();
  window.Auth = { authed, loadSession, logOut, isGuest };
  restore();
})();
