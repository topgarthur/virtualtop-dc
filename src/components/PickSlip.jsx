import { useBot } from '../BotContext';

function oneX2Label(tag) {
  if (tag === 'HOME_WIN') return 'HOME';
  if (tag === 'AWAY_WIN') return 'AWAY';
  return 'DRAW';
}

export default function PickSlip() {
  const { feed, stakeMode, stakeUnit } = useBot();
  const extra = feed
    .filter((row) => row.analysis?.easyAdvice === 'SURE_BET' && row.analysis?.easyPick)
    .map((row) => ({
      id: row.fixture.fixtureId,
      home: row.fixture.homeName || row.fixture.homeTeam,
      away: row.fixture.awayName || row.fixture.awayTeam,
      label: row.analysis.easyPick.label,
      odds: row.analysis.easyPick.odds,
    }));
  const one = feed
    .filter((row) => row.analysis?.advice === 'SURE_BET')
    .map((row) => ({
      id: row.fixture.fixtureId,
      home: row.fixture.homeName || row.fixture.homeTeam,
      away: row.fixture.awayName || row.fixture.awayTeam,
      label: oneX2Label(row.analysis.prediction),
      odds: row.fixture.odds?.[row.analysis.prediction === 'HOME_WIN' ? 'home' : row.analysis.prediction === 'AWAY_WIN' ? 'away' : 'draw'],
    }));
  const showExtra = stakeMode !== '1x2';
  const show1x2 = stakeMode !== 'extra';
  if (!feed.length) return null;

  return (
    <section className="panel slip">
      <header className="panel-head">
        <span className="kicker">Board slip</span>
        <h2>Three sure picks · KSh {stakeUnit} each</h2>
      </header>
      {showExtra && (
        <div className="slip-col">
          <h3>Extra markets</h3>
          {extra.length ? (
            extra.map((row) => (
              <div key={`e-${row.id}`} className="slip-row">
                <span>
                  {row.home} vs {row.away}
                </span>
                <strong>{row.label}</strong>
                <em>{row.odds ? Number(row.odds).toFixed(2) : '—'}</em>
              </div>
            ))
          ) : (
            <p className="hint">No green extra stakes on this card yet.</p>
          )}
        </div>
      )}
      {show1x2 && (
        <div className="slip-col">
          <h3>1X2</h3>
          {one.length ? (
            one.map((row) => (
              <div key={`x-${row.id}`} className="slip-row">
                <span>
                  {row.home} vs {row.away}
                </span>
                <strong>{row.label}</strong>
                <em>{row.odds ? Number(row.odds).toFixed(2) : '—'}</em>
              </div>
            ))
          ) : (
            <p className="hint">No green 1X2 stakes on this card yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
