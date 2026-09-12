const { P_MIN, P_MAX, EV_VALUE_THRESHOLD, clamp, findTeam } = require('./catalog');
const { getPrior, ratingFromPrior, shannonEntropy } = require('./bayesian');
const { getBuffer } = require('./buffers');
const { ensemblePredict } = require('./mlEngine');
const { lookupStanding } = require('./standingsCache');
const { recordCard } = require('./roundTracker');

const MARKETS_1X2 = [
  { key: 'home', result: 'HOME_WIN', label: '1' },
  { key: 'draw', result: 'DRAW', label: 'X' },
  { key: 'away', result: 'AWAY_WIN', label: '2' },
];

const AUX_MARKETS = [
  { key: 'ov25', label: 'O2.5' },
  { key: 'un25', label: 'U2.5' },
  { key: 'gg', label: 'GG' },
  { key: 'ng', label: 'NG' },
];

function impliedRaw(odds) {
  const o = Number(odds);
  if (!o || o <= 1) return 0;
  return 1 / o;
}

function stripMargin(rawMap) {
  const entries = Object.entries(rawMap);
  const overround = entries.reduce((sum, [, ip]) => sum + ip, 0) || 1;
  const trueMap = {};
  for (const [key, ip] of entries) {
    trueMap[key] = ip / overround;
  }
  return { overround: Number(overround.toFixed(4)), trueMap, margin: Number((overround - 1).toFixed(4)) };
}

function expectedValue(pTrue, odds) {
  const o = Number(odds);
  if (!o || o <= 1) return -1;
  return Number((pTrue * o - 1).toFixed(4));
}

function analyzeMarketGroup(oddsSlice, blend = {}, modelAdjust = {}) {
  const usable = {};
  for (const [key, value] of Object.entries(oddsSlice)) {
    if (Number(value) > 1) usable[key] = Number(value);
  }
  if (!Object.keys(usable).length) {
    const vector = {};
    for (const key of Object.keys(blend)) {
      const pModel = clamp(blend[key] || 0, P_MIN, P_MAX);
      vector[key] = { odds: null, ipRaw: 0, pTrue: pModel, pModel, ev: 0, highValue: false };
    }
    return { overround: 1, margin: 0, entropy: shannonEntropy(Object.values(vector).map((v) => v.pModel)), vector, best: null };
  }
  const raw = {};
  for (const key of Object.keys(usable)) raw[key] = impliedRaw(usable[key]);
  const { overround, trueMap, margin } = stripMargin(raw);
  const vector = {};

  for (const key of Object.keys(usable)) {
    const pTrue = trueMap[key] || 0;
    const pStat = blend[key] != null ? blend[key] : pTrue;
    const wOdds = key === 'draw' ? 0.18 : 0.2;
    const wModel = key === 'draw' ? 0.72 : 0.7;
    vector[key] = {
      odds: usable[key],
      ipRaw: Number(raw[key].toFixed(4)),
      pTrue: Number(pTrue.toFixed(4)),
      pModel: clamp(wOdds * pTrue + wModel * pStat + (modelAdjust[key] || 0), P_MIN, P_MAX),
    };
  }

  let sum = 0;
  for (const key of Object.keys(vector)) sum += vector[key].pModel;
  if (sum > 0) {
    for (const key of Object.keys(vector)) {
      vector[key].pModel = clamp(vector[key].pModel / sum, P_MIN, P_MAX);
    }
  }

  let best = null;
  for (const [key, v] of Object.entries(vector)) {
    v.pModel = Number(v.pModel.toFixed(4));
    v.ev = expectedValue(v.pModel, v.odds);
    v.highValue = v.ev > EV_VALUE_THRESHOLD;
    if (!best || v.ev > best.ev) best = { key, ...v };
  }

  return {
    overround,
    margin,
    entropy: shannonEntropy(Object.values(vector).map((v) => v.pModel)),
    vector,
    best,
  };
}

function resolveTeam(id, name) {
  return findTeam(id) || findTeam(name) || { id: String(id || name), name: String(name || id), rating: 50 };
}

function analyzeFixture(input) {
  const homeTeam = resolveTeam(input.homeId, input.homeTeam);
  const awayTeam = resolveTeam(input.awayId, input.awayTeam);
  const odds = input.odds || {};
  const history = getBuffer();
  const homePrior = getPrior(homeTeam.id);
  const awayPrior = getPrior(awayTeam.id);
  const Rhome = ratingFromPrior(homePrior, 50);
  const Raway = ratingFromPrior(awayPrior, 50);
  const delta = Rhome - Raway;
  const model = ensemblePredict(homeTeam.id, awayTeam.id);
  const homeTable = lookupStanding(homeTeam.id || homeTeam.name);
  const awayTable = lookupStanding(awayTeam.id || awayTeam.name);
  const ptsGap = ((homeTable.ppg || 0) - (awayTable.ppg || 0));
  const tableAdj = clamp(0.03 * ptsGap, -0.05, 0.05);
  const drawBoost = Math.abs(ptsGap) < 0.25 ? 0.025 : -0.004 * Math.min(1, Math.abs(ptsGap));

  const oneXTwo = analyzeMarketGroup(
    { home: odds.home, draw: odds.draw, away: odds.away },
    { home: model.home, draw: model.draw, away: model.away },
    { home: tableAdj, draw: drawBoost, away: -tableAdj }
  );

  const totals = odds.ov25 != null && odds.un25 != null
    ? analyzeMarketGroup({ ov25: odds.ov25, un25: odds.un25 }, { ov25: model.ov25, un25: model.un25 })
    : { vector: {}, best: null, entropy: 0 };
  const btts = odds.gg != null && odds.ng != null
    ? analyzeMarketGroup({ gg: odds.gg, ng: odds.ng }, { gg: model.gg, ng: model.ng })
    : { vector: {}, best: null, entropy: 0 };
  const aux = {
    vector: { ...totals.vector, ...btts.vector },
    best: [totals.best, btts.best].filter(Boolean).sort((a, b) => b.ev - a.ev)[0] || null,
    entropy: Number((((totals.entropy || 0) + (btts.entropy || 0)) / 2).toFixed(4)),
  };

  const ranked = MARKETS_1X2.map((m) => ({
    ...m,
    ...oneXTwo.vector[m.key],
  })).sort((a, b) => (b.pModel || 0) - (a.pModel || 0));

  const tag = ranked[0]?.result || 'DRAW';
  const runner = ranked[1];
  const lean = (ranked[0]?.pModel || 0) - (runner?.pModel || 0) < 0.05 ? runner?.result : null;
  const highValueFlags = [...Object.entries(oneXTwo.vector), ...Object.entries(aux.vector || {})]
    .filter(([, v]) => v.highValue)
    .map(([key]) => key);

  return {
    schema: 'virtualTOP$DC.odiLeague.prediction.v1',
    fixtureId: input.fixtureId,
    homeId: homeTeam.id,
    awayId: awayTeam.id,
    homeTeam: homeTeam.name,
    awayTeam: awayTeam.name,
    sampleSize: history.length,
    ratings: {
      Rhome,
      Raway,
      delta: Number(delta.toFixed(3)),
      k: 'table-history',
      table: { home: homeTable, away: awayTable },
      model,
    },
    formula: {
      ipRaw: '1/O',
      pTrue: 'IP_raw / overround',
      ev: '(P_model * Odds) - 1',
      pModel: 'table PPG + match history DC/Elo + gameweek correction (no club-size rating)',
      clamp: [P_MIN, P_MAX],
      valueThreshold: EV_VALUE_THRESHOLD,
    },
    oneXTwo,
    vector: {
      HOME_WIN: oneXTwo.vector.home,
      DRAW: oneXTwo.vector.draw,
      AWAY_WIN: oneXTwo.vector.away,
    },
    aux,
    prediction: tag,
    lean,
    confidence: ranked[0]?.pModel || 0,
    bestEv: ranked[0]?.ev ?? -1,
    highValue: highValueFlags.length > 0,
    highValueFlags,
    rngNote: 'Odibet RNG can upset table leaders. Strength is table + previous scores, not brand size.',
    advice: null,
  };
}

function winnerKey(probs) {
  if (!probs) return null;
  const home = probs.home || 0;
  const draw = probs.draw || 0;
  const away = probs.away || 0;
  if (draw >= home && draw >= away) return 'DRAW';
  return home >= away ? 'HOME_WIN' : 'AWAY_WIN';
}

function stampAdvice(rows) {
  if (!rows.length) return rows;
  const scored = rows.map((row, index) => {
    const analysis = row.analysis || {};
    const vector = analysis.oneXTwo?.vector || {};
    const vals = ['home', 'draw', 'away'].map((key) => Number(vector[key]?.pModel || 0)).sort((a, b) => b - a);
    const gap = (vals[0] || 0) - (vals[1] || 0);
    const conf = Number(analysis.confidence || vals[0] || 0);
    const model = analysis.ratings?.model || {};
    const tableWin = winnerKey(model.components?.table);
    const dcWin = winnerKey(model.components?.dixonColes);
    const agree = tableWin && dcWin && tableWin === analysis.prediction && dcWin === analysis.prediction ? 1.2 : 0.75;
    const surety = conf * (0.35 + gap) * agree;
    return { index, surety, conf, gap };
  });
  scored.sort((a, b) => b.surety - a.surety);
  const sureCount = Math.min(3, rows.length);
  const riskCount = Math.min(3, Math.max(0, rows.length - sureCount));
  const sure = new Set(scored.slice(0, sureCount).map((row) => row.index));
  const risk = new Set(scored.slice(scored.length - riskCount).filter((row) => !sure.has(row.index)).map((row) => row.index));
  return rows.map((row, index) => {
    const meta = scored.find((item) => item.index === index);
    let advice = null;
    if (sure.has(index)) advice = 'SURE_BET';
    else if (risk.has(index)) advice = 'DONT_RISK';
    return {
      ...row,
      analysis: {
        ...row.analysis,
        advice,
        surety: Number((meta?.surety || 0).toFixed(4)),
      },
    };
  });
}

function analyzeMatchday(payload) {
  const fixtures = payload.fixtures || [];
  const analyzed = stampAdvice(fixtures.map((fixture, index) => {
    const analysis = analyzeFixture({
      fixtureId: fixture.fixtureId || `odi-${payload.matchdayTime || 'live'}-${index}`,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      homeId: fixture.homeId,
      awayId: fixture.awayId,
      odds: fixture.odds,
    });
    return {
      fixture: {
        ...fixture,
        fixtureId: analysis.fixtureId,
        homeName: analysis.homeTeam,
        awayName: analysis.awayTeam,
      },
      analysis,
    };
  }));
  return {
    schema: 'virtualTOP$DC.odiLeague.analysis.v1',
    matchdayTime: payload.matchdayTime || null,
    count: analyzed.length,
    highValueCount: analyzed.filter((row) => row.analysis.highValue).length,
    rows: analyzed,
    round: recordCard({
      seasonId: payload.seasonId,
      week: payload.week,
      matchdayTime: payload.matchdayTime,
      phase: payload.phase,
      rows: analyzed,
    }),
  };
}

module.exports = {
  analyzeFixture,
  analyzeMatchday,
  expectedValue,
  impliedRaw,
  stripMargin,
};
