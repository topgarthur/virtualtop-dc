const EASY_MARKETS = [
  { key: 'dc1x', label: '1X' },
  { key: 'dcx2', label: 'X2' },
  { key: 'dc12', label: '12' },
  { key: 'ov15', label: 'O1.5' },
  { key: 'un15', label: 'U1.5' },
  { key: 'gg', label: 'GG' },
  { key: 'ng', label: 'NG' },
  { key: 'ov25', label: 'O2.5' },
  { key: 'un25', label: 'U2.5' },
];

function easyLabel(key) {
  return EASY_MARKETS.find((row) => row.key === key)?.label || key;
}

function gradeEasy(key, homeGoals, awayGoals) {
  if (homeGoals == null || awayGoals == null || !key) return null;
  const hg = Number(homeGoals);
  const ag = Number(awayGoals);
  const total = hg + ag;
  const gg = hg > 0 && ag > 0;
  const home = hg > ag;
  const away = ag > hg;
  const draw = hg === ag;
  switch (key) {
    case 'ov15':
      return total >= 2;
    case 'un15':
      return total <= 1;
    case 'ov25':
      return total >= 3;
    case 'un25':
      return total <= 2;
    case 'gg':
      return gg;
    case 'ng':
      return !gg;
    case 'dc1x':
      return home || draw;
    case 'dcx2':
      return away || draw;
    case 'dc12':
      return home || away;
    default:
      return null;
  }
}

module.exports = { EASY_MARKETS, easyLabel, gradeEasy };
