export const API_BASE = process.env.REACT_APP_API_BASE || '';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status})`);
    err.code = data.error || 'ERR_CLIENT';
    throw err;
  }
  return data;
}

export function fetchSync(period) {
  const q = period ? `?period=${encodeURIComponent(period)}` : '';
  return request(`/v1/virtual/odileague/english/sync${q}`);
}

export function analyzeMatchday(payload) {
  return request('/v1/bot/analyze', { method: 'POST', body: JSON.stringify(payload) });
}

export function controlBot(body) {
  return request('/v1/bot/control', { method: 'POST', body: JSON.stringify(body) });
}

export function fetchStatus() {
  return request('/v1/bot/status');
}

export function fetchLogs() {
  return request('/v1/bot/logs');
}

export function fetchStrategy() {
  return request('/v1/strategy');
}

export function fetchRounds() {
  return request('/v1/strategy/rounds');
}
