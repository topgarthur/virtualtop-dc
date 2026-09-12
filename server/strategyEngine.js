const { findTeam, clamp } = require('./catalog');
const { getBuffer } = require('./buffers');
const { poissonPmf } = require('./poisson');
const { lookupStanding, getStandings } = require('./standingsCache');
const { getCorrections } = require('./roundTracker');

const RHO = 0.13;
const ELO_K = 18;
const ELO_START = 1500;
const LEAGUE_AVG = 1.32;

function tau(i, j, lh, la, rho) {
  if (i === 0 && j === 0) return 1 - lh * la * rho;
  if (i === 0 && j === 1) return 1 + lh * rho;
  if (i === 1 && j === 0) return 1 + la * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

function resolve(idOrName) {
  return findTeam(idOrName) || { id: String(idOrName), name: String(idOrName) };
}

function matchesFor(history, team) {
  const rows = [];
  for (const match of history) {
    const isHome = match.homeId === team.id || match.homeTeam === team.name;
    const isAway = match.awayId === team.id || match.awayTeam === team.name;
    if (!isHome && !isAway) continue;
    if (match.homeGoals == null || match.awayGoals == null) continue;
    rows.push({ match, isHome });
  }
  return rows;
}

function recencyWeights(n) {
  const w = [];
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const v = 0.8 ** (n - 1 - i);
    w.push(v);
    s += v;
  }
  return w.map((v) => v / (s || 1));
}

function formStats(history, team) {
  const rows = matchesFor(history, team);
  if (!rows.length) {
    return { attack: LEAGUE_AVG, defense: LEAGUE_AVG, n: 0, drawRate: 0.27, winRate: 0.33, gf: 0, ga: 0 };
  }
  const w = recencyWeights(rows.length);
  let scored = 0;
  let conceded = 0;
  let draws = 0;
  let wins = 0;
  let gf = 0;
  let ga = 0;
  rows.forEach((row, i) => {
    const gFor = row.isHome ? row.match.homeGoals : row.match.awayGoals;
    const gAg = row.isHome ? row.match.awayGoals : row.match.homeGoals;
    scored += gFor * w[i];
    conceded += gAg * w[i];
    gf += gFor;
    ga += gAg;
    if (gFor === gAg) draws += w[i];
    if (gFor > gAg) wins += w[i];
  });
  return {
    attack: scored,
    defense: conceded,
    n: rows.length,
    drawRate: draws,
    winRate: wins,
    gf,
    ga,
  };
}

function buildElo(history) {
  const ratings = new Map();
  const get = (id) => ratings.get(id) ?? ELO_START;
  for (const match of history) {
    const h = String(match.homeId || match.homeTeam);
    const a = String(match.awayId || match.awayTeam);
    const rh = get(h);
    const ra = get(a);
    const expected = 1 / (1 + 10 ** ((ra - rh) / 400));
    let score = 0.5;
    if (match.result === 'HOME_WIN' || (match.homeGoals != null && match.homeGoals > match.awayGoals)) score = 1;
    else if (match.result === 'AWAY_WIN' || (match.awayGoals != null && match.awayGoals > match.homeGoals)) score = 0;
    ratings.set(h, rh + ELO_K * (score - expected));
    ratings.set(a, ra + ELO_K * (1 - score - (1 - expected)));
  }
  return ratings;
}

function eloProbs(rh, ra) {
  const expected = 1 / (1 + 10 ** ((ra - rh) / 400));
  const gap = Math.abs(rh - ra);
  const pDraw = clamp(0.3 * Math.exp(-gap / 280), 0.18, 0.34);
  return {
    home: (1 - pDraw) * expected,
    draw: pDraw,
    away: (1 - pDraw) * (1 - expected),
  };
}

function dixonColes(lh, la) {
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pOver25 = 0;
  let pGg = 0;
  for (let i = 0; i <= 8; i += 1) {
    for (let j = 0; j <= 8; j += 1) {
      const p = poissonPmf(i, lh) * poissonPmf(j, la) * tau(i, j, lh, la, RHO);
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
      if (i + j >= 3) pOver25 += p;
      if (i > 0 && j > 0) pGg += p;
    }
  }
  const sum = pHome + pDraw + pAway || 1;
  return {
    home: pHome / sum,
    draw: pDraw / sum,
    away: pAway / sum,
    ov25: pOver25,
    un25: 1 - pOver25,
    gg: pGg,
    ng: 1 - pGg,
  };
}

function h2h(history, home, away) {
  let n = 0;
  let draws = 0;
  let homeWins = 0;
  let awayWins = 0;
  for (const match of history) {
    const same =
      (match.homeId === home.id && match.awayId === away.id) ||
      (match.homeTeam === home.name && match.awayTeam === away.name);
    const rev =
      (match.homeId === away.id && match.awayId === home.id) ||
      (match.homeTeam === away.name && match.awayTeam === home.name);
    if (!same && !rev) continue;
    n += 1;
    const hg = same ? match.homeGoals : match.awayGoals;
    const ag = same ? match.awayGoals : match.homeGoals;
    if (hg === ag || match.result === 'DRAW') draws += 1;
    else if (hg > ag) homeWins += 1;
    else awayWins += 1;
  }
  return n
    ? { n, draw: draws / n, home: homeWins / n, away: awayWins / n }
    : { n: 0, draw: 0.27, home: 0.365, away: 0.365 };
}

function tableSignal(homeRow, awayRow) {
  const hp = Number(homeRow.points) || 0;
  const ap = Number(awayRow.points) || 0;
  const hPpg = homeRow.ppg != null ? homeRow.ppg : hp / Math.max(1, homeRow.played || 1);
  const aPpg = awayRow.ppg != null ? awayRow.ppg : ap / Math.max(1, awayRow.played || 1);
  const diff = hPpg - aPpg;
  const scale = 1.15;
  const pHomeEdge = 1 / (1 + Math.exp(-diff * scale * 2.2));
  const closeness = Math.exp(-Math.abs(diff) * 2.4);
  const pDraw = clamp(0.2 + 0.16 * closeness, 0.18, 0.36);
  const rest = 1 - pDraw;
  return {
    home: rest * pHomeEdge,
    draw: pDraw,
    away: rest * (1 - pHomeEdge),
    ptsGap: hp - ap,
    posGap: (awayRow.pos || 10) - (homeRow.pos || 10),
  };
}

function mix3(a, b, c, wa, wb, wc) {
  const w = wa + wb + wc || 1;
  return {
    home: (wa * a.home + wb * b.home + wc * c.home) / w,
    draw: (wa * a.draw + wb * b.draw + wc * c.draw) / w,
    away: (wa * a.away + wb * b.away + wc * c.away) / w,
  };
}

function applyCorrections(probs, corr) {
  const damp = corr.favoriteDamp || 0.18;
  const floor = corr.drawFloor || 0.22;
  const nudge = corr.homeNudge || 0;
  let home = probs.home * (1 - damp) + (1 / 3) * damp;
  let away = probs.away * (1 - damp) + (1 / 3) * damp;
  let draw = probs.draw * (1 - damp) + (1 / 3) * damp;
  home += nudge;
  away -= nudge;
  draw = Math.max(draw, floor);
  const sum = home + away + draw || 1;
  return { home: home / sum, draw: draw / sum, away: away / sum };
}

function predictPair(homeInput, awayInput) {
  const home = resolve(homeInput);
  const away = resolve(awayInput);
  const history = getBuffer();
  const corr = getCorrections();
  const h = formStats(history, home);
  const a = formStats(history, away);
  const homeTable = lookupStanding(home.id || home.name);
  const awayTable = lookupStanding(away.id || away.name);
  const table = tableSignal(homeTable, awayTable);

  const histN = Math.min(h.n, a.n);
  const histTrust = clamp(histN / 8, 0.15, 1);
  const lambdaHome = clamp(
    (h.n ? h.attack : LEAGUE_AVG) * ((a.n ? a.defense : LEAGUE_AVG) / LEAGUE_AVG) * 1.05,
    0.45,
    3.2
  );
  const lambdaAway = clamp(
    (a.n ? a.attack : LEAGUE_AVG) * ((h.n ? h.defense : LEAGUE_AVG) / LEAGUE_AVG),
    0.4,
    3.1
  );
  const dc = dixonColes(lambdaHome, lambdaAway);
  const elo = buildElo(history);
  const eloP = eloProbs(elo.get(String(home.id)) ?? ELO_START, elo.get(String(away.id)) ?? ELO_START);
  const pair = h2h(history, home, away);

  const dcDraw = clamp(0.55 * dc.draw + 0.25 * ((h.drawRate + a.drawRate) / 2) + 0.2 * pair.draw, 0.16, 0.38);
  const dcMix = { home: dc.home, draw: dcDraw, away: dc.away };

  const mixed = mix3(table, dcMix, eloP, 0.42, 0.38 * histTrust + 0.12, 0.18 * histTrust + 0.08);
  const corrected = applyCorrections(mixed, corr);
  const h2hPull = pair.n >= 3 ? 0.08 : 0;
  let homeP = corrected.home * (1 - h2hPull) + pair.home * h2hPull;
  let awayP = corrected.away * (1 - h2hPull) + pair.away * h2hPull;
  let drawP = corrected.draw * (1 - h2hPull) + pair.draw * h2hPull;
  const sum = homeP + awayP + drawP || 1;

  return {
    home: homeP / sum,
    draw: drawP / sum,
    away: awayP / sum,
    ov25: dc.ov25,
    un25: dc.un25,
    gg: dc.gg,
    ng: dc.ng,
    lambdaHome: Number(lambdaHome.toFixed(3)),
    lambdaAway: Number(lambdaAway.toFixed(3)),
    samples: { home: h.n, away: a.n, h2h: pair.n },
    table: { home: homeTable, away: awayTable, ptsGap: table.ptsGap },
    corrections: corr,
    components: { table, dixonColes: dcMix, elo: eloP, h2h: pair },
    engine: 'table+history ML (no club-size bias) + gameweek correction',
    seasonId: getStandings().seasonId,
  };
}

function predictMatchday(payload) {
  const fixtures = payload.fixtures || [];
  const rows = fixtures.map((fixture, index) => {
    const model = predictPair(fixture.homeId || fixture.homeTeam, fixture.awayId || fixture.awayTeam);
    const ranked = [
      { result: 'HOME_WIN', p: model.home },
      { result: 'DRAW', p: model.draw },
      { result: 'AWAY_WIN', p: model.away },
    ].sort((a, b) => b.p - a.p);
    return {
      fixtureId: fixture.fixtureId || `odi-${payload.week || 'x'}-${index}`,
      home: fixture.homeTeam,
      away: fixture.awayTeam,
      pick: ranked[0].result,
      confidence: ranked[0].p,
      model,
    };
  });
  return {
    schema: 'virtualTOP$DC.odiLeague.strategy.predict.v1',
    engine: 'custom /v1/strategy',
    seasonId: payload.seasonId || getStandings().seasonId,
    week: Number(payload.week) || null,
    title: payload.week ? `#English League WEEK ${payload.week} - #${payload.seasonId || getStandings().seasonId}` : null,
    note: 'Strength from live table + official previous matches. Brand-size ratings are ignored. RNG upsets are damped via graded weeks.',
    corrections: getCorrections(),
    rows,
  };
}

module.exports = { predictPair, predictMatchday, formStats, tableSignal };
