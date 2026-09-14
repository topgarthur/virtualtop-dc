const LEAGUE = 'english';
const PRODUCT = 'OdiLeague';
const COMPETITION_ID = 1;
const K_RATING = 0.015;
const P_MIN = 0.05;
const P_MAX = 0.95;
const EV_VALUE_THRESHOLD = 0.03;
const BUFFER_SIZE = 400;
const CIRCUIT_THRESHOLD = 3;
const BASE_MULTIPLIER_MS = 400;
const WORKER_INTERVAL_MS = process.env.NODE_ENV === 'production' ? 2500 : 1000;
const VALUE_CLAMP = [P_MIN, P_MAX];
const ODIBET_VIRTUALS = 'https://odibets.com/pxy2/virtuals';

const TEAMS = [
  { id: '1', name: 'Manchester Blue', aliases: ['manchester blue', 'mnc', 'man blue'], rating: 72 },
  { id: '2', name: 'Manchester Reds', aliases: ['manchester reds', 'mnu', 'man red', 'manchester red'], rating: 63 },
  { id: '3', name: 'Liverpool', aliases: ['liverpool', 'liv'], rating: 70 },
  { id: '4', name: 'London Blues', aliases: ['london blues', 'che'], rating: 64 },
  { id: '5', name: 'Tottenham', aliases: ['tottenham', 'tot', 'spurs'], rating: 61 },
  { id: '6', name: 'London Reds', aliases: ['london reds', 'ars'], rating: 68 },
  { id: '7', name: 'Burnley', aliases: ['burnley'], rating: 50 },
  { id: '8', name: 'Leicester', aliases: ['leicester', 'foxes'], rating: 48 },
  { id: '9', name: 'Everton', aliases: ['everton'], rating: 53 },
  { id: '10', name: 'LEEDS', aliases: ['leeds', 'lee'], rating: 51 },
  { id: '11', name: 'WEST BROM', aliases: ['west brom', 'wbr', 'westbrom'], rating: 54 },
  { id: '12', name: 'West Ham', aliases: ['west ham', 'whu', 'hammers'], rating: 54 },
  { id: '13', name: 'Newcastle', aliases: ['newcastle', 'new', 'toon'], rating: 60 },
  { id: '14', name: 'Brighton', aliases: ['brighton', 'bha'], rating: 57 },
  { id: '15', name: 'Palace', aliases: ['palace', 'cry', 'crystal palace'], rating: 55 },
  { id: '16', name: 'FULHAM', aliases: ['fulham'], rating: 53 },
  { id: '17', name: 'ASTON V', aliases: ['aston v', 'aston villa', 'avl', 'villa'], rating: 58 },
  { id: '18', name: 'Southampton', aliases: ['southampton'], rating: 49 },
  { id: '19', name: 'Wolves', aliases: ['wolves', 'wol'], rating: 52 },
  { id: '20', name: 'SHEFFIELD U', aliases: ['sheffield u', 'sheffield united', 'sheffieldu'], rating: 47 },
];

function clamp(value, min = P_MIN, max = P_MAX) {
  return Math.min(max, Math.max(min, value));
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findTeam(idOrName) {
  const needle = normalizeName(idOrName);
  if (!needle) return null;
  return TEAMS.find((team) => {
    if (String(team.id) === String(idOrName).trim()) return true;
    if (normalizeName(team.name) === needle) return true;
    return team.aliases.some((alias) => normalizeName(alias) === needle);
  });
}

function parseKenyaTime(stamp) {
  if (!stamp) return new Date(NaN);
  const raw = String(stamp).trim().replace(' ', 'T');
  return new Date(`${raw}+03:00`);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--:--';
  const kenya = new Date(date.getTime());
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(kenya);
  const hh = parts.find((p) => p.type === 'hour')?.value || pad(kenya.getHours());
  const mm = parts.find((p) => p.type === 'minute')?.value || pad(kenya.getMinutes());
  return `${hh}:${mm}`;
}

function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (s >= 600) return `${Math.floor(s / 60)}m`;
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

function virtualRemaining(period) {
  if (!period) return 0;
  if (period.phase === 'live') {
    const fromEnd = Number(period.untilEnd);
    if (Number.isFinite(fromEnd) && fromEnd >= 0 && fromEnd <= 90) return fromEnd;
    const elapsed = Math.max(0, -(Number(period.untilStart) || 0));
    return Math.max(0, 35 - elapsed);
  }
  const until = Number(period.untilStart);
  if (!Number.isFinite(until) || until < 0) return 0;
  return until;
}

module.exports = {
  LEAGUE,
  PRODUCT,
  COMPETITION_ID,
  K_RATING,
  P_MIN,
  P_MAX,
  EV_VALUE_THRESHOLD,
  BUFFER_SIZE,
  CIRCUIT_THRESHOLD,
  BASE_MULTIPLIER_MS,
  WORKER_INTERVAL_MS,
  VALUE_CLAMP,
  ODIBET_VIRTUALS,
  TEAMS,
  clamp,
  findTeam,
  normalizeName,
  parseKenyaTime,
  formatClock,
  formatCountdown,
  virtualRemaining,
};
