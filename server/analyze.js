const { P_MIN, P_MAX, clamp, findTeam } = require('./catalog');
const { getPrior, ratingFromPrior, shannonEntropy } = require('./bayesian');
const { getBuffer } = require('./buffers');
const { ensemblePredict } = require('./mlEngine');
const { lookupStanding } = require('./standingsCache');
const { recordCard, overlayStoredPicks, stance } = require('./roundTracker');
const { EASY_MARKETS } = require('./markets');
const { getIntel, marketAlive, specialistBoost, calibrateP } = require('./rngIntel');

const MARKETS_1X2 = [
  { key: 'home', result: 'HOME_WIN', label: '1' },
  { key: 'draw', result: 'DRAW', label: 'X' },
  { key: 'away', result: 'AWAY_WIN', label: '2' },
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

function analyzeMarketGroup(oddsSlice, blend = {}, modelAdjust = {}, mix = null) {
  const intel = mix || getIntel();
  const wOdds = Number(intel.oddsWeight != null ? intel.oddsWeight : 0.55);
  const usable = {};
  for (const [key, value] of Object.entries(oddsSlice)) {
    if (Number(value) > 1) usable[key] = Number(value);
  }
  if (!Object.keys(usable).length) {
    const vector = {};
    for (const key of Object.keys(blend)) {
      const pModel = clamp(blend[key] || 0, P_MIN, P_MAX);
      vector[key] = { odds: null, ipRaw: 0, pTrue: pModel, pModel, ev: 0 };
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
    const oddsW = key === 'draw' ? Math.min(0.7, wOdds + 0.05) : wOdds;
    const modelW = 1 - oddsW;
    vector[key] = {
      odds: usable[key],
      ipRaw: Number(raw[key].toFixed(4)),
      pTrue: Number(pTrue.toFixed(4)),
      pModel: clamp(oddsW * pTrue + modelW * pStat + (modelAdjust[key] || 0), P_MIN, P_MAX),
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
  const intelNow = getIntel();
  const ptsGap = ((homeTable.ppg || 0) - (awayTable.ppg || 0));
  const tableAdj = clamp(0.03 * ptsGap, -0.05, 0.05);
  const drawBoost = (Math.abs(ptsGap) < 0.25 ? 0.025 : -0.004 * Math.min(1, Math.abs(ptsGap))) + (intelNow.skipDraw ? -0.02 : 0);

  const oneXTwo = analyzeMarketGroup(
    { home: odds.home, draw: odds.draw, away: odds.away },
    { home: model.home, draw: model.draw, away: model.away },
    { home: tableAdj, draw: drawBoost, away: -tableAdj }
  );

  const totals25 = analyzeMarketGroup(
    { ov25: odds.ov25, un25: odds.un25 },
    { ov25: model.ov25, un25: model.un25 }
  );
  const totals15 = analyzeMarketGroup(
    { ov15: odds.ov15, un15: odds.un15 },
    { ov15: model.ov15, un15: model.un15 }
  );
  const btts = analyzeMarketGroup(
    { gg: odds.gg, ng: odds.ng },
    { gg: model.gg, ng: model.ng }
  );
  const pHome = oneXTwo.vector.home?.pModel || model.home || 0;
  const pDraw = oneXTwo.vector.draw?.pModel || model.draw || 0;
  const pAway = oneXTwo.vector.away?.pModel || model.away || 0;
  const double = analyzeMarketGroup(
    { dc1x: odds.dc1x, dcx2: odds.dcx2, dc12: odds.dc12 },
    { dc1x: pHome + pDraw, dcx2: pDraw + pAway, dc12: pHome + pAway }
  );
  const aux = {
    vector: {
      ...totals15.vector,
      ...totals25.vector,
      ...btts.vector,
      ...double.vector,
    },
    best: null,
    entropy: Number((((totals25.entropy || 0) + (btts.entropy || 0)) / 2).toFixed(4)),
  };

  const ranked = MARKETS_1X2.map((m) => ({
    ...m,
    ...oneXTwo.vector[m.key],
  })).sort((a, b) => (b.pModel || 0) - (a.pModel || 0));

  const tag = ranked[0]?.result || 'DRAW';
  const runner = ranked[1];
  const gapNeed = getIntel().independence?.leaky ? 0.04 : 0.08;
  const lean = (ranked[0]?.pModel || 0) - (runner?.pModel || 0) < gapNeed ? runner?.result : null;

  let easyPick = null;
  const intel = getIntel();
  const tilt = stance();
  const prefer = new Set(intel.prefer || []);
  const cardScale = intel.overdisp?.ratio > 1.35 ? 0.92 : 1;
  for (const item of EASY_MARKETS) {
    if (!marketAlive(item.key)) continue;
    const cell = aux.vector[item.key];
    const rawP = Number(cell?.pModel || 0);
    if (rawP <= 0) continue;
    const p = calibrateP(rawP, item.key);
    const oddsVal = Number(cell.odds || 0);
    const kelly = oddsVal > 1 ? clamp(p - (1 - p) / (oddsVal - 1), 0, 0.25) : 0;
    const pref = prefer.has(item.key) ? 1.12 : 1;
    const cover = item.key.startsWith('dc') ? 1.22 : 1;
    const coverTilt = tilt.preferCover ? (item.key.startsWith('dc') || item.key === 'ov15' ? 1.2 : 0.8) : 1;
    const surety = p * p * (1 + Math.max(0, cell.ev || 0)) * specialistBoost(item.key) * pref * (1 + kelly) * cardScale * cover * coverTilt;
    if (!easyPick || surety > easyPick.surety) {
      easyPick = { key: item.key, label: item.label, pModel: p, odds: cell.odds, ev: cell.ev, surety, kelly };
    }
  }
  aux.best = easyPick;

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
      pModel: 'online stack table+DC+Elo+π + temperature + graded-week learner',
      clamp: [P_MIN, P_MAX],
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
    easyPick,
    confidence: ranked[0]?.pModel || 0,
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
  const tilt = stance();
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
    const leaky = getIntel().independence?.leaky;
    const gapNeed = leaky ? 0.04 : 0.08;
    const predKey = analysis.prediction === 'HOME_WIN' ? 'home' : analysis.prediction === 'AWAY_WIN' ? 'away' : 'draw';
    const pickOdds = Number(vector[predKey]?.odds || 0);
    const short = tilt.fadeShort && analysis.prediction !== 'DRAW' && pickOdds > 1 && pickOdds < 1.55;
    let surety = conf * (0.35 + gap) * agree * (gap >= gapNeed ? 1 : 0.55) * (getIntel().skip1x2 ? 0.7 : 1);
    if (short) surety *= 0.45;
    if (agree < 1) surety *= 0.72;
    const eligible = gap >= gapNeed && conf >= 0.4 && !short && (agree >= 1 || conf >= 0.48);
    return { index, surety, conf, gap, eligible };
  });
  scored.sort((a, b) => b.surety - a.surety);
  const pool = scored.filter((row) => row.eligible);
  const sureCount = Math.min(tilt.oneXSure, pool.length);
  const sure = new Set(pool.slice(0, sureCount).map((row) => row.index));
  const riskCount = Math.min(3, Math.max(0, rows.length - sure.size));
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

function stampEasyAdvice(rows) {
  if (!rows.length) return rows;
  const tilt = stance();
  const minP = Math.max(Number(getIntel().sureExtra?.minP || 0.52), tilt.minP);
  const scored = rows.map((row, index) => ({
    index,
    surety: Number(row.analysis?.easyPick?.surety || 0),
    p: Number(row.analysis?.easyPick?.pModel || 0),
    key: row.analysis?.easyPick?.key || '',
  }));
  scored.sort((a, b) => b.surety - a.surety);
  const eligible = scored.filter((row) => {
    if (row.p < minP) return false;
    if (tilt.preferCover && !(row.key.startsWith('dc') || row.key === 'ov15' || row.key === 'gg')) return false;
    return true;
  });
  const sureCount = Math.min(tilt.extraSure, eligible.length);
  const sure = new Set(eligible.slice(0, sureCount).map((row) => row.index));
  const riskCount = Math.min(3, Math.max(0, rows.length - sure.size));
  const risk = new Set(scored.slice(scored.length - riskCount).filter((row) => !sure.has(row.index)).map((row) => row.index));
  return rows.map((row, index) => {
    let easyAdvice = null;
    if (sure.has(index)) easyAdvice = 'SURE_BET';
    else if (risk.has(index)) easyAdvice = 'DONT_RISK';
    return {
      ...row,
      analysis: { ...row.analysis, easyAdvice },
    };
  });
}

function analyzeMatchday(payload) {
  const fixtures = payload.fixtures || [];
  const fresh = stampEasyAdvice(stampAdvice(fixtures.map((fixture, index) => {
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
  })));
  const round = recordCard({
    seasonId: payload.seasonId,
    week: payload.week,
    matchdayTime: payload.matchdayTime,
    phase: payload.phase,
    rows: fresh,
  });
  const analyzed = overlayStoredPicks(fresh, round);
  return {
    schema: 'virtualTOP$DC.odiLeague.analysis.v1',
    matchdayTime: payload.matchdayTime || null,
    count: analyzed.length,
    rows: analyzed,
    round,
  };
}

module.exports = {
  analyzeFixture,
  analyzeMatchday,
  expectedValue,
  impliedRaw,
  stripMargin,
};
