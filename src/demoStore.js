import { demoBetWon, parseScore } from './demoGrade';

export const DEMO_KEY = 'virtualtop$dc.demo.v1';

export function emptyDemo() {
  return { bets: [] };
}

export function loadDemo() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEMO_KEY) || '');
    if (parsed && Array.isArray(parsed.bets)) return parsed;
  } catch {
    // first visit on this device
  }
  return emptyDemo();
}

export function saveDemo(state) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(state));
  } catch {
    // private mode may block it
  }
  return state;
}

export function demoStats(bets) {
  const list = bets || [];
  const won = list.filter((row) => row.status === 'won').length;
  const lost = list.filter((row) => row.status === 'lost').length;
  const open = list.filter((row) => row.status === 'open').length;
  return {
    played: list.length,
    won,
    lost,
    open,
    staked: list.reduce((sum, row) => sum + Number(row.stake || 0), 0),
    returned: list.reduce((sum, row) => sum + Number(row.payout || 0), 0),
  };
}

function rememberScore(byId, byPair, id, home, away, hg, ag) {
  if (hg == null || ag == null || Number.isNaN(Number(hg)) || Number.isNaN(Number(ag))) return;
  const parsed = { home: Number(hg), away: Number(ag) };
  if (id) byId.set(String(id), parsed);
  if (home && away) byPair.set(`${String(home).toLowerCase()}|${String(away).toLowerCase()}`, parsed);
}

export function settleDemoBets(bets, { results = [], segments = [], feed = [] } = {}) {
  const byId = new Map();
  const byPair = new Map();
  for (const match of results) {
    rememberScore(byId, byPair, match.fixtureId, match.homeTeam, match.awayTeam, match.homeGoals, match.awayGoals);
  }
  for (const card of segments) {
    for (const pick of card.picks || []) {
      const parsed = parseScore(pick.score);
      rememberScore(
        byId,
        byPair,
        pick.fixtureId,
        pick.home,
        pick.away,
        parsed?.home ?? pick.homeGoals,
        parsed?.away ?? pick.awayGoals
      );
    }
  }
  for (const row of feed) {
    const fixture = row.fixture || row;
    if (fixture.live) continue;
    const parsed = parseScore(fixture.score);
    if (!parsed) continue;
    rememberScore(
      byId,
      byPair,
      fixture.fixtureId,
      fixture.homeTeam || fixture.homeName,
      fixture.awayTeam || fixture.awayName,
      parsed.home,
      parsed.away
    );
  }

  let changed = false;
  const next = bets.map((bet) => {
    if (bet.status !== 'open') return bet;
    const hit =
      byId.get(String(bet.fixtureId)) ||
      byPair.get(`${String(bet.home).toLowerCase()}|${String(bet.away).toLowerCase()}`);
    if (!hit) return bet;
    const won = demoBetWon(bet, hit.home, hit.away);
    changed = true;
    return {
      ...bet,
      status: won ? 'won' : 'lost',
      score: `${hit.home}:${hit.away}`,
      settledAt: new Date().toISOString(),
      payout: won ? Number((Number(bet.stake) * Number(bet.odds)).toFixed(2)) : 0,
    };
  });
  return { bets: next, changed };
}
