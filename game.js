(() => {
"use strict";

// ---- Dictionary ----------------------------------------------------------
const WORD_SET = new Set(window.WORD_LIST);
const wordsByLetter = {};
for (const w of window.WORD_LIST) {
  const l = w[0];
  (wordsByLetter[l] || (wordsByLetter[l] = [])).push(w);
}
const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");
const COMMON_STARTS = "a b c d f g h m p r s t".split(" ");

const BONUS3 = new Set(["j", "q", "x", "z"]);
const BONUS1 = new Set(["k", "v"]);

function wordHeight(w) {
  let h = w.length;
  for (const ch of w) {
    if (BONUS3.has(ch)) h += 3;
    else if (BONUS1.has(ch)) h += 1;
  }
  return h;
}

// ---- Tunables -------------------------------------------------------------
const BASE_RISE_RATE = 0.16;   // m/s the lava gains on its own
const RISE_SCALE = 0.0006;     // slight speed-up as you climb
const MISTAKE_SURGE = 1;
const SKIP_SURGE = 3;
const FREEZE_MS = 3000;
const DANGER_GAP = 4;
const GAP_DISPLAY_MAX = 15;
const START_GAP = 10;
const MAX_HINTS = 3;

// ---- Elements ---------------------------------------------------------------
const el = {
  hud: document.querySelector(".hud"),
  heightVal: document.getElementById("heightVal"),
  gapVal: document.getElementById("gapVal"),
  gapFill: document.getElementById("gapFill"),
  bestVal: document.getElementById("bestVal"),
  chainLog: document.getElementById("chainLog"),
  stage: document.getElementById("stage"),
  toast: document.getElementById("toast"),
  bar: document.getElementById("bar"),
  nextLetter: document.getElementById("nextLetter"),
  nextCount: document.getElementById("nextCount"),
  word: document.getElementById("word"),
  hintBtn: document.getElementById("hintBtn"),
  skipBtn: document.getElementById("skipBtn"),
  crust: document.getElementById("crust"),
  pips: Array.from(document.querySelectorAll("#pips i")),
  overlay: document.getElementById("overlay"),
  menuPanel: document.querySelector('[data-panel="menu"]'),
  overPanel: document.querySelector('[data-panel="over"]'),
  startBtn: document.getElementById("startBtn"),
  againBtn: document.getElementById("againBtn"),
  newBest: document.getElementById("newBest"),
  overSub: document.getElementById("overSub"),
  sHeight: document.getElementById("sHeight"),
  sWords: document.getElementById("sWords"),
  sLongest: document.getElementById("sLongest"),
  sStreak: document.getElementById("sStreak"),
  chainBox: document.getElementById("chainBox"),
};

// ---- State ------------------------------------------------------------------
let state = null;
let rafId = null;
let toastTimer = null;

function freshState() {
  const letter = COMMON_STARTS[Math.floor(Math.random() * COMMON_STARTS.length)];
  return {
    height: 0,
    gap: START_GAP,
    usedWords: new Set(),
    usedCountByLetter: {},
    chain: [],
    currentLetter: letter,
    runStreak: 0,
    comboCounter: 0,
    bestStreak: 0,
    hints: MAX_HINTS,
    longestWord: "",
    frozenUntil: 0,
    lastTick: performance.now(),
    over: false,
  };
}

function remainingCount(letter, s) {
  const total = (wordsByLetter[letter] || []).length;
  return total - (s.usedCountByLetter[letter] || 0);
}

function loadBest() {
  const v = Number(localStorage.getItem("wordlava_best") || 0);
  return Number.isFinite(v) ? v : 0;
}
function saveBest(v) {
  localStorage.setItem("wordlava_best", String(v));
}

// ---- Rendering ----------------------------------------------------------
function renderHud() {
  el.heightVal.textContent = `${Math.round(state.height)} m`;
  el.gapVal.textContent = `${Math.max(0, state.gap).toFixed(1)} m below`;
  el.bestVal.textContent = `${loadBest()} m`;

  const pct = Math.max(0, Math.min(1, state.gap / GAP_DISPLAY_MAX)) * 100;
  el.gapFill.style.width = `${pct}%`;

  const frozen = performance.now() < state.frozenUntil;
  el.hud.classList.toggle("frozen", frozen);
  el.hud.classList.toggle("danger", !frozen && state.gap <= DANGER_GAP);
  el.crust.classList.toggle("frozen", frozen);
}

function renderNextLetter() {
  el.nextLetter.textContent = state.currentLetter.toUpperCase();
  el.nextCount.textContent = formatCount(remainingCount(state.currentLetter, state));
  el.word.placeholder = `${state.currentLetter.toUpperCase()}…`;
}

function formatCount(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function renderPips() {
  el.pips.forEach((pip, i) => pip.classList.toggle("on", i < state.comboCounter));
}

function renderHintBtn() {
  el.hintBtn.textContent = `Hint · ${state.hints}`;
  el.hintBtn.disabled = state.hints <= 0;
}

function appendChainWord(w) {
  const span = document.createElement("span");
  const first = w[0], last = w[w.length - 1], mid = w.slice(1, -1);
  span.innerHTML = `<em>${first}</em>${mid}<em>${last}</em>`;
  el.chainLog.appendChild(span);
  el.stage.scrollTop = el.stage.scrollHeight;
}

function toast(text, cls) {
  clearTimeout(toastTimer);
  el.toast.textContent = text;
  el.toast.className = `toast show ${cls || ""}`;
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 1400);
}

function shakeInput() {
  el.word.classList.add("wrong", "shake");
  setTimeout(() => el.word.classList.remove("shake"), 320);
}

// ---- Game loop ------------------------------------------------------------
function tick(now) {
  if (!state || state.over) return;
  const dt = Math.min(0.25, (now - state.lastTick) / 1000);
  state.lastTick = now;

  const frozen = now < state.frozenUntil;
  if (!frozen) {
    const rate = BASE_RISE_RATE + state.height * RISE_SCALE;
    state.gap -= rate * dt;
  }

  renderHud();

  if (state.gap <= 0) {
    endGame();
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function startLoop() {
  state.lastTick = performance.now();
  rafId = requestAnimationFrame(tick);
}
function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

// ---- Core actions ---------------------------------------------------------
function validate(raw) {
  const w = raw.trim().toLowerCase();
  if (!w) return { ok: false, reason: "type something" };
  if (!/^[a-z]+$/.test(w)) return { ok: false, reason: "letters only" };
  if (w.length < 2) return { ok: false, reason: "too short" };
  if (w[0] !== state.currentLetter) return { ok: false, reason: `must start with ${state.currentLetter.toUpperCase()}` };
  if (state.usedWords.has(w)) return { ok: false, reason: "already used" };
  if (!WORD_SET.has(w)) return { ok: false, reason: "not a word" };
  return { ok: true, word: w };
}

function submitWord() {
  if (!state || state.over) return;
  const raw = el.word.value;
  const result = validate(raw);

  if (!result.ok) {
    state.gap -= MISTAKE_SURGE;
    state.runStreak = 0;
    state.comboCounter = 0;
    renderPips();
    toast(result.reason, "bad");
    shakeInput();
    renderHud();
    if (state.gap <= 0) endGame();
    return;
  }

  const w = result.word;
  const gained = wordHeight(w);

  state.usedWords.add(w);
  state.usedCountByLetter[w[0]] = (state.usedCountByLetter[w[0]] || 0) + 1;
  state.height += gained;
  state.gap += gained;
  state.chain.push(w);
  if (w.length > state.longestWord.length) state.longestWord = w;

  state.runStreak += 1;
  state.comboCounter += 1;
  state.bestStreak = Math.max(state.bestStreak, state.runStreak);

  state.currentLetter = w[w.length - 1];

  let froze = false;
  if (state.comboCounter >= 5) {
    state.comboCounter = 0;
    state.frozenUntil = performance.now() + FREEZE_MS;
    froze = true;
  }

  el.word.value = "";
  el.word.classList.remove("wrong");
  appendChainWord(w);
  renderNextLetter();
  renderPips();
  renderHud();
  toast(froze ? `${w.toUpperCase()} · +${gained} m · crust!` : `${w.toUpperCase()} · +${gained} m`, froze ? "cool" : "good");
}

function useHint() {
  if (!state || state.over || state.hints <= 0) return;
  const pool = (wordsByLetter[state.currentLetter] || []).filter(w => !state.usedWords.has(w));
  if (pool.length === 0) {
    toast("no words left for this letter — try Skip", "bad");
    return;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  state.hints -= 1;
  renderHintBtn();
  el.word.value = pick;
  el.word.focus();
  toast(`try: ${pick.toUpperCase()}`, "cool");
}

function skipLetter() {
  if (!state || state.over) return;
  const candidates = ALPHABET.filter(l => l !== state.currentLetter && remainingCount(l, state) > 0);
  if (candidates.length === 0) return;
  const next = candidates[Math.floor(Math.random() * candidates.length)];
  state.currentLetter = next;
  state.gap -= SKIP_SURGE;
  el.word.value = "";
  el.word.classList.remove("wrong");
  renderNextLetter();
  renderHud();
  toast(`skipped to ${next.toUpperCase()} · lava surged`, "bad");
  if (state.gap <= 0) endGame();
}

// ---- Screens --------------------------------------------------------------
function showPanel(panel) {
  el.overlay.hidden = false;
  el.menuPanel.hidden = panel !== "menu";
  el.overPanel.hidden = panel !== "over";
}
function hideOverlay() {
  el.overlay.hidden = true;
}

function startGame() {
  state = freshState();
  el.chainLog.innerHTML = "";
  el.word.value = "";
  el.word.classList.remove("wrong");
  hideOverlay();
  renderNextLetter();
  renderPips();
  renderHintBtn();
  renderHud();
  startLoop();
  el.word.focus();
}

function endGame() {
  state.over = true;
  stopLoop();

  const height = Math.round(state.height);
  const best = loadBest();
  const isNewBest = height > best;
  if (isNewBest) saveBest(height);

  el.newBest.hidden = !isNewBest;
  el.overSub.textContent = `You climbed ${height} m.`;
  el.sHeight.textContent = `${height} m`;
  el.sWords.textContent = String(state.chain.length);
  el.sLongest.textContent = state.longestWord ? state.longestWord.toUpperCase() : "–";
  el.sStreak.textContent = String(state.bestStreak);
  el.chainBox.textContent = state.chain.length ? state.chain.join(" → ") : "–";

  showPanel("over");
}

// ---- Wiring -----------------------------------------------------------------
el.bar.addEventListener("submit", (e) => {
  e.preventDefault();
  submitWord();
});
el.word.addEventListener("input", () => el.word.classList.remove("wrong"));
el.hintBtn.addEventListener("click", useHint);
el.skipBtn.addEventListener("click", skipLetter);
el.startBtn.addEventListener("click", startGame);
el.againBtn.addEventListener("click", startGame);

showPanel("menu");
})();
