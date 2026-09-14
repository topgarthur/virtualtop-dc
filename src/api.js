export const API_BASE = process.env.REACT_APP_API_BASE || '';

function extraHeaders() {
  try {
    const key = localStorage.getItem('vtop.adminKey');
    return key ? { 'x-admin-key': key } : {};
  } catch {
    return {};
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...extraHeaders(), ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error(
      'API not found — this site was hosted as a static page (Vercel). Deploy the Node server so /v1 stays on the same host.'
    );
    err.code = 'ERR_API_MISSING';
    throw err;
  }
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status})`);
    err.code = data.error || 'ERR_CLIENT';
    throw err;
  }
  return data;
}

export function fetchSync(period, options = {}) {
  const params = new URLSearchParams();
  if (period) params.set('period', period);
  if (options.lite) params.set('lite', '1');
  const q = params.toString() ? `?${params.toString()}` : '';
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

export function fetchResults() {
  return request('/v1/virtual/odileague/english/results');
}

export function overrideStake(body) {
  return request('/v1/strategy/override', { method: 'POST', body: JSON.stringify(body) });
}
