const { BUFFER_SIZE, findTeam, TEAMS } = require('./catalog');

const priors = new Map();

function keyFor(teamId) {
  return teamId;
}

function initPrior(_team) {
  return { alpha: 8, beta: 8, observations: 0, entropyTrace: [] };
}

function getPrior(teamId) {
  if (!priors.has(teamId)) {
    const team = findTeam(teamId) || { id: teamId, rating: 50 };
    priors.set(teamId, initPrior(team));
  }
  return priors.get(teamId);
}

function posteriorMean(prior) {
  return prior.alpha / (prior.alpha + prior.beta);
}

function ratingFromPrior(prior, _baseRating = 50) {
  const mu = posteriorMean(prior);
  return Number((50 + 40 * (mu - 0.5)).toFixed(3));
}

function shannonEntropy(probs) {
  return Number(
    probs
      .filter((p) => p > 0)
      .reduce((sum, p) => sum - p * Math.log2(p), 0)
      .toFixed(4)
  );
}

function observeOutcome(teamId, resultRole) {
  const prior = getPrior(teamId);
  if (resultRole === 'win') prior.alpha += 1;
  else if (resultRole === 'loss') prior.beta += 1;
  else {
    prior.alpha += 0.35;
    prior.beta += 0.35;
  }
  prior.observations += 1;
  if (prior.entropyTrace.length > BUFFER_SIZE) prior.entropyTrace.shift();
  return prior;
}

function applySettledMatch(match) {
  const home = findTeam(match.homeId || match.homeTeam);
  const away = findTeam(match.awayId || match.awayTeam);
  if (!home || !away) return;
  if (match.result === 'HOME_WIN') {
    observeOutcome(home.id, 'win');
    observeOutcome(away.id, 'loss');
  } else if (match.result === 'AWAY_WIN') {
    observeOutcome(home.id, 'loss');
    observeOutcome(away.id, 'win');
  } else {
    observeOutcome(home.id, 'draw');
    observeOutcome(away.id, 'draw');
  }
}

function snapshotRatings() {
  const out = {};
  for (const team of TEAMS) {
    const prior = getPrior(team.id);
    out[team.id] = {
      name: team.name,
      R: ratingFromPrior(prior, 50),
      mu: Number(posteriorMean(prior).toFixed(4)),
      alpha: Number(prior.alpha.toFixed(3)),
      beta: Number(prior.beta.toFixed(3)),
      n: prior.observations,
    };
  }
  return out;
}

function resetPriors() {
  priors.clear();
}

module.exports = {
  getPrior,
  posteriorMean,
  ratingFromPrior,
  shannonEntropy,
  applySettledMatch,
  snapshotRatings,
  resetPriors,
};
