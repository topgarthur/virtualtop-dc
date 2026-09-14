import { useDemo } from '../DemoContext';

export default function DemoStats() {
  const { stats, wallet, slips } = useDemo();
  const history = [...slips].reverse().slice(0, 12);

  return (
    <section className="panel demo-stats">
      <header className="panel-head">
        <span className="kicker">This device only</span>
        <h2>Demo played · virtualTOP$DC</h2>
      </header>
      <div className="round-score">
        <div>
          <b>KSh {Number(wallet.cash || 0).toFixed(0)}</b>
          <span>wallet</span>
        </div>
        <div>
          <b>{stats.played}</b>
          <span>played</span>
        </div>
        <div>
          <b className="ok">{stats.won}</b>
          <span>won</span>
        </div>
        <div>
          <b className="bad">{stats.lost}</b>
          <span>lost</span>
        </div>
      </div>
      <div className="demo-history">
        {history.map((row) => (
          <article key={row.id} className={`demo-hist ${row.status}`}>
            <strong>
              {row.matchdayTime || '—'} · WEEK {row.week || '—'}
            </strong>
            <span>
              {row.picks.map((pick) => `${pick.home} vs ${pick.away} ${pick.label}${pick.score ? ` ${pick.score}` : ''}`).join(' · ')}
            </span>
            <em>
              {row.status.toUpperCase()} · KSh {row.stake}
              {row.status === 'won' ? ` → ${row.payout}` : ''}
            </em>
          </article>
        ))}
        {!history.length && <p className="hint">No demo bets on this device yet.</p>}
      </div>
    </section>
  );
}
