const { findTeam, clamp } = require('./catalog');
const { getBuffer } = require('./buffers');

function poissonPmf(k, lambda) {
  const lam = Math.max(0.05, lambda);
  let p = Math.exp(-lam);
  for (let i = 1; i <= k; i += 1) p *= lam / i;
  return p;
}

function teamGoalRates(history, team) {
  const name = team?.name;
  const id = team?.id;
  let scored = 0;
  let conceded = 0;
  let n = 0;
  for (const match of history) {
    const isHome = match.homeId === id || match.homeTeam === name;
    const isAway = match.awayId === id || match.awayTeam === name;
    if (!isHome && !isAway) continue;
    const gf = isHome ? match.homeGoals : match.awayGoals;
    const ga = isHome ? match.awayGoals : match.homeGoals;
    if (gf == null || ga == null) continue;
    scored += gf;
    conceded += ga;
    n += 1;
  }
  if (!n) return { attack: 1.35, defense: 1.35, n: 0 };
  return { attack: scored / n, defense: conceded / n, n };
}

function predictPoisson(homeInput, awayInput) {
  const home = findTeam(homeInput) || { name: homeInput, rating: 50 };
  const away = findTeam(awayInput) || { name: awayInput, rating: 50 };
  const history = getBuffer();
  const h = teamGoalRates(history, home);
  const a = teamGoalRates(history, away);
  const leagueAvg = 1.35;
  const homeAdv = 1.08;
  const lambdaHome = clamp(h.attack * (a.defense / leagueAvg) * homeAdv, 0.35, 3.6);
  const lambdaAway = clamp(a.attack * (h.defense / leagueAvg), 0.3, 3.4);

  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pOver25 = 0;
  let pGg = 0;
  const max = 8;
  for (let i = 0; i <= max; i += 1) {
    for (let j = 0; j <= max; j += 1) {
      const p = poissonPmf(i, lambdaHome) * poissonPmf(j, lambdaAway);
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
    lambdaHome: Number(lambdaHome.toFixed(3)),
    lambdaAway: Number(lambdaAway.toFixed(3)),
    samples: { home: h.n, away: a.n },
  };
}

module.exports = { predictPoisson, poissonPmf };
