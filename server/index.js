const express = require('express');
const cors = require('cors');
const { syncEnglish } = require('./odileague');
const { analyzeMatchday, analyzeFixture } = require('./analyze');
const { getLogs, attachSse, pushLog } = require('./logger');
const { startWorker, stopWorker, getStatus } = require('./worker');
const { seedHistory } = require('./seed');
const { getStandings } = require('./standingsCache');
const { predictMatchday } = require('./strategyEngine');
const { summary, getRound } = require('./roundTracker');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'virtualTOP$DC', edition: 'OdiLeague RNG Analytics', version: 'v1' });
});

app.get('/v1/virtual/odileague/english/sync', async (req, res) => {
  try {
    const snapshot = await syncEnglish(req.query.period || req.query.round);
    return res.json(snapshot);
  } catch (err) {
    return res.status(502).json({
      error: err.code || 'ERR_ODILEAGUE_TIMEOUT',
      message: err.message,
    });
  }
});

app.get('/v1/virtual/odileague/english/standings', (_req, res) => {
  res.json(getStandings());
});

app.get('/v1/strategy', (_req, res) => {
  res.json({
    schema: 'virtualTOP$DC.odiLeague.strategy.v1',
    engine: 'table+history ML (no club-size bias) + gameweek correction',
    endpoints: {
      predict: 'POST /v1/strategy/predict',
      rounds: 'GET /v1/strategy/rounds',
      round: 'GET /v1/strategy/rounds/:seasonId/:week',
    },
    ...summary(),
  });
});

app.post('/v1/strategy/predict', (req, res) => {
  try {
    return res.json(predictMatchday(req.body || {}));
  } catch (err) {
    return res.status(422).json({ error: 'ERR_STRATEGY', message: err.message });
  }
});

app.get('/v1/strategy/rounds', (_req, res) => {
  res.json(summary());
});

app.get('/v1/strategy/rounds/:seasonId/:week', (req, res) => {
  const card = getRound(req.params.seasonId, req.params.week);
  if (!card) return res.status(404).json({ error: 'ERR_ROUND', message: 'No stored card for that week' });
  return res.json(card);
});

app.post('/v1/bot/analyze', (req, res) => {
  try {
    const body = req.body || {};
    if (Array.isArray(body.fixtures)) {
      return res.json(analyzeMatchday(body));
    }
    if (body.homeTeam || body.homeId) {
      return res.json(analyzeFixture(body));
    }
    return res.status(400).json({
      error: 'ERR_BAD_PAYLOAD',
      message: 'Expected { matchdayTime, fixtures: [...] }',
    });
  } catch (err) {
    return res.status(422).json({ error: err.code || 'ERR_ANALYZE', message: err.message });
  }
});

app.post('/v1/bot/control', (req, res) => {
  const { action } = req.body || {};
  try {
    if (action === 'START') return res.json(startWorker());
    if (action === 'STOP') return res.json(stopWorker());
    return res.status(400).json({ error: 'ERR_BAD_ACTION', message: 'action must be START | STOP' });
  } catch (err) {
    return res.status(400).json({ error: err.code || 'ERR_CONTROL', message: err.message });
  }
});

app.get('/v1/bot/status', (_req, res) => {
  res.json(getStatus());
});

app.get('/v1/bot/logs', (req, res) => {
  if (req.query.stream === '1' || req.headers.accept === 'text/event-stream') {
    return attachSse(res);
  }
  res.json({ logs: getLogs() });
});

const port = Number(process.env.PORT || 4000);
seedHistory()
  .then(() => {
    pushLog({
      level: 'info',
      type: 'boot',
      message: 'virtualTOP$DC online — live Odibet English League sync (fixtures + standings + draws).',
    });
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`virtualTOP$DC OdiLeague API listening on http://localhost:${port}/v1`);
    });
  })
  .catch((err) => {
    pushLog({ level: 'warn', type: 'boot', message: `Boot seed warning: ${err.message}` });
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`virtualTOP$DC OdiLeague API listening on http://localhost:${port}/v1`);
    });
  });
