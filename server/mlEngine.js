const { predictPair, formStats } = require('./strategyEngine');
const { getParams, applyLogit, applyTemperature } = require('./learner');
const { getBuffer } = require('./buffers');
const { findTeam, clamp } = require('./catalog');

function resolve(idOrName) {
  return findTeam(idOrName) || { id: String(idOrName), name: String(idOrName) };
}

function mlFeatures(model, home, away) {
  const history = getBuffer();
  const h = formStats(history, home);
  const a = formStats(history, away);
  const tableH = model.components?.table?.home || 0;
  const dcH = model.components?.dixonColes?.home || 0;
  return [
    1,
    tableH - 1 / 3,
    dcH - 1 / 3,
    ((model.lambdaHome || 1.3) - (model.lambdaAway || 1.2)) / 3,
    (h.winRate || 0) - (a.winRate || 0),
    ((h.gf || 0) - (h.ga || 0) - ((a.gf || 0) - (a.ga || 0))) / 8,
  ];
}

function ensemblePredict(homeInput, awayInput) {
  const home = resolve(homeInput);
  const away = resolve(awayInput);
  const model = predictPair(home, away);
  const x = mlFeatures(model, home, away);
  const ml = applyLogit(x);
  const n = getParams().n || 0;
  const mixW = n < 80 ? 0.06 : n < 160 ? 0.14 : 0.22;
  let homeP = (1 - mixW) * model.home + mixW * ml.home;
  let drawP = (1 - mixW) * model.draw + mixW * ml.draw;
  let awayP = (1 - mixW) * model.away + mixW * ml.away;
  const blended = applyTemperature(
    { home: homeP, draw: drawP, away: awayP },
    Math.max(0.95, getParams().temperature || 1)
  );
  homeP = clamp(blended.home, 0.05, 0.95);
  drawP = clamp(blended.draw, 0.05, 0.95);
  awayP = clamp(blended.away, 0.05, 0.95);
  const z = homeP + drawP + awayP || 1;
  return {
    ...model,
    home: homeP / z,
    draw: drawP / z,
    away: awayP / z,
    ml,
    mlFeatures: x,
    mlWeight: mixW,
    engine: 'stack + online logit (table/DC/λ/form)',
  };
}

module.exports = { ensemblePredict };
