const { findTeam, normalizeName } = require('./catalog');

const FALLBACK = [
  { pos: 1, team_name: 'FULHAM', points: 3, team_form: 'W' },
  { pos: 2, team_name: 'London Reds', points: 3, team_form: 'W' },
  { pos: 3, team_name: 'WEST BROM', points: 3, team_form: 'W' },
  { pos: 4, team_name: 'Manchester Blue', points: 3, team_form: 'W' },
  { pos: 5, team_name: 'Southampton', points: 3, team_form: 'W' },
  { pos: 6, team_name: 'ASTON V', points: 3, team_form: 'W' },
  { pos: 7, team_name: 'Manchester Reds', points: 3, team_form: 'W' },
  { pos: 8, team_name: 'Newcastle', points: 3, team_form: 'W' },
  { pos: 9, team_name: 'Everton', points: 1, team_form: 'D' },
  { pos: 10, team_name: 'West Ham', points: 1, team_form: 'D' },
  { pos: 11, team_name: 'Brighton', points: 1, team_form: 'D' },
  { pos: 12, team_name: 'SHEFFIELD U', points: 1, team_form: 'D' },
  { pos: 13, team_name: 'Palace', points: 0, team_form: 'L' },
  { pos: 14, team_name: 'Tottenham', points: 0, team_form: 'L' },
  { pos: 15, team_name: 'Leicester', points: 0, team_form: 'L' },
  { pos: 16, team_name: 'Wolves', points: 0, team_form: 'L' },
  { pos: 17, team_name: 'Liverpool', points: 0, team_form: 'L' },
  { pos: 18, team_name: 'LEEDS', points: 0, team_form: 'L' },
  { pos: 19, team_name: 'London Blues', points: 0, team_form: 'L' },
  { pos: 20, team_name: 'Burnley', points: 0, team_form: 'L' },
];

let seasonId = '2026091202';
let weekPlayed = 1;
let table = FALLBACK.map((row) => ({ ...row }));

function rank(rows) {
  const listed = [...rows];
  const hasPos = listed.some((row) => row.pos != null || row.position != null);
  if (hasPos) listed.sort((a, b) => Number(a.pos || a.position || 99) - Number(b.pos || b.position || 99));
  else listed.sort((a, b) => Number(b.points) - Number(a.points) || String(a.team_name).localeCompare(String(b.team_name)));
  return listed.map((row, index) => {
    const team = findTeam(row.team_id || row.team_name);
    const played = Number(row.played || row.p || row.games) || weekPlayed;
    const points = Number(row.points) || 0;
    const form = row.team_form || row.form || '';
    return {
      pos: Number(row.pos || row.position) || index + 1,
      team_id: team?.id || row.team_id || row.team_name,
      team_name: team?.name || row.team_name,
      points,
      played,
      ppg: played ? Number((points / played).toFixed(3)) : points,
      gf: Number(row.gf || row.goals_for || 0),
      ga: Number(row.ga || row.goals_against || 0),
      team_form: form,
    };
  });
}

function setStandings(rows, nextSeason, week) {
  if (nextSeason) seasonId = String(nextSeason);
  if (week) weekPlayed = Math.max(1, Number(week) - (Number(week) > 1 ? 1 : 0));
  if (Array.isArray(rows) && rows.length) table = rank(rows);
  return getStandings();
}

function getStandings() {
  return { seasonId, rows: table };
}

function applyFormFromResults(results) {
  const sorted = [...(results || [])].sort((a, b) => {
    const ta = new Date(a.settledAt || a.startTime || 0).getTime();
    const tb = new Date(b.settledAt || b.startTime || 0).getTime();
    return ta - tb;
  });
  const letters = new Map();
  const push = (name, ch) => {
    const team = findTeam(name);
    const key = normalizeName(team?.name || name);
    if (!key) return;
    const prev = letters.get(key) || [];
    prev.push(ch);
    letters.set(key, prev.slice(-5));
  };
  for (const match of sorted) {
    const hg = Number(match.homeGoals);
    const ag = Number(match.awayGoals);
    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
    const home = hg > ag ? 'W' : hg < ag ? 'L' : 'D';
    const away = ag > hg ? 'W' : ag < hg ? 'L' : 'D';
    push(match.homeTeam, home);
    push(match.awayTeam, away);
  }
  table = table.map((row) => {
    const team = findTeam(row.team_id || row.team_name);
    const key = normalizeName(team?.name || row.team_name);
    const form = letters.get(key);
    return form?.length ? { ...row, team_form: form.join('') } : row;
  });
  return getStandings();
}

function lookupStanding(idOrName) {
  const team = findTeam(idOrName);
  const needle = normalizeName(team?.name || idOrName);
  return table.find((row) => {
    const other = findTeam(row.team_id || row.team_name);
    return normalizeName(row.team_name) === needle || normalizeName(other?.name) === needle;
  }) || { pos: 10, points: 0, played: 0, ppg: 0, team_form: '', team_name: idOrName };
}

module.exports = { setStandings, getStandings, lookupStanding, applyFormFromResults, FALLBACK };
