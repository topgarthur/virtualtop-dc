const { PRODUCT, LEAGUE, findTeam, formatClock, formatCountdown, virtualRemaining } = require('./catalog');
const { fetchSnapshot, extractOdds, parseScore } = require('./odibetClient');
const { setStandings } = require('./standingsCache');
const { gradeResults, summary } = require('./roundTracker');

function resolveTeam(id, name) {
  return findTeam(id) || findTeam(name) || { id: String(id || name), name: String(name || id), rating: 50 };
}

function mapFixture(match, phase) {
  const home = resolveTeam(match.home_id || match.homeId, match.home_team || match.homeTeam);
  const away = resolveTeam(match.away_id || match.awayId, match.away_team || match.awayTeam);
  const odds = extractOdds(match);
  const score = parseScore(match.result);
  const live = Number(match.status) === 1 || phase === 'live';
  return {
    fixtureId: String(match.parent_match_id || match.fixtureId),
    homeId: home.id,
    awayId: away.id,
    homeTeam: home.name,
    awayTeam: away.name,
    homeName: home.name,
    awayName: away.name,
    odds: {
      home: odds.home || 0,
      draw: odds.draw || 0,
      away: odds.away || 0,
      ov25: odds.ov25,
      un25: odds.un25,
      gg: odds.gg,
      ng: odds.ng,
    },
    live,
    score: score.text,
    homeGoals: score.home,
    awayGoals: score.away,
    startTime: match.start_time,
    endTime: match.end_time,
    seasonId: match.season_id,
    roundId: match.round_id || match.rid,
    week: Number(match.round_number || 0) || null,
  };
}

async function syncEnglish(selectedStart) {
  const snap = await fetchSnapshot(selectedStart);
  const focus = snap.activePeriod;
  const nowEvent = snap.livePeriod || snap.nextPeriod || focus;
  const phase = focus?.phase === 'live' ? 'live' : focus?.phase === 'upcoming' ? 'prematch' : 'intermission';
  const countdownSeconds = Math.max(0, Math.ceil(virtualRemaining(nowEvent)));
  const matchdayTime = focus ? formatClock(focus.start) : '--:--';
  const rail = (snap.decorated || [])
    .filter((period) => period.phase !== 'ended')
    .slice(0, 16)
    .map((period) => ({
      startTime: period.start_time,
      clock: formatClock(period.start),
      phase: period.phase,
      untilStart: Math.ceil(Number.isFinite(period.untilStart) ? period.untilStart : 0),
      countdownLabel: formatCountdown(virtualRemaining(period)),
    }));
  const standings = setStandings(snap.standings, focus?.season_id || snap.matches[0]?.season_id, Number(focus?.round_number || 0));
  const week = Number(focus?.round_number || snap.matches[0]?.round_number || 0) || null;
  const fixtures = (snap.matches || []).map((match) => ({
    ...mapFixture(match, phase),
    week: Number(match.round_number || week) || week,
  }));
  const seasonId = standings.seasonId;

  return {
    schema: 'virtualTOP$DC.odiLeague.sync.v1',
    product: PRODUCT,
    league: LEAGUE,
    seasonId,
    week,
    roundLabel: week ? `#English League WEEK ${week} - #${seasonId}` : `#English League - #${seasonId}`,
    phase,
    matchdayTime,
    selectedPeriod: focus?.start_time || null,
    lastKickoff: snap.livePeriod ? formatClock(snap.livePeriod.start) : matchdayTime,
    nextEventAt: (snap.nextPeriod || focus)?.start?.toISOString?.() || null,
    countdownSeconds,
    countdownLabel: formatCountdown(countdownSeconds),
    countdownClock: nowEvent ? formatClock(nowEvent.start) : matchdayTime,
    cycleTabs: rail.map((row) => row.clock),
    periods: rail,
    liveMinute: nowEvent?.phase === 'live'
      ? Math.max(0, Math.min(35, Math.floor(-(nowEvent.untilStart || 0))))
      : 0,
    generatedAt: new Date().toISOString(),
    source: 'odibets.com/pxy2/virtuals',
    fixtures,
    standings: standings.rows,
    results: snap.results,
    strategy: (gradeResults(snap.results), summary()),
  };
}

module.exports = {
  syncEnglish,
  formatCountdown,
};
