const { COMPETITION_ID, ODIBET_VIRTUALS, parseKenyaTime } = require('./catalog');

const oddsCache = new Map();
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function odibetGet(params, timeoutMs = 8000) {
  const url = new URL(ODIBET_VIRTUALS);
  url.searchParams.set('competition_id', String(params.competition_id || COMPETITION_ID));
  url.searchParams.set('resource', 'virtuals');
  url.searchParams.set('platform', 'desktop');
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '' || key === 'competition_id') continue;
    url.searchParams.set(key, String(value));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        Origin: 'https://odibets.com',
        Referer: 'https://odibets.com/league',
        'User-Agent': UA,
      },
    });
    if (!res.ok) {
      const err = new Error(`OdiLeague HTTP ${res.status}`);
      err.code = 'ERR_ODILEAGUE_TIMEOUT';
      throw err;
    }
    const json = await res.json();
    if (!json || json.status_code !== 200) {
      const err = new Error(json?.status_description || 'OdiLeague feed rejected the request');
      err.code = 'ERR_ODILEAGUE_TIMEOUT';
      throw err;
    }
    return json.data || {};
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeout = new Error('OdiLeague feed connection timed out');
      timeout.code = 'ERR_ODILEAGUE_TIMEOUT';
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function oddFromOutcomes(outcomes, keys) {
  if (!Array.isArray(outcomes)) return null;
  const hit = outcomes.find((row) => keys.includes(String(row.outcome_id)) || keys.includes(String(row.outcome_key)));
  const value = Number(hit?.odd_value);
  return value > 1 ? value : null;
}

function extractOdds(match) {
  const markets = Array.isArray(match.markets) ? match.markets : [];
  const byId = {};
  for (const market of markets) byId[market.sub_type_id] = market.outcomes || [];
  const home = oddFromOutcomes(byId['1X2'], ['1']);
  const draw = oddFromOutcomes(byId['1X2'], ['X']);
  const away = oddFromOutcomes(byId['1X2'], ['2']);
  const gg = oddFromOutcomes(byId.GG, ['Y', 'Yes', 'GG']);
  const ng = oddFromOutcomes(byId.GG, ['N', 'No', 'NG']);
  const ov25 = oddFromOutcomes(byId.TG25, ['O', 'Over', 'OV', '2']);
  const un25 = oddFromOutcomes(byId.TG25, ['U', 'Under', 'UN', '1']);
  const odds = { home, draw, away, gg, ng, ov25, un25 };
  const complete = home && draw && away;
  if (complete) oddsCache.set(String(match.parent_match_id), odds);
  return complete ? odds : oddsCache.get(String(match.parent_match_id)) || odds;
}

function parseScore(result) {
  const text = String(result || '').replace(/[-–]/g, ':');
  const parts = text.split(':').map((n) => Number.parseInt(n, 10));
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return { home: null, away: null, text: result || '0:0' };
  return { home: parts[0], away: parts[1], text: `${parts[0]}:${parts[1]}` };
}

function flattenResults(rounds) {
  const rows = [];
  for (const round of rounds || []) {
    for (const match of round.matches || []) {
      const score = parseScore(match.result);
      if (score.home == null) continue;
      let result = 'DRAW';
      if (score.home > score.away) result = 'HOME_WIN';
      else if (score.away > score.home) result = 'AWAY_WIN';
      const week = Number(round.round_number || round.round_id);
      rows.push({
        fixtureId: String(match.parent_match_id),
        product: 'OdiLeague',
        league: 'english',
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        homeId: match.home_id,
        awayId: match.away_id,
        homeGoals: score.home,
        awayGoals: score.away,
        result,
        startTime: round.start_time,
        seasonId: String(round.season_id || ''),
        week: Number.isFinite(week) ? week : null,
        settledAt: parseKenyaTime(round.end_time || round.start_time).toISOString(),
        engine: 'ODIBET_RNG',
      });
    }
  }
  return rows;
}

async function fetchSnapshot(selectedStart) {
  const live = await odibetGet({ level: 1 });
  const periods = live.periods || [];
  const now = Date.now();
  const decorated = periods.map((period) => {
    const start = parseKenyaTime(period.start_time);
    const end = parseKenyaTime(period.end_time);
    const untilStart = (start.getTime() - now) / 1000;
    const untilEnd = (end.getTime() - now) / 1000;
    let phase = 'upcoming';
    if (untilStart <= 0 && untilEnd > 0) phase = 'live';
    else if (untilEnd <= 0 && untilEnd > -20) phase = 'ended';
    else if (untilStart > 0) phase = 'upcoming';
    else phase = 'ended';
    return { ...period, start, end, untilStart, untilEnd, phase };
  });

  const livePeriod = decorated.find((p) => p.phase === 'live');
  const nextPeriod = decorated.filter((p) => p.phase === 'upcoming').sort((a, b) => a.start - b.start)[0];
  const requested =
    decorated.find((p) => p.start_time === selectedStart) ||
    livePeriod ||
    nextPeriod ||
    decorated[0];
  const activePeriod = requested;

  let matches = live.matches || [];
  if (activePeriod?.start_time) {
    try {
      const detailed = await odibetGet({
        period: activePeriod.start_time,
        level: activePeriod.phase === 'live' ? 5 : 3,
      });
      if (detailed.matches?.length) matches = detailed.matches;
    } catch {
      // keep the live payload if the period fetch fails
    }
  }

  if (nextPeriod && livePeriod) {
    try {
      const upcoming = await odibetGet({ period: nextPeriod.start_time, level: 3 });
      for (const match of upcoming.matches || []) extractOdds(match);
    } catch {
      // odds cache is best-effort
    }
  }

  let results = [];
  let standings = [];
  try {
    const stats = await odibetGet({ tab: 'results' });
    results = flattenResults(stats.results || []);
  } catch {
    results = [];
  }
  try {
    const table = await odibetGet({ tab: 'standings' });
    standings = table.standings || [];
  } catch {
    standings = [];
  }

  return {
    live,
    matches,
    decorated,
    livePeriod,
    nextPeriod,
    activePeriod,
    results,
    standings,
    meta: live.meta || {},
  };
}

module.exports = { fetchSnapshot, extractOdds, parseScore, flattenResults, odibetGet };
