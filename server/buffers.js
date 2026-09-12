const { BUFFER_SIZE } = require('./catalog');

const history = [];
const seen = new Set();

function getBuffer() {
  return history;
}

function pushActualized(match) {
  const row = match && match.result ? match : arguments[0];
  const id = row?.fixtureId;
  if (id && seen.has(String(id))) return false;
  if (id) seen.add(String(id));
  history.push(row);
  if (history.length > BUFFER_SIZE) history.splice(0, history.length - BUFFER_SIZE);
  return true;
}

function snapshotSizes() {
  return { 'odileague:english': history.length };
}

function swapContext() {
  return history;
}

function flushBuffer() {
  history.length = 0;
  seen.clear();
}

module.exports = {
  getBuffer,
  pushActualized,
  snapshotSizes,
  swapContext,
  flushBuffer,
};
