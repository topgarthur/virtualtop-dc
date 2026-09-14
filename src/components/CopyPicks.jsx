import { useBot } from '../BotContext';

function oneX2Label(tag) {
  if (tag === 'HOME_WIN') return 'HOME';
  if (tag === 'AWAY_WIN') return 'AWAY';
  return 'DRAW';
}

function slipText(feed, stakeMode) {
  const extraOn = stakeMode !== '1x2';
  const oneOn = stakeMode !== 'extra';
  const lines = [];
  if (extraOn) {
    feed
      .filter((row) => row.analysis?.easyAdvice === 'SURE_BET' && row.analysis?.easyPick)
      .forEach((row) => {
        const fx = row.fixture;
        const easy = row.analysis.easyPick;
        lines.push(
          `${fx.homeName || fx.homeTeam} vs ${fx.awayName || fx.awayTeam} — ${easy.label} @ ${
            easy.odds ? Number(easy.odds).toFixed(2) : '—'
          }`
        );
      });
  }
  if (oneOn) {
    feed
      .filter((row) => row.analysis?.advice === 'SURE_BET')
      .forEach((row) => {
        const fx = row.fixture;
        const key = row.analysis.prediction === 'HOME_WIN' ? 'home' : row.analysis.prediction === 'AWAY_WIN' ? 'away' : 'draw';
        lines.push(
          `${fx.homeName || fx.homeTeam} vs ${fx.awayName || fx.awayTeam} — ${oneX2Label(row.analysis.prediction)} @ ${
            fx.odds?.[key] ? Number(fx.odds[key]).toFixed(2) : '—'
          }`
        );
      });
  }
  return lines.join('\n');
}

export default function CopyPicks() {
  const { feed, stakeMode, sync } = useBot();
  if (!feed.length) return null;
  const text = slipText(feed, stakeMode);
  if (!text) return null;

  return (
    <div className="copy-bar">
      <button
        type="button"
        className="cyber-btn"
        onClick={() => {
          const body = `${sync?.roundLabel || 'English League'}\n${text}`;
          navigator.clipboard?.writeText(body);
        }}
      >
        Copy 3-picks
      </button>
    </div>
  );
}
