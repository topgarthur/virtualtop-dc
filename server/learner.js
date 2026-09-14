const fs = require('fs');
const path = require('path');

const { dataFile } = require('./dataDir');

const FILE = dataFile('learner-state.json');

const DEFAULTS = {
  weights: { table: 0.36, dc: 0.32, elo: 0.16, pi: 0.16 },
  rho: 0.13,
  temperature: 1.05,
  drawRate: 0.27,
  homeAdv: 1.06,
  logloss: 1.1,
  n: 0,
  brier: 0.22,
  confusion: {
    HOME_WIN: { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 },
    DRAW: { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 },
    AWAY_WIN: { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 },
  },
  lastLesson: 'Online learner waiting for graded cards.',
};

let state = load();

function empty() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      ...empty(),
      ...parsed,
      weights: { ...DEFAULTS.weights, ...(parsed.weights || {}) },
      confusion: parsed.confusion || empty().confusion,
    };
  } catch {
    return empty();
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

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function winnerFromProbs(p) {
  if (!p) return null;
  const home = p.home || 0;
  const draw = p.draw || 0;
  const away = p.away || 0;
  if (draw >= home && draw >= away) return 'DRAW';
  return home >= away ? 'HOME_WIN' : 'AWAY_WIN';
}

function logLoss(probs, actual) {
  const key = actual === 'HOME_WIN' ? 'home' : actual === 'AWAY_WIN' ? 'away' : 'draw';
  const p = Math.min(0.999, Math.max(0.001, Number(probs?.[key] || 1 / 3)));
  return -Math.log(p);
}

function brierOne(probs, actual) {
  const keys = [
    ['home', 'HOME_WIN'],
    ['draw', 'DRAW'],
    ['away', 'AWAY_WIN'],
  ];
  let s = 0;
  for (const [k, label] of keys) {
    const y = actual === label ? 1 : 0;
    const p = Number(probs?.[k] || 0);
    s += (p - y) ** 2;
  }
  return s;
}

function learnCard(card) {
  const picks = (card.picks || []).filter((p) => p.actual && p.ok != null);
  if (!picks.length) return getParams();
  const w = state.weights;
  let loss = 0;
  let brier = 0;
  let draws = 0;
  for (const pick of picks) {
    const actual = pick.actual;
    const probs = pick.probs || {};
    loss += logLoss(probs, actual);
    brier += brierOne(probs, actual);
    if (actual === 'DRAW') draws += 1;
    const pred = pick.pick || 'DRAW';
    if (state.confusion[pred] && state.confusion[pred][actual] != null) {
      state.confusion[pred][actual] += 1;
    }
    const votes = pick.votes || {};
    const freeze = state.n < 40;
    const lrUp = freeze ? 1.008 : 1.02;
    const lrDown = freeze ? 0.996 : 0.99;
    if (!freeze) {
      for (const name of Object.keys(w)) {
        const vote = votes[name];
        if (!vote) continue;
        w[name] *= vote === actual ? lrUp : lrDown;
      }
    }
    const top = Math.max(probs.home || 0, probs.draw || 0, probs.away || 0);
    if (!freeze) {
      if (!pick.ok && top > 0.48) state.temperature = clamp(state.temperature * 1.006, 0.9, 1.35);
      if (pick.ok && top > 0.5) state.temperature = clamp(state.temperature * 0.998, 0.9, 1.35);
    }
  }
  const n = picks.length;
  let sumW = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  for (const key of Object.keys(w)) w[key] = w[key] / sumW;
  const prior = 0.25;
  const shrink = state.n < 80 ? 0.35 : 0.12;
  for (const key of Object.keys(w)) w[key] = (1 - shrink) * w[key] + shrink * prior;
  sumW = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  for (const key of Object.keys(w)) w[key] = clamp(w[key] / sumW, 0.1, 0.45);
  sumW = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  for (const key of Object.keys(w)) w[key] = w[key] / sumW;

  const ema = state.n < 80 ? 0.08 : 0.14;
  state.logloss = (1 - ema) * state.logloss + ema * (loss / n);
  state.brier = (1 - ema) * state.brier + ema * (brier / n);
  state.drawRate = (1 - ema) * state.drawRate + ema * (draws / n);
  state.rho = clamp(0.08 + 0.4 * state.drawRate, 0.08, 0.22);
  state.n += n;
  const acc = picks.filter((p) => p.ok).length / n;
  state.lastLesson = `Learner ${card.clock || card.matchdayTime || ''}: ${picks.filter((p) => p.ok).length}/${n} hit, logloss ${state.logloss.toFixed(3)}, T=${state.temperature.toFixed(2)}, ρ=${state.rho.toFixed(3)}, w table ${w.table.toFixed(2)} DC ${w.dc.toFixed(2)} (acc ${(acc * 100).toFixed(0)}%).`;
  persist();
  return getParams();
}

function getParams() {
  return {
    weights: { ...state.weights },
    rho: state.rho,
    temperature: state.temperature,
    drawRate: state.drawRate,
    homeAdv: state.homeAdv,
    logloss: Number(state.logloss.toFixed(4)),
    brier: Number(state.brier.toFixed(4)),
    n: state.n,
    confusion: state.confusion,
    lastLesson: state.lastLesson,
  };
}

function applyTemperature(probs, temperature) {
  const t = Math.max(0.7, Number(temperature) || 1);
  const keys = ['home', 'draw', 'away'];
  const raised = {};
  let s = 0;
  for (const key of keys) {
    raised[key] = (Math.max(0.001, probs[key] || 0)) ** (1 / t);
    s += raised[key];
  }
  for (const key of keys) raised[key] /= s || 1;
  return raised;
}

module.exports = {
  learnCard,
  getParams,
  applyTemperature,
  winnerFromProbs,
};
