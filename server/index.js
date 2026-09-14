const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { syncEnglish, fetchOfficialResults } = require('./odileague');
const { analyzeMatchday, analyzeFixture } = require('./analyze');
const { getLogs, attachSse, pushLog } = require('./logger');
const { startWorker, stopWorker, getStatus } = require('./worker');
const { seedHistory } = require('./seed');
const { getStandings } = require('./standingsCache');
const { predictMatchday } = require('./strategyEngine');
const { summary, getRound, setEasyOverride } = require('./roundTracker');
const { getParams } = require('./learner');
const { dataDir } = require('./dataDir');
const { requireAdmin } = require('./adminGate');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
fs.mkdirSync(dataDir(), { recursive: true });

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'virtualTOP$DC', edition: 'OdiLeague RNG Analytics', version: 'v1' });
});

app.get('/v1/virtual/odileague/english/sync', async (req, res) => {
  try {
    const snapshot = await syncEnglish(req.query.period || req.query.round, {
      lite: req.query.lite === '1' || Boolean(req.query.period || req.query.round),
    });
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

app.get('/v1/virtual/odileague/english/results', async (_req, res) => {
  try {
    const results = await fetchOfficialResults();
    return res.json({ results });
  } catch (err) {
    return res.status(502).json({
      error: err.code || 'ERR_RESULTS',
      message: err.message,
      results: [],
    });
  }
});

app.get('/v1/strategy', (_req, res) => {
  res.json({
    schema: 'virtualTOP$DC.odiLeague.strategy.v1',
    engine: 'online stack: table + DC(ρ̂) + Elo + π-ratings + temp scale',
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

app.get('/v1/strategy/learner', (_req, res) => {
  res.json({ schema: 'virtualTOP$DC.odiLeague.learner.v1', ...getParams() });
});

app.get('/v1/strategy/rounds', (_req, res) => {
  res.json(summary());
});

app.get('/v1/strategy/rounds/:seasonId/:week', (req, res) => {
  const card = getRound(req.params.seasonId, req.params.week);
  if (!card) return res.status(404).json({ error: 'ERR_ROUND', message: 'No stored card for that week' });
  return res.json(card);
});

app.post('/v1/strategy/override', requireAdmin, (req, res) => {
  try {
    const card = setEasyOverride(req.body || {});
    if (!card) return res.status(404).json({ error: 'ERR_OVERRIDE', message: 'No card to override' });
    if (card.status === 'graded') {
      return res.status(409).json({ error: 'ERR_GRADED', message: 'That kickoff is already graded' });
    }
    return res.json(card);
  } catch (err) {
    return res.status(422).json({ error: 'ERR_OVERRIDE', message: err.message });
  }
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
    if (action === 'STOP' && process.env.NODE_ENV === 'production') {
      return requireAdmin(req, res, () => res.json(stopWorker()));
    }
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

const buildDir = path.join(__dirname, '..', 'build');
if (fs.existsSync(buildDir)) {
  app.use(express.static(buildDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/v1') || req.path === '/health') {
      return res.status(404).json({ error: 'ERR_NOT_FOUND' });
    }
    return res.sendFile(path.join(buildDir, 'index.html'));
  });
}

function listen() {
  const port = Number(process.env.PORT || 4000);
  const server = app.listen(port, '0.0.0.0', () => {
    startWorker();
    // eslint-disable-next-line no-console
    console.log(`virtualTOP$DC listening on 0.0.0.0:${port} (API /v1, UI from /build when present)`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      // eslint-disable-next-line no-console
      console.log(`Port ${port} is already in use — API is already running. Use that process, or run npm start for the board.`);
      process.exit(0);
    }
    throw err;
  });
}

seedHistory()
  .then(() => {
    pushLog({
      level: 'info',
      type: 'boot',
      message: 'virtualTOP$DC online — live Odibet English League sync (fixtures + standings + draws).',
    });
    listen();
  })
  .catch((err) => {
    pushLog({ level: 'warn', type: 'boot', message: `Boot seed warning: ${err.message}` });
    listen();
  });
