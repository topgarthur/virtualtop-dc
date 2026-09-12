const MAX_LOGS = 250;
const logs = [];
const sseClients = new Set();

function prune() {
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
}

function pushLog(entry) {
  const row = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ts: new Date().toISOString(),
    ...entry,
  };
  logs.push(row);
  prune();
  const payload = `data: ${JSON.stringify(row)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      sseClients.delete(client);
    }
  }
  return row;
}

function getLogs() {
  return logs.slice(-200);
}

function attachSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ hello: true, recent: getLogs().slice(-20) })}\n\n`);
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

module.exports = { pushLog, getLogs, attachSse };
