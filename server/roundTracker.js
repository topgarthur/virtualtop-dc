const fs = require('fs');
const path = require('path');
const { learnCard } = require('./learner');
const { gradeEasy, easyLabel } = require('./markets');
const { ingestGradedCard, rebuildFromHistory } = require('./rngIntel');

const MAX_SAMPLES = 800;

const { dataFile } = require('./dataDir');

const FILE = dataFile('strategy-state.json');

const DEFAULT_CORRECTIONS = {
  favoriteDamp: 0.18,
  drawFloor: 0.22,
  homeNudge: 0,
  upsetRate: 0,
  drawMissRate: 0,
  weeksGraded: 0,
  lastLesson: 'Waiting for the first graded English League week.',
};

let state = load();

function emptyState() {
  return { corrections: { ...DEFAULT_CORRECTIONS }, rounds: {}, samples: [] };
}

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      corrections: { ...DEFAULT_CORRECTIONS, ...(parsed.corrections || {}) },
      rounds: parsed.rounds || {},
      samples: Array.isArray(parsed.samples) ? parsed.samples.slice(-MAX_SAMPLES) : [],
    };
  } catch {
    return emptyState();
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch {
    // disk persist is best-effort; in-memory still grades the session
  }
}

function roundKey(seasonId, week, clock) {
  const time = clock && clock !== '--:--' ? clock : 'open';
  return `${seasonId}:${week}:${time}`;
}

function roundTitle(seasonId, week, clock) {
  const time = clock ? ` · ${clock}` : '';
  return `#English League WEEK ${week}${time} - #${seasonId}`;
}

function winnerOf(probs) {
  if (!probs) return null;
  const home = probs.home || 0;
  const draw = probs.draw || 0;
  const away = probs.away || 0;
  if (draw >= home && draw >= away) return 'DRAW';
  return home >= away ? 'HOME_WIN' : 'AWAY_WIN';
}

function outcomeFromScore(homeGoals, awayGoals) {
  if (homeGoals == null || awayGoals == null) return null;
  if (homeGoals > awayGoals) return 'HOME_WIN';
  if (awayGoals > homeGoals) return 'AWAY_WIN';
  return 'DRAW';
}

function recordCard({ seasonId, week, matchdayTime, phase, rows }) {
  const sid = String(seasonId || 'unknown');
  const wk = Number(week) || 0;
  const clock = matchdayTime || 'open';
  if (!wk || !rows?.length) return null;
  const key = roundKey(sid, wk, clock);
  const existing = state.rounds[key];
  if (existing?.status === 'graded') return existing;
  if (existing?.status === 'locked' && existing.picks?.length) return existing;
  if (phase === 'live' && existing?.picks?.length) {
    existing.status = 'locked';
    persist();
    return existing;
  }

  const overrides = new Map(
    (existing?.picks || [])
      .filter((row) => row.easyPick?.overridden)
      .map((row) => [String(row.fixtureId), row.easyPick])
  );

  const picks = rows.map((row) => {
    const fixture = row.fixture || row;
    const analysis = row.analysis || {};
    const override = overrides.get(String(fixture.fixtureId));
    return {
      fixtureId: String(fixture.fixtureId),
      home: fixture.homeName || fixture.homeTeam,
      away: fixture.awayName || fixture.awayTeam,
      homeId: String(fixture.homeId || ''),
      awayId: String(fixture.awayId || ''),
      week: wk,
      clock,
      pick: analysis.prediction || 'DRAW',
      advice: analysis.advice || null,
      easyPick: override || analysis.easyPick || null,
      easyAdvice: analysis.easyAdvice || null,
      confidence: Number(analysis.confidence || 0),
      pModel: Number(analysis.confidence || 0),
      probs: {
        home: Number(analysis.vector?.HOME_WIN?.pModel || analysis.oneXTwo?.vector?.home?.pModel || 0),
        draw: Number(analysis.vector?.DRAW?.pModel || analysis.oneXTwo?.vector?.draw?.pModel || 0),
        away: Number(analysis.vector?.AWAY_WIN?.pModel || analysis.oneXTwo?.vector?.away?.pModel || 0),
      },
      votes: {
        table: winnerOf(analysis.ratings?.model?.components?.table),
        dc: winnerOf(analysis.ratings?.model?.components?.dixonColes),
        elo: winnerOf(analysis.ratings?.model?.components?.elo),
        pi: winnerOf(analysis.ratings?.model?.components?.pi),
      },
      actual: null,
      ok: null,
      easyOk: null,
    };
  });

  const card = {
    key,
    seasonId: sid,
    week: wk,
    clock,
    title: roundTitle(sid, wk, clock),
    matchdayTime: clock,
    status: phase === 'live' ? 'locked' : 'pending',
    predictedAt: existing?.predictedAt || new Date().toISOString(),
    gradedAt: null,
    correct: 0,
    wrong: 0,
    easyCorrect: 0,
    easyWrong: 0,
    pending: picks.length,
    total: picks.length,
    picks,
  };
  state.rounds[key] = card;
  persist();
  return card;
}

function lockCard(seasonId, week, matchdayTime) {
  const key = matchdayTime ? roundKey(seasonId, week, matchdayTime) : null;
  const cards = key
    ? [state.rounds[key]].filter(Boolean)
    : Object.values(state.rounds).filter((row) => row.seasonId === String(seasonId) && row.week === Number(week));
  for (const card of cards) {
    if (card.status === 'pending') card.status = 'locked';
  }
  persist();
  return cards[0] || null;
}

function gradeResults(results) {
  const byId = new Map();
  const byPair = new Map();
  for (const match of results || []) {
    const actual = match.result || outcomeFromScore(match.homeGoals, match.awayGoals);
    if (!actual) continue;
    if (match.fixtureId) byId.set(String(match.fixtureId), { ...match, actual });
    const pair = `${match.week || ''}|${String(match.homeTeam || '').toLowerCase()}|${String(match.awayTeam || '').toLowerCase()}`;
    byPair.set(pair, { ...match, actual });
  }

  let gradedNow = [];
  for (const card of Object.values(state.rounds)) {
    if (card.status === 'graded') continue;
    let hits = 0;
    for (const pick of card.picks) {
      if (pick.ok != null) {
        hits += 1;
        continue;
      }
      const hit =
        byId.get(String(pick.fixtureId)) ||
        byPair.get(`${pick.week || card.week || ''}|${String(pick.home).toLowerCase()}|${String(pick.away).toLowerCase()}`);
      if (!hit) continue;
      pick.actual = hit.actual;
      pick.ok = pick.pick === hit.actual;
      pick.score = hit.homeGoals != null ? `${hit.homeGoals}:${hit.awayGoals}` : hit.score || null;
      const easyKey = pick.easyPick?.key;
      pick.easyOk = gradeEasy(easyKey, hit.homeGoals, hit.awayGoals);
      pushSample('1x2', pick.pick, pick.pModel || pick.confidence, pick.ok);
      if (easyKey && pick.easyOk != null) {
        pushSample('extra', easyKey, Number(pick.easyPick.pModel || 0), pick.easyOk);
      }
      hits += 1;
    }
    if (!hits) continue;
    card.correct = card.picks.filter((p) => p.ok === true).length;
    card.wrong = card.picks.filter((p) => p.ok === false).length;
    card.easyCorrect = card.picks.filter((p) => p.easyOk === true).length;
    card.easyWrong = card.picks.filter((p) => p.easyOk === false).length;
    card.pending = card.picks.filter((p) => p.ok == null).length;
    card.total = card.picks.length;
    if (card.pending === 0 && card.total) {
      card.status = 'graded';
      card.gradedAt = new Date().toISOString();
      learnFromCard(card);
      learnCard(card);
      ingestGradedCard(card);
      gradedNow.push(card);
    } else {
      card.status = 'locked';
    }
  }
  if (gradedNow.length) {
    rebuildFromHistory();
    persist();
  } else persist();
  return gradedNow;
}

function pushSample(kind, key, p, ok) {
  if (!Array.isArray(state.samples)) state.samples = [];
  state.samples.push({
    kind,
    key: String(key || ''),
    p: Number(p) || 0,
    ok: Boolean(ok),
    at: Date.now(),
  });
  if (state.samples.length > MAX_SAMPLES) {
    state.samples = state.samples.slice(-MAX_SAMPLES);
  }
}

function setEasyOverride({ seasonId, week, matchdayTime, fixtureId, easyPick }) {
  const card = matchdayTime
    ? state.rounds[roundKey(seasonId, week, matchdayTime)]
    : getRound(seasonId, week);
  if (!card || card.status === 'graded') return card || null;
  const pick = (card.picks || []).find((row) => String(row.fixtureId) === String(fixtureId));
  if (!pick || !easyPick?.key) return card;
  pick.easyPick = {
    key: easyPick.key,
    label: easyPick.label || easyLabel(easyPick.key),
    pModel: Number(easyPick.pModel || 0),
    odds: easyPick.odds || null,
    surety: Number(easyPick.surety || easyPick.pModel || 0),
    overridden: true,
  };
  persist();
  return card;
}

function overlayStoredPicks(rows, card) {
  if (!card?.picks?.length || !rows?.length) return rows;
  const freeze = card.status === 'locked' || card.status === 'graded';
  const byId = new Map(card.picks.map((row) => [String(row.fixtureId), row]));
  return rows.map((row) => {
    const stored = byId.get(String(row.fixture?.fixtureId || row.fixtureId));
    if (!stored) return row;
    const analysis = { ...row.analysis };
    if (freeze) {
      analysis.prediction = stored.pick || analysis.prediction;
      analysis.advice = stored.advice ?? analysis.advice;
      analysis.easyAdvice = stored.easyAdvice ?? analysis.easyAdvice;
      analysis.locked = true;
    }
    if (stored.easyPick && (freeze || stored.easyPick.overridden)) {
      analysis.easyPick = stored.easyPick;
    }
    return { ...row, analysis };
  });
}

function marketStats(graded) {
  const bag = {};
  const bump = (key, ok) => {
    if (!key || ok == null) return;
    if (!bag[key]) bag[key] = { key, label: easyLabel(key) === key ? key : easyLabel(key), n: 0, hits: 0, rate: 0 };
    bag[key].n += 1;
    if (ok) bag[key].hits += 1;
    bag[key].rate = bag[key].n ? bag[key].hits / bag[key].n : 0;
  };
  for (const card of graded) {
    for (const pick of card.picks || []) {
      bump(pick.pick, pick.ok);
      bump(pick.easyPick?.key, pick.easyOk);
    }
  }
  return Object.values(bag)
    .map((row) => ({ ...row, rate: Number(row.rate.toFixed(3)) }))
    .sort((a, b) => b.n - a.n);
}

function calibrationBins(kind) {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    lo: i / 10,
    hi: (i + 1) / 10,
    n: 0,
    hits: 0,
    predicted: 0,
  }));
  for (const sample of state.samples || []) {
    if (sample.kind !== kind) continue;
    const idx = Math.min(9, Math.max(0, Math.floor((Number(sample.p) || 0) * 10)));
    bins[idx].n += 1;
    bins[idx].predicted += Number(sample.p) || 0;
    if (sample.ok) bins[idx].hits += 1;
  }
  return bins
    .filter((row) => row.n > 0)
    .map((row) => ({
      label: `${Math.round(row.lo * 100)}–${Math.round(row.hi * 100)}%`,
      n: row.n,
      hits: row.hits,
      predicted: Number((row.predicted / row.n).toFixed(3)),
      actual: Number((row.hits / row.n).toFixed(3)),
    }));
}

function learnFromCard(card) {
  const n = card.picks.length || 1;
  let upsets = 0;
  let drawMiss = 0;
  let homeActual = 0;
  let homePicked = 0;
  for (const pick of card.picks) {
    if (pick.pick === 'HOME_WIN') homePicked += 1;
    if (pick.actual === 'HOME_WIN') homeActual += 1;
    if (pick.ok) continue;
    if (pick.actual === 'DRAW' && pick.pick !== 'DRAW') drawMiss += 1;
    if (
      (pick.pick === 'HOME_WIN' && pick.actual === 'AWAY_WIN') ||
      (pick.pick === 'AWAY_WIN' && pick.actual === 'HOME_WIN')
    ) {
      upsets += 1;
    }
  }
  const c = state.corrections;
  const w = Math.min(1, 0.12);
  const upsetFrac = upsets / n;
  const drawFrac = drawMiss / n;
  c.upsetRate = (1 - w) * c.upsetRate + w * upsetFrac;
  c.drawMissRate = (1 - w) * c.drawMissRate + w * drawFrac;
  c.favoriteDamp = clamp(0.12 + 0.7 * c.upsetRate, 0.12, 0.45);
  if (card.wrong > card.correct) c.favoriteDamp = clamp(c.favoriteDamp + 0.05, 0.12, 0.52);
  if ((card.easyWrong || 0) > (card.easyCorrect || 0)) c.drawFloor = clamp(c.drawFloor + 0.01, 0.18, 0.34);
  c.drawFloor = clamp(0.2 + 0.35 * c.drawMissRate, 0.18, 0.33);
  c.homeNudge = clamp((1 - w) * c.homeNudge + w * ((homeActual - homePicked) / n) * 0.08, -0.04, 0.04);
  c.weeksGraded += 1;
  c.lastLesson = `${card.title}: ${card.correct} correct / ${card.wrong} wrong. Damp favorites ${(c.favoriteDamp * 100).toFixed(0)}%, DRAW floor ${(c.drawFloor * 100).toFixed(0)}% (RNG upsets + missed draws).`;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function getCorrections() {
  return { ...state.corrections };
}

function getRounds() {
  return Object.values(state.rounds)
    .map((row) => ({ ...row, clock: row.clock || row.matchdayTime || '—' }))
    .sort((a, b) => {
      if (b.week !== a.week) return (b.week || 0) - (a.week || 0);
      return String(a.clock).localeCompare(String(b.clock));
    });
}

function getRound(seasonId, week, clock) {
  if (clock) return state.rounds[roundKey(seasonId, week, clock)] || null;
  return getRounds().find((row) => row.seasonId === String(seasonId) && Number(row.week) === Number(week)) || null;
}

function stance() {
  const rounds = getRounds();
  const graded = rounds.filter((r) => r.status === 'graded');
  const correct = graded.reduce((s, r) => s + r.correct, 0);
  const wrong = graded.reduce((s, r) => s + r.wrong, 0);
  const easyCorrect = graded.reduce((s, r) => s + (r.easyCorrect || 0), 0);
  const easyWrong = graded.reduce((s, r) => s + (r.easyWrong || 0), 0);
  const xN = correct + wrong;
  const eN = easyCorrect + easyWrong;
  const xRate = xN ? correct / xN : 0.5;
  const eRate = eN ? easyCorrect / eN : 0.5;
  const losing1x2 = xN >= 6 && xRate < 0.48;
  const losingExtra = eN >= 6 && eRate < 0.5;
  return {
    oneXRate: xRate,
    extraRate: eRate,
    oneXSure: xN < 6 ? 3 : xRate >= 0.5 ? 3 : xRate >= 0.42 ? 2 : 1,
    extraSure: eN < 6 ? 3 : eRate >= 0.52 ? 3 : eRate >= 0.45 ? 2 : 1,
    minP: losingExtra ? 0.58 : eRate < 0.52 && eN >= 6 ? 0.55 : 0.54,
    fadeShort: losing1x2 || (xN >= 6 && wrong > correct),
    preferCover: losing1x2 || losingExtra,
  };
}

function summary() {
  const rounds = getRounds();
  const graded = rounds.filter((r) => r.status === 'graded');
  const correct = graded.reduce((s, r) => s + r.correct, 0);
  const wrong = graded.reduce((s, r) => s + r.wrong, 0);
  const easyCorrect = graded.reduce((s, r) => s + (r.easyCorrect || 0), 0);
  const easyWrong = graded.reduce((s, r) => s + (r.easyWrong || 0), 0);
  const current = rounds.find((r) => r.status !== 'graded') || graded[0] || null;
  const weeks = [...new Set(graded.map((r) => `${r.seasonId}:${r.week}`))].length;
  return {
    schema: 'virtualTOP$DC.odiLeague.strategy.rounds.v1',
    current,
    segments: rounds.slice(0, 24),
    graded,
    recent: rounds.slice(0, 16),
    totals: {
      cards: graded.length,
      weeks,
      correct,
      wrong,
      accuracy: correct + wrong ? correct / (correct + wrong) : 0,
      easyCorrect,
      easyWrong,
      easyAccuracy: easyCorrect + easyWrong ? easyCorrect / (easyCorrect + easyWrong) : 0,
    },
    marketStats: marketStats(graded),
    calibration: {
      oneXTwo: calibrationBins('1x2'),
      extra: calibrationBins('extra'),
    },
    corrections: getCorrections(),
    learner: require('./learner').getParams(),
  };
}

module.exports = {
  recordCard,
  lockCard,
  gradeResults,
  setEasyOverride,
  overlayStoredPicks,
  getCorrections,
  getRounds,
  getRound,
  summary,
  stance,
  roundTitle,
};
