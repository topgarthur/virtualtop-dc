const { predictPair } = require('./strategyEngine');

function ensemblePredict(homeInput, awayInput) {
  return predictPair(homeInput, awayInput);
}

module.exports = { ensemblePredict };
