import { useBot } from '../BotContext';

export default function BotControlPanel() {
  const { start, stop, status, busy, error } = useBot();
  const running = Boolean(status.running);

  return (
    <section className="panel control">
      <header className="panel-head">
        <span className="kicker">Grader</span>
        <h2>Kickoff tracker</h2>
      </header>
      <div className="status-pills">
        <span className={`pill ${running ? 'on' : 'off'}`}>{running ? 'TRACKING' : 'PAUSED'}</span>
        <span className="pill dim">OdiLeague / english</span>
        <span className={`pill ${status.phase === 'live' ? 'on' : 'dim'}`}>
          {(status.phase || 'idle').toUpperCase()}
        </span>
      </div>
      <div className="btn-row">
        <button type="button" className="cyber-btn go" disabled={busy || running} onClick={start}>
          TRACK
        </button>
        <button type="button" className="ghost-btn stop" disabled={busy || !running} onClick={stop}>
          PAUSE
        </button>
      </div>
      {error && <p className="banner">{error}</p>}
      <p className="hint">
        Track grades official scores so extra-market hit rates and the calibration bars can update. It does not place bets.
      </p>
    </section>
  );
}
