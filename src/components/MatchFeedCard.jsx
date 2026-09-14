import { useBot } from '../BotContext';
import { useDemo } from '../DemoContext';

const GROUPS = [
  {
    title: 'Double chance',
    items: [
      { key: 'dc1x', label: '1X' },
      { key: 'dcx2', label: 'X2' },
      { key: 'dc12', label: '12' },
    ],
  },
  {
    title: 'O/U 1.5',
    items: [
      { key: 'ov15', label: 'O1.5' },
      { key: 'un15', label: 'U1.5' },
    ],
  },
  {
    title: 'GG/NG',
    items: [
      { key: 'gg', label: 'GG' },
      { key: 'ng', label: 'NG' },
    ],
  },
  {
    title: 'O/U 2.5',
    items: [
      { key: 'ov25', label: 'O2.5' },
      { key: 'un25', label: 'U2.5' },
    ],
  },
];

export default function MatchFeedCard({ row, focusMode = false }) {
  const { fixture, analysis } = row;
  const { stakeMode, overrideEasy } = useBot();
  const { addPending, liveLocked } = useDemo();
  const vector = analysis?.vector || analysis?.oneXTwo?.vector || {};
  const tag = analysis?.prediction;
  const aux = analysis?.aux?.vector || {};
  const odds = fixture.odds || {};
  const advice = analysis?.advice;
  const easy = analysis?.easyPick;
  const easyAdvice = analysis?.easyAdvice;
  const locked = Boolean(analysis?.locked);
  const show1x2 = stakeMode !== 'extra';
  const showExtra = stakeMode !== '1x2';
  const picks = [
    { key: 'HOME_WIN', label: 'HOME', market: 'home' },
    { key: 'DRAW', label: 'DRAW', market: 'draw' },
    { key: 'AWAY_WIN', label: 'AWAY', market: 'away' },
  ];

  return (
    <article
      className={`match-card ${fixture.live ? 'live' : ''} ${tag === 'DRAW' && show1x2 ? 'draw-pick' : ''} ${
        show1x2 && advice === 'SURE_BET' ? 'sure' : ''
      } ${show1x2 && advice === 'DONT_RISK' ? 'avoid' : ''} ${
        !show1x2 && easyAdvice === 'SURE_BET' ? 'sure' : ''
      } ${!show1x2 && easyAdvice === 'DONT_RISK' ? 'avoid' : ''}`}
    >
      <div className="match-meta">
        <span className="mono">
          {fixture.live ? `LIVE ${fixture.score || '0:0'}` : fixture.startTime?.slice(11, 16) || ''}
          {locked ? ' · LOCK' : ''}
        </span>
        <span className="meta-tags">
          {show1x2 && advice === 'SURE_BET' && <span className="tag-sure">SURE 1X2</span>}
          {show1x2 && advice === 'DONT_RISK' && <span className="tag-avoid">SKIP 1X2</span>}
          {show1x2 && tag && (
            <span className={`badge ${tag.toLowerCase()}`}>
              {tag === 'DRAW' ? 'DRAW' : tag.replace('_', ' ')}
            </span>
          )}
        </span>
      </div>
      <h3>
        {fixture.homeName || fixture.homeTeam} <em>vs</em> {fixture.awayName || fixture.awayTeam}
      </h3>
      {fixture.live && <p className={`scoreline ${focusMode ? 'quiet' : ''}`}>{fixture.score || '0:0'}</p>}
      {show1x2 && (
        <div className="pick-row">
          {picks.map((item) => {
            const cell = vector[item.key] || vector[item.market] || {};
            const p = cell.pModel || 0;
            const on = tag === item.key;
            return (
              <div key={item.key} className={`pick ${item.market} ${on ? 'on' : ''}`}>
                <span>{item.label}</span>
                <strong>{p ? `${(p * 100).toFixed(0)}%` : '—'}</strong>
                <em>{odds[item.market] ? Number(odds[item.market]).toFixed(2) : '—'}</em>
              </div>
            );
          })}
        </div>
      )}
      {showExtra && easy?.label && (
        <div className={`stake-line ${easyAdvice === 'SURE_BET' ? 'go' : ''} ${easyAdvice === 'DONT_RISK' ? 'no' : ''}`}>
          <i className={`dot ${easyAdvice === 'SURE_BET' ? 'green' : easyAdvice === 'DONT_RISK' ? 'red' : 'dim'}`} />
          <span>Stake</span>
          <strong>{easy.label}</strong>
          <em>{easy.pModel ? `${(easy.pModel * 100).toFixed(0)}%` : ''}</em>
          <em>{easy.odds ? Number(easy.odds).toFixed(2) : ''}</em>
          {easy.overridden && <span className="tag-sure">YOURS</span>}
          <button
            type="button"
            className="ghost-btn add-demo"
            disabled={liveLocked}
            onClick={() =>
              addPending({
                fixtureId: fixture.fixtureId,
                week: fixture.week,
                home: fixture.homeName || fixture.homeTeam,
                away: fixture.awayName || fixture.awayTeam,
                key: easy.key,
                label: easy.label,
                odds: easy.odds,
              })
            }
          >
            {liveLocked ? 'Locked' : 'Add to Bet demo'}
          </button>
        </div>
      )}
      {showExtra && (
        <details className="markets-more">
          <summary>Other extra markets — tap to stake one</summary>
          {GROUPS.map((group) => (
            <div key={group.title} className="market-row tight">
              {group.items.map((item) => {
                const cell = aux[item.key] || {};
                const p = cell.pModel || 0;
                const on = easy?.key === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`mkt ${on ? 'on' : ''}`}
                    onClick={() =>
                      overrideEasy(fixture.fixtureId, {
                        key: item.key,
                        label: item.label,
                        pModel: p,
                        odds: odds[item.key] || cell.odds,
                        surety: p * p,
                      })
                    }
                  >
                    {on && (
                      <i className={`dot ${easyAdvice === 'SURE_BET' ? 'green' : easyAdvice === 'DONT_RISK' ? 'red' : 'dim'}`} />
                    )}
                    <span>{item.label}</span>
                    <strong>{p ? `${(p * 100).toFixed(0)}%` : '—'}</strong>
                    <em>{odds[item.key] || cell.odds ? Number(odds[item.key] || cell.odds).toFixed(2) : '—'}</em>
                  </button>
                );
              })}
            </div>
          ))}
        </details>
      )}
    </article>
  );
}
