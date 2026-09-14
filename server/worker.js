const { CIRCUIT_THRESHOLD, BASE_MULTIPLIER_MS, WORKER_INTERVAL_MS, findTeam } = require('./catalog');
const { syncEnglish } = require('./odileague');
const { analyzeMatchday } = require('./analyze');
const { pushActualized, snapshotSizes } = require('./buffers');
const { applySettledMatch, snapshotRatings } = require('./bayesian');
const { getStandings } = require('./standingsCache');
const { pushLog } = require('./logger');
const { gradeResults, lockCard, summary } = require('./roundTracker');
const { rebuildFromHistory } = require('./rngIntel');

const state = {
  running: false,
  consecutiveFailures: 0,
  circuitOpen: false,
  lastTick: null,
  lastSync: null,
  lastPredictions: [],
  lastCardKey: null,
  phase: 'prematch',
  countdownSeconds: 0,
  countdownLabel: '00:00',
  matchdayTime: null,
  timer: null,
};

function backoffDelay(attempt) {
  return 2 ** attempt * BASE_MULTIPLIER_MS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ingestResults(results) {
  let added = 0;
  for (const match of results || []) {
    const home = findTeam(match.homeId || match.homeTeam);
    const away = findTeam(match.awayId || match.awayTeam);
    const row = {
      ...match,
      homeId: home?.id || match.homeId,
      awayId: away?.id || match.awayId,
    };
    if (!pushActualized(row)) continue;
    applySettledMatch(row);
    added += 1;
  }
  if (added) rebuildFromHistory();
  return added;
}

function cardKey(sync) {
  const scores = (sync.fixtures || []).map((row) => `${row.fixtureId}:${row.score}`).join('|');
  return `${sync.phase}|${sync.matchdayTime}|${scores}`;
}

async function fetchWithRecovery() {
  let attempt = 0;
  while (attempt < CIRCUIT_THRESHOLD) {
    try {
      return await syncEnglish();
    } catch (err) {
      attempt += 1;
      const delay = backoffDelay(attempt);
      pushLog({
        level: 'warn',
        type: 'retry',
        code: err.code || 'ERR_ODILEAGUE_TIMEOUT',
        message: `${err.message} — backoff T_delay=${delay}ms (2^${attempt} × ${BASE_MULTIPLIER_MS})`,
        attempt,
        delay,
      });
      if (attempt >= CIRCUIT_THRESHOLD) {
        state.consecutiveFailures += 1;
        state.circuitOpen = true;
        pushLog({
          level: 'critical',
          type: 'circuit',
          message: `Circuit open after ${CIRCUIT_THRESHOLD} consecutive OdiLeague failures. Main thread stays alive.`,
        });
        throw err;
      }
      await sleep(delay);
    }
  }
  throw new Error('Unreachable retry state');
}

async function tick() {
  if (!state.running) return;
  if (state.circuitOpen) {
    if (Math.random() < 0.35) {
      state.circuitOpen = false;
      state.consecutiveFailures = 0;
      pushLog({ level: 'info', type: 'circuit', message: 'Circuit half-open → closed. Resuming Odibet polls.' });
    }
    return;
  }

  try {
    const sync = await fetchWithRecovery();
    const added = ingestResults(sync.results);
    const graded = gradeResults(sync.results);
    if (sync.phase === 'live') lockCard(sync.seasonId, sync.week, sync.matchdayTime);
    state.lastSync = sync;
    state.phase = sync.phase;
    state.countdownSeconds = sync.countdownSeconds;
    state.countdownLabel = sync.countdownLabel;
    state.matchdayTime = sync.matchdayTime;
    state.lastTick = new Date().toISOString();
    state.consecutiveFailures = 0;
    state.circuitOpen = false;

    const key = cardKey(sync);
    if (sync.fixtures?.length && (key !== state.lastCardKey || !state.lastPredictions.length)) {
      const analyzed = analyzeMatchday({
        matchdayTime: sync.matchdayTime,
        fixtures: sync.fixtures,
        seasonId: sync.seasonId,
        week: sync.week,
        phase: sync.phase,
      });
      state.lastPredictions = analyzed.rows;
      state.lastCardKey = key;
      pushLog({
        level: 'success',
        type: 'tick',
        message: `${sync.phase.toUpperCase()} ${sync.roundLabel || sync.matchdayTime} — ${analyzed.count} fixtures, results+${added}`,
      });
    } else if (graded.length) {
      for (const card of graded) {
        pushLog({
          level: 'success',
          type: 'round',
          message: `${card.title}: 1X2 ${card.correct}/${card.wrong} · extra ${(card.easyCorrect || 0)}/${(card.easyWrong || 0)}. Lesson stored.`,
        });
      }
    } else if (added) {
      pushLog({
        level: 'info',
        type: 'results',
        message: `Ingested ${added} official Odibet results into the rolling buffer.`,
      });
    }
  } catch (err) {
    pushLog({
      level: 'error',
      type: 'exception',
      code: err.code || 'ERR_WORKER',
      message: err.message,
    });
  }
}

function startWorker() {
  if (state.running) return getStatus();
  state.running = true;
  pushLog({ level: 'info', type: 'control', message: 'Worker START — polling live Odibet English League' });
  tick();
  state.timer = setInterval(tick, WORKER_INTERVAL_MS);
  return getStatus();
}

function stopWorker() {
  state.running = false;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  pushLog({ level: 'info', type: 'control', message: 'Worker STOP — OdiLeague polling loop halted' });
  return getStatus();
}

function getStatus() {
  return {
    running: state.running,
    product: 'OdiLeague',
    league: 'english',
    phase: state.phase,
    matchdayTime: state.matchdayTime,
    countdownSeconds: state.countdownSeconds,
    countdownLabel: state.countdownLabel,
    circuitOpen: state.circuitOpen,
    consecutiveFailures: state.consecutiveFailures,
    lastTick: state.lastTick,
    lastPredictions: state.lastPredictions,
    lastSync: state.lastSync,
    bufferSizes: snapshotSizes(),
    ratings: snapshotRatings(),
    standings: getStandings(),
    strategy: summary(),
  };
}

module.exports = { startWorker, stopWorker, getStatus, fetchWithRecovery };
