const { findTeam } = require('./catalog');
const { pushActualized } = require('./buffers');
const { applySettledMatch } = require('./bayesian');
const { odibetGet, flattenResults } = require('./odibetClient');
const { setStandings } = require('./standingsCache');
const { pushLog } = require('./logger');

async function seedHistory() {
  try {
    const [resultsPayload, tablePayload] = await Promise.all([
      odibetGet({ tab: 'results' }),
      odibetGet({ tab: 'standings' }),
    ]);
    const results = flattenResults(resultsPayload.results || []);
    setStandings(tablePayload.standings || [], tablePayload.standings?.[0]?.season_id);
    for (const match of results) {
      const home = findTeam(match.homeId || match.homeTeam);
      const away = findTeam(match.awayId || match.awayTeam);
      const row = { ...match, homeId: home?.id || match.homeId, awayId: away?.id || match.awayId };
      if (!pushActualized(row)) continue;
      applySettledMatch(row);
    }
    pushLog({
      level: 'info',
      type: 'seed',
      message: `Seeded ${results.length} official Odibet results and live standings for season analysis.`,
    });
  } catch (err) {
    pushLog({
      level: 'warn',
      type: 'seed',
      message: `Live seed skipped (${err.message}). Using last known English League table snapshot.`,
    });
  }
}

module.exports = { seedHistory };
