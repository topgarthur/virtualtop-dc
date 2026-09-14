const STATS_KEY = 'vtop.demo.stats.v1';
const SLIPS_KEY = 'vtop.demo.slips.v1';
const WALLET_KEY = 'vtop.demo.wallet.v1';
const PENDING_KEY = 'vtop.demo.pending.v1';
const START_CASH = 1000;

function gradeEasy(key, homeGoals, awayGoals) {
  if (homeGoals == null || awayGoals == null || !key) return null;
  const hg = Number(homeGoals);
  const ag = Number(awayGoals);
  const total = hg + ag;
  const gg = hg > 0 && ag > 0;
  const home = hg > ag;
  const away = ag > hg;
  const draw = hg === ag;
  switch (key) {
    case 'home':
      return home;
    case 'draw':
      return draw;
    case 'away':
      return away;
    case 'ov15':
      return total >= 2;
    case 'un15':
      return total <= 1;
    case 'ov25':
      return total >= 3;
    case 'un25':
      return total <= 2;
    case 'gg':
      return gg;
    case 'ng':
      return !gg;
    case 'dc1x':
      return home || draw;
    case 'dcx2':
      return away || draw;
    case 'dc12':
      return home || away;
    default:
      return null;
  }
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // this browser/profile only
  }
}

export function emptyStats() {
  return { played: 0, won: 0, lost: 0, staked: 0, returned: 0 };
}

export function loadWallet() {
  const row = readJson(WALLET_KEY, null);
  if (!row || row.cash == null) return { cash: START_CASH };
  return { cash: Number(row.cash) };
}

function saveWallet(wallet) {
  writeJson(WALLET_KEY, wallet);
}

export function loadPending() {
  return readJson(PENDING_KEY, []);
}

export function savePending(picks) {
  writeJson(PENDING_KEY, picks);
}

export function loadStats() {
  return { ...emptyStats(), ...readJson(STATS_KEY, {}) };
}

export function loadSlips() {
  return readJson(SLIPS_KEY, []);
}

function saveSlips(slips) {
  writeJson(SLIPS_KEY, slips.slice(-80));
}

function saveStats(stats) {
  writeJson(STATS_KEY, stats);
}

export function combinedOdds(picks) {
  return picks.reduce((acc, row) => acc * (Number(row.odds) > 1 ? Number(row.odds) : 1), 1);
}

export function placeSlip({ picks, stake, cardKey, matchdayTime, week, seasonId }) {
  const amount = Number(stake);
  const wallet = loadWallet();
  if (!picks?.length) return { error: 'Add at least one selection.' };
  if (!Number.isFinite(amount) || amount < 1) return { error: 'Enter a stake in KSh.' };
  if (wallet.cash < amount) return { error: `Not enough demo cash (KSh ${wallet.cash.toFixed(0)}).` };
  const slips = loadSlips();
  const slip = {
    id: `demo-${Date.now()}`,
    cardKey,
    matchdayTime,
    week,
    seasonId,
    stake: amount,
    odds: Number(combinedOdds(picks).toFixed(2)),
    picks,
    status: 'open',
    placedAt: new Date().toISOString(),
    settledAt: null,
    payout: 0,
  };
  slips.push(slip);
  saveSlips(slips);
  saveWallet({ cash: Number((wallet.cash - amount).toFixed(2)) });
  savePending([]);
  return { slip, wallet: loadWallet() };
}

function scoreForPick(pick, results, fixtures) {
  const fid = String(pick.fixtureId);
  const live = (fixtures || []).find((row) => String(row.fixtureId) === fid);
  if (live && live.homeGoals != null && live.awayGoals != null && !live.live) {
    return { hg: live.homeGoals, ag: live.awayGoals, score: `${live.homeGoals}:${live.awayGoals}` };
  }
  const hit =
    (results || []).find((row) => String(row.fixtureId) === fid) ||
    (results || []).find(
      (row) =>
        String(row.homeTeam || '').toLowerCase() === String(pick.home || '').toLowerCase() &&
        String(row.awayTeam || '').toLowerCase() === String(pick.away || '').toLowerCase() &&
        (!pick.week || Number(row.week) === Number(pick.week))
    );
  if (hit && hit.homeGoals != null && hit.awayGoals != null) {
    return { hg: hit.homeGoals, ag: hit.awayGoals, score: `${hit.homeGoals}:${hit.awayGoals}` };
  }
  return null;
}

export function settleOpenSlips({ results, fixtures }) {
  const slips = loadSlips();
  const stats = loadStats();
  const wallet = loadWallet();
  let changed = false;
  const justSettled = [];
  for (const slip of slips) {
    if (slip.status !== 'open') continue;
    const graded = slip.picks.map((pick) => {
      const score = scoreForPick(pick, results, fixtures);
      if (!score) return { ...pick, ok: null };
      return { ...pick, ok: gradeEasy(pick.key, score.hg, score.ag), score: score.score };
    });
    if (graded.some((row) => row.ok == null)) continue;
    slip.picks = graded;
    const won = graded.every((row) => row.ok === true);
    slip.status = won ? 'won' : 'lost';
    slip.payout = won ? Number((slip.stake * slip.odds).toFixed(2)) : 0;
    slip.settledAt = new Date().toISOString();
    stats.played += 1;
    stats.staked += slip.stake;
    stats.returned += slip.payout;
    if (won) {
      stats.won += 1;
      wallet.cash = Number((wallet.cash + slip.payout).toFixed(2));
    } else stats.lost += 1;
    justSettled.push(slip);
    changed = true;
  }
  if (changed) {
    saveSlips(slips);
    saveStats(stats);
    saveWallet(wallet);
  }
  return { slips, stats, wallet, changed, justSettled };
}

export function beep(won) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = won ? 880 : 196;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (won ? 0.18 : 0.28));
  } catch {
    // audio is optional
  }
}
