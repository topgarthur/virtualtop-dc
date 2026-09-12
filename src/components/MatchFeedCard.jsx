function barWidth(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

const ROWS = [
  { key: 'HOME_WIN', label: 'HOME', short: '1', market: 'home' },
  { key: 'DRAW', label: 'DRAW', short: 'X', market: 'draw' },
  { key: 'AWAY_WIN', label: 'AWAY', short: '2', market: 'away' },
];

export default function MatchFeedCard({ row }) {
  const { fixture, analysis } = row;
  const vector = analysis?.vector || analysis?.oneXTwo?.vector || {};
  const tag = analysis?.prediction || 'DRAW';
  const lean = analysis?.lean;
  const aux = analysis?.aux?.vector || {};
  const odds = fixture.odds || {};
  const model = analysis?.ratings?.model;
  const advice = analysis?.advice;

  return (
    <article className={`match-card ${fixture.live ? 'live' : ''} ${analysis?.highValue ? 'hot' : ''} ${tag === 'DRAW' ? 'draw-pick' : ''} ${advice === 'SURE_BET' ? 'sure' : ''} ${advice === 'DONT_RISK' ? 'avoid' : ''}`}>
      <div className="match-meta">
        <span className="mono">{fixture.live ? `LIVE ${fixture.score || '0:0'}` : fixture.startTime?.slice(11, 16) || fixture.fixtureId}</span>
        <span className="meta-tags">
          {advice === 'SURE_BET' && <span className="tag-sure">SURE BET</span>}
          {advice === 'DONT_RISK' && <span className="tag-avoid">DON'T RISK</span>}
          <span className={`badge ${tag.toLowerCase()}`}>
            {tag === 'DRAW' ? 'DRAW' : tag.replace('_', ' ')}
            {lean === 'DRAW' ? ' · lean DRAW' : lean ? ` · also ${lean.replace('_', ' ')}` : ''}
          </span>
        </span>
      </div>
      <h3>
        {fixture.homeName || fixture.homeTeam} <em>vs</em> {fixture.awayName || fixture.awayTeam}
      </h3>
      {fixture.live && <p className="scoreline">{fixture.score || '0:0'}</p>}
      <div className="pick-row">
        {ROWS.map((item) => {
          const cell = vector[item.key] || vector[item.market] || {};
          const p = cell.pModel || 0;
          const on = tag === item.key;
          return (
            <div key={item.key} className={`pick ${item.market} ${on ? 'on' : ''}`}>
              <span>{item.label}</span>
              <strong>{(p * 100).toFixed(0)}%</strong>
              <em>{odds[item.market] ? Number(odds[item.market]).toFixed(2) : '—'}</em>
            </div>
          );
        })}
      </div>
      <div className="prob-block">
        {ROWS.map((item) => {
          const cell = vector[item.key] || vector[item.market] || {};
          const p = cell.pModel || cell.probability || 0;
          return (
            <div key={item.key} className={`prob-row ${item.market} ${cell.highValue ? 'value' : ''}`}>
              <span>{item.short} {item.label}</span>
              <div className="bar">
                <i style={{ width: barWidth(p) }} />
              </div>
              <b>{(p * 100).toFixed(0)}%</b>
              <em>
                EV {cell.ev >= 0 ? '+' : ''}
                {(cell.ev || 0).toFixed(2)}
              </em>
            </div>
          );
        })}
      </div>
      <div className="aux-row">
        {['ov25', 'un25', 'gg', 'ng'].map((key) => (
          <span key={key} className={aux[key]?.highValue ? 'chip hot' : 'chip'}>
            {key.toUpperCase()} {odds[key] ? Number(odds[key]).toFixed(2) : '—'}
          </span>
        ))}
      </div>
      <footer>
        {advice === 'SURE_BET' ? 'Top-3 surety on this card · still RNG · ' : ''}
        {advice === 'DONT_RISK' ? 'Low-edge · skip · ' : ''}
        {tag === 'DRAW' ? 'Primary pick DRAW · ' : ''}
        {model?.engine || 'ensemble'} · λ {model?.lambdaHome ?? '—'} / {model?.lambdaAway ?? '—'}
      </footer>
    </article>
  );
}
