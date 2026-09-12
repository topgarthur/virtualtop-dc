const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'strategy-state.json');

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
  return { corrections: { ...DEFAULT_CORRECTIONS }, rounds: {} };
}

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      corrections: { ...DEFAULT_CORRECTIONS, ...(parsed.corrections || {}) },
      rounds: parsed.rounds || {},
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
  if (phase === 'live' && existing?.picks?.length) return existing;

  const picks = rows.map((row) => {
    const fixture = row.fixture || row;
    const analysis = row.analysis || {};
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
      confidence: Number(analysis.confidence || 0),
      actual: null,
      ok: null,
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
      hits += 1;
    }
    if (!hits) continue;
    card.correct = card.picks.filter((p) => p.ok === true).length;
    card.wrong = card.picks.filter((p) => p.ok === false).length;
    card.pending = card.picks.filter((p) => p.ok == null).length;
    card.total = card.picks.length;
    if (card.pending === 0 && card.total) {
      card.status = 'graded';
      card.gradedAt = new Date().toISOString();
      learnFromCard(card);
      gradedNow.push(card);
    } else {
      card.status = 'locked';
    }
  }
  if (gradedNow.length) persist();
  else persist();
  return gradedNow;
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
  const w = Math.min(1, 0.35);
  const upsetFrac = upsets / n;
  const drawFrac = drawMiss / n;
  c.upsetRate = (1 - w) * c.upsetRate + w * upsetFrac;
  c.drawMissRate = (1 - w) * c.drawMissRate + w * drawFrac;
  c.favoriteDamp = clamp(0.12 + 0.7 * c.upsetRate, 0.12, 0.45);
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

function summary() {
  const rounds = getRounds();
  const graded = rounds.filter((r) => r.status === 'graded');
  const correct = graded.reduce((s, r) => s + r.correct, 0);
  const wrong = graded.reduce((s, r) => s + r.wrong, 0);
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
    },
    corrections: getCorrections(),
  };
}

module.exports = {
  recordCard,
  lockCard,
  gradeResults,
  getCorrections,
  getRounds,
  getRound,
  summary,
  roundTitle,
};
