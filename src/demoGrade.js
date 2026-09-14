const EASY = {
  ov15: (hg, ag) => hg + ag >= 2,
  un15: (hg, ag) => hg + ag <= 1,
  ov25: (hg, ag) => hg + ag >= 3,
  un25: (hg, ag) => hg + ag <= 2,
  gg: (hg, ag) => hg > 0 && ag > 0,
  ng: (hg, ag) => !(hg > 0 && ag > 0),
  dc1x: (hg, ag) => hg >= ag,
  dcx2: (hg, ag) => ag >= hg,
  dc12: (hg, ag) => hg !== ag,
};

export function parseScore(text) {
  const parts = String(text || '')
    .replace(/[-–]/g, ':')
    .split(':')
    .map((n) => Number.parseInt(n, 10));
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
  return { home: parts[0], away: parts[1] };
}

export function oneX2FromScore(hg, ag) {
  if (hg > ag) return 'HOME_WIN';
  if (ag > hg) return 'AWAY_WIN';
  return 'DRAW';
}

export function demoBetWon(bet, hg, ag) {
  if (bet.group === '1x2') return oneX2FromScore(hg, ag) === bet.key;
  const fn = EASY[bet.key];
  return fn ? fn(hg, ag) : false;
}
