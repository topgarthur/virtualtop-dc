const fs = require('fs');
const path = require('path');
const { getBuffer } = require('./buffers');
const { findTeam, normalizeName, clamp } = require('./catalog');
const { poissonPmf } = require('./poisson');

const { dataFile } = require('./dataDir');

const FILE = dataFile('rng-intel.json');

const DEFAULT = {
  n: 0,
  generator: {
    lambda: 1.32,
    lambdaH: 1.4,
    lambdaA: 1.24,
    homeAdv: 1.06,
    rho: 0.13,
    drawRate: 0.27,
    homeWin: 0.38,
    awayWin: 0.35,
    zip00: 0,
    nbPhi: 0,
    cap: 8,
    inflate10: 1,
    inflate21: 1,
  },
  independence: { serial: 0.5, serialGd: 0, form: 0.5, n: 0, leaky: false, shuffle: 0.5 },
  overdisp: { ratio: 1, n: 0, ggCard: 1 },
  markets: {},
  sureExtra: { n: 0, hits: 0, rate: 0, minP: 0.52, brier: 0.25, logloss: 0.7 },
  oddsWeight: 0.62,
  modelWeight: 0.38,
  prefer: ['ov15', 'dc1x', 'dcx2', 'gg', 'dc12'],
  skip1x2: false,
  skipDraw: false,
  skipNg: false,
  skipOv25: false,
  holdout: { alwaysOv15: 0, modelExtra: 0, random3: 0, n: 0, edge: false },
  seasonId: null,
  updatedAt: null,
};

let state = load();

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      ...JSON.parse(JSON.stringify(DEFAULT)),
      ...parsed,
      generator: { ...DEFAULT.generator, ...(parsed.generator || {}) },
      independence: { ...DEFAULT.independence, ...(parsed.independence || {}) },
      overdisp: { ...DEFAULT.overdisp, ...(parsed.overdisp || {}) },
      sureExtra: { ...DEFAULT.sureExtra, ...(parsed.sureExtra || {}) },
      holdout: { ...DEFAULT.holdout, ...(parsed.holdout || {}) },
      markets: parsed.markets || {},
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT));
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch {
    // best-effort
  }
}

function teamKey(id, name) {
  const team = findTeam(id || name);
  return normalizeName(team?.name || name || id);
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
}

function poissonScore(i, j, lh, la) {
  return poissonPmf(i, lh) * poissonPmf(j, la);
}

function rebuildFromHistory() {
  const history = getBuffer() || [];
  const scored = history.filter((m) => m.homeGoals != null && m.awayGoals != null);
  state.n = scored.length;
  if (scored.length < 12) {
    persist();
    return getIntel();
  }

  const n = scored.length;
  const cut = Math.max(8, Math.floor(n * 0.8));
  const train = scored.slice(0, cut);
  const test = scored.slice(cut);
  fitGenerator(train.length >= 12 ? train : scored);
  fitIndependence(scored);
  fitCards(scored);
  fitHoldout(test.length >= 8 ? test : scored.slice(-Math.min(20, n)));
  tuneBlend();
  state.seasonId = scored[scored.length - 1]?.seasonId || state.seasonId;
  state.updatedAt = new Date().toISOString();
  persist();
  return getIntel();
}

function fitGenerator(scored) {
  const n = scored.length;
  let hg = 0;
  let ag = 0;
  let draws = 0;
  let homes = 0;
  let zeros = 0;
  let s10 = 0;
  let s01 = 0;
  let s21 = 0;
  let s12 = 0;
  let maxG = 0;
  const totals = [];
  for (const m of scored) {
    hg += m.homeGoals;
    ag += m.awayGoals;
    totals.push(m.homeGoals + m.awayGoals);
    maxG = Math.max(maxG, m.homeGoals, m.awayGoals);
    if (m.homeGoals === m.awayGoals) draws += 1;
    if (m.homeGoals > m.awayGoals) homes += 1;
    if (m.homeGoals === 0 && m.awayGoals === 0) zeros += 1;
    if (m.homeGoals === 1 && m.awayGoals === 0) s10 += 1;
    if (m.homeGoals === 0 && m.awayGoals === 1) s01 += 1;
    if (m.homeGoals === 2 && m.awayGoals === 1) s21 += 1;
    if (m.homeGoals === 1 && m.awayGoals === 2) s12 += 1;
  }
  const lambdaH = hg / n;
  const lambdaA = ag / n;
  const p00ind = poissonScore(0, 0, lambdaH, lambdaA);
  const p00 = zeros / n;
  const rho = clamp(1 - p00 / Math.max(0.015, p00ind), 0.04, 0.32);
  const zip00 = clamp(p00 - p00ind, 0, 0.12);
  const meanT = mean(totals);
  const varT = variance(totals);
  const nbPhi = varT > meanT + 0.05 ? Number((meanT * meanT / (varT - meanT)).toFixed(3)) : 0;
  const e10 = poissonScore(1, 0, lambdaH, lambdaA);
  const e01 = poissonScore(0, 1, lambdaH, lambdaA);
  const e21 = poissonScore(2, 1, lambdaH, lambdaA);
  const e12 = poissonScore(1, 2, lambdaH, lambdaA);
  state.generator = {
    lambda: Number(((lambdaH + lambdaA) / 2).toFixed(4)),
    lambdaH: Number(lambdaH.toFixed(4)),
    lambdaA: Number(lambdaA.toFixed(4)),
    homeAdv: Number((lambdaH / Math.max(0.35, lambdaA)).toFixed(4)),
    rho: Number(rho.toFixed(4)),
    drawRate: Number((draws / n).toFixed(4)),
    homeWin: Number((homes / n).toFixed(4)),
    awayWin: Number(((n - homes - draws) / n).toFixed(4)),
    zip00: Number(zip00.toFixed(4)),
    nbPhi,
    cap: maxG >= 6 && scored.filter((m) => m.homeGoals >= 6 || m.awayGoals >= 6).length / n < 0.01 ? 6 : 8,
    inflate10: e10 ? Number(((s10 / n) / e10).toFixed(3)) : 1,
    inflate21: e21 ? Number(((s21 / n) / e21).toFixed(3)) : 1,
    emp10: Number((s10 / n).toFixed(4)),
    emp01: Number((s01 / n).toFixed(4)),
    emp21: Number((s21 / n).toFixed(4)),
    emp12: Number((s12 / n).toFixed(4)),
    n,
  };
  state.skipDraw = draws / n < 0.2;
  state.skipNg = scored.filter((m) => m.homeGoals > 0 && m.awayGoals > 0).length / n > 0.58;
  state.skipOv25 = Math.abs(lambdaH + lambdaA - 2.45) < 0.18;
}

function fitIndependence(scored) {
  const byTeam = new Map();
  const gdByTeam = new Map();
  for (const m of scored) {
    const hk = teamKey(m.homeId, m.homeTeam);
    const ak = teamKey(m.awayId, m.awayTeam);
    if (!byTeam.has(hk)) byTeam.set(hk, []);
    if (!byTeam.has(ak)) byTeam.set(ak, []);
    if (!gdByTeam.has(hk)) gdByTeam.set(hk, []);
    if (!gdByTeam.has(ak)) gdByTeam.set(ak, []);
    byTeam.get(hk).push(m.homeGoals > m.awayGoals ? 1 : 0);
    byTeam.get(ak).push(m.awayGoals > m.homeGoals ? 1 : 0);
    gdByTeam.get(hk).push(m.homeGoals - m.awayGoals);
    gdByTeam.get(ak).push(m.awayGoals - m.homeGoals);
  }
  let serialHits = 0;
  let serialN = 0;
  let formHits = 0;
  let formN = 0;
  let gdProd = 0;
  let gdN = 0;
  const allWins = [];
  for (const seq of byTeam.values()) {
    allWins.push(...seq);
    for (let i = 1; i < seq.length; i += 1) {
      serialN += 1;
      if (seq[i] === seq[i - 1]) serialHits += 1;
    }
    if (seq.length >= 6) {
      const last5 = seq.slice(-6, -1);
      const hot = mean(last5) > 0.55;
      formN += 1;
      if ((seq[seq.length - 1] === 1) === hot) formHits += 1;
    }
  }
  for (const seq of gdByTeam.values()) {
    for (let i = 1; i < seq.length; i += 1) {
      gdProd += seq[i] * seq[i - 1];
      gdN += 1;
    }
  }
  const serial = serialN ? serialHits / serialN : 0.5;
  let shHits = 0;
  let shN = 0;
  const shuffled = [...allWins];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (let i = 1; i < shuffled.length; i += 1) {
    shN += 1;
    if (shuffled[i] === shuffled[i - 1]) shHits += 1;
  }
  const shuffle = shN ? shHits / shN : 0.5;
  const leaky = serialN >= 40 && Math.abs(serial - 0.5) > 0.07 && Math.abs(serial - shuffle) > 0.04;
  state.independence = {
    serial: Number(serial.toFixed(4)),
    serialGd: gdN ? Number((gdProd / gdN).toFixed(4)) : 0,
    form: formN ? Number((formHits / formN).toFixed(4)) : 0.5,
    n: serialN,
    leaky,
    shuffle: Number(shuffle.toFixed(4)),
  };
}

function fitCards(scored) {
  const cards = new Map();
  for (const m of scored) {
    const key = `${m.seasonId || ''}:${m.week || ''}`;
    if (!cards.has(key)) cards.set(key, []);
    cards.get(key).push(m);
  }
  const packs = [...cards.values()].filter((row) => row.length >= 8);
  const sums = packs.map((row) => row.reduce((a, m) => a + m.homeGoals + m.awayGoals, 0));
  const ggCounts = packs.map((row) => row.filter((m) => m.homeGoals > 0 && m.awayGoals > 0).length);
  const g = state.generator;
  let ratio = 1;
  if (sums.length >= 4) {
    const oneVar = variance(scored.map((m) => m.homeGoals + m.awayGoals));
    const expect = 10 * Math.max(0.2, oneVar);
    ratio = expect ? variance(sums) / expect : 1;
  }
  let ggCard = 1;
  if (ggCounts.length >= 4) {
    const p = scored.filter((m) => m.homeGoals > 0 && m.awayGoals > 0).length / scored.length;
    const expect = 10 * p * (1 - p);
    ggCard = expect ? variance(ggCounts) / expect : 1;
  }
  state.overdisp = { ratio: Number(ratio.toFixed(3)), n: packs.length, ggCard: Number(ggCard.toFixed(3)) };
}

function fitHoldout(test) {
  if (!test.length) return;
  let ov15 = 0;
  let gg = 0;
  for (const m of test) {
    if (m.homeGoals + m.awayGoals >= 2) ov15 += 1;
    if (m.homeGoals > 0 && m.awayGoals > 0) gg += 1;
  }
  const alwaysOv15 = ov15 / test.length;
  const alwaysGg = gg / test.length;
  const extra = state.sureExtra.n ? state.sureExtra.rate : alwaysOv15;
  const random3 = 0.5;
  state.holdout = {
    alwaysOv15: Number(alwaysOv15.toFixed(4)),
    alwaysGg: Number(alwaysGg.toFixed(4)),
    modelExtra: Number(extra.toFixed(4)),
    random3,
    n: test.length,
    edge: state.sureExtra.n >= 20 && extra > alwaysOv15 + 0.03,
  };
  if (alwaysOv15 >= 0.62) {
    const pref = new Set(state.prefer || []);
    pref.add('ov15');
    state.prefer = ['ov15', ...[...pref].filter((k) => k !== 'ov15')].slice(0, 5);
  }
}

function tuneBlend() {
  const leaky = state.independence.leaky;
  let ow = leaky ? 0.38 : 0.72;
  if (!leaky) ow = 0.88;
  if (state.overdisp.ratio > 1.35) ow = clamp(ow + 0.04, 0.3, 0.9);
  if (state.holdout.edge) ow = clamp(ow - 0.12, 0.3, 0.9);
  state.oddsWeight = Number(ow.toFixed(3));
  state.modelWeight = Number((1 - ow).toFixed(3));
  state.skip1x2 = !state.holdout.edge && state.sureExtra.n >= 16 && state.sureExtra.rate > (state.holdout.alwaysOv15 || 0.55);
}

function noteMarket(key, ok, sure, p, odds) {
  if (!key) return;
  if (!state.markets[key]) state.markets[key] = { n: 0, hits: 0, rate: 0, kill: false, ev: 0, brier: 0 };
  const row = state.markets[key];
  row.n += 1;
  if (ok) row.hits += 1;
  row.rate = row.n ? row.hits / row.n : 0;
  const o = Number(odds);
  if (o > 1) row.ev = ((row.ev * (row.n - 1)) + (ok ? o - 1 : -1)) / row.n;
  if (p != null) row.brier = ((row.brier * (row.n - 1)) + (p - (ok ? 1 : 0)) ** 2) / row.n;
  const floor = key.startsWith('dc') ? 0.58 : 0.5;
  row.kill = row.n >= 16 && (row.rate < floor - 0.04 || (row.n >= 24 && row.ev < -0.04));
  if (sure) {
    state.sureExtra.n += 1;
    if (ok) state.sureExtra.hits += 1;
    state.sureExtra.rate = state.sureExtra.n ? state.sureExtra.hits / state.sureExtra.n : 0;
    const pp = Number(p || 0.55);
    state.sureExtra.brier = ((state.sureExtra.brier * (state.sureExtra.n - 1)) + (pp - (ok ? 1 : 0)) ** 2) / state.sureExtra.n;
    state.sureExtra.logloss =
      ((state.sureExtra.logloss * (state.sureExtra.n - 1)) + -Math.log(Math.min(0.999, Math.max(0.001, ok ? pp : 1 - pp)))) /
      state.sureExtra.n;
    if (state.sureExtra.n >= 12 && state.sureExtra.rate < 0.55) {
      state.sureExtra.minP = clamp(state.sureExtra.minP + 0.02, 0.52, 0.74);
    } else if (state.sureExtra.n >= 12 && state.sureExtra.rate > 0.62) {
      state.sureExtra.minP = clamp(state.sureExtra.minP - 0.01, 0.48, 0.7);
    }
  }
}

function ingestGradedCard(card) {
  for (const pick of card.picks || []) {
    if (pick.easyOk != null && pick.easyPick?.key) {
      noteMarket(
        pick.easyPick.key,
        pick.easyOk,
        pick.easyAdvice === 'SURE_BET',
        pick.easyPick.pModel,
        pick.easyPick.odds
      );
    }
  }
  const ranked = Object.entries(state.markets)
    .filter(([, v]) => !v.kill && v.n >= 8)
    .sort((a, b) => (b[1].ev || 0) - (a[1].ev || 0) || b[1].rate - a[1].rate)
    .map(([k]) => k);
  if (ranked.length) {
    const easyFirst = ranked.filter((k) => ['dc1x', 'dcx2', 'dc12', 'ov15', 'un15', 'gg', 'ng'].includes(k));
    state.prefer = (easyFirst.length ? easyFirst : ranked).slice(0, 5);
  }
  persist();
}

function marketAlive(key) {
  if (state.skipOv25 && (key === 'ov25' || key === 'un25')) return false;
  if (key === 'ng' && state.skipNg) return false;
  const row = state.markets[key];
  if (!row || row.n < 16) return true;
  return !row.kill;
}

function specialistBoost(key) {
  const row = state.markets[key];
  if (!row || row.n < 8) return key === 'ov15' && state.holdout.alwaysOv15 > 0.6 ? 1.15 : 1;
  if (row.kill) return 0.12;
  return clamp(0.65 + row.rate + Math.max(0, row.ev || 0), 0.45, 1.5);
}

function calibrateP(p, key) {
  const row = state.markets[key];
  const n0 = 18;
  if (!row || row.n < 8) return p;
  return clamp((p * n0 + row.rate * row.n) / (n0 + row.n), 0.05, 0.95);
}

function getIntel() {
  return {
    ...state,
    generator: { ...state.generator },
    independence: { ...state.independence },
    overdisp: { ...state.overdisp },
    sureExtra: { ...state.sureExtra },
    holdout: { ...state.holdout },
    markets: { ...state.markets },
    prefer: [...(state.prefer || DEFAULT.prefer)],
  };
}

function shrinkLambda(teamLambda, n, league) {
  const k = 10;
  const w = k / (k + Math.max(0, n));
  return w * league + (1 - w) * teamLambda;
}

module.exports = {
  rebuildFromHistory,
  ingestGradedCard,
  getIntel,
  marketAlive,
  specialistBoost,
  calibrateP,
  shrinkLambda,
};
