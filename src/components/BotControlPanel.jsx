import { useBot } from '../BotContext';

export default function BotControlPanel() {
  const { start, stop, status, busy, riskProfile, setRiskProfile } = useBot();
  const running = Boolean(status.running);

  return (
    <section className="panel control">
      <header className="panel-head">
        <span className="kicker">Execution</span>
        <h2>Bot control</h2>
      </header>
      <div className="status-pills">
        <span className={`pill ${running ? 'on' : 'off'}`}>{running ? 'LOOP LIVE' : 'IDLE'}</span>
        <span className={`pill ${status.circuitOpen ? 'warn' : 'ok'}`}>
          {status.circuitOpen ? 'CIRCUIT OPEN' : 'CIRCUIT CLOSED'}
        </span>
        <span className="pill dim">OdiLeague / english</span>
        <span className={`pill ${status.phase === 'active' ? 'on' : 'dim'}`}>
          {(status.phase || 'idle').toUpperCase()}
        </span>
      </div>
      <div className="btn-row">
        <button type="button" className="cyber-btn go" disabled={busy || running} onClick={start}>
          START
        </button>
        <button type="button" className="ghost-btn stop" disabled={busy || !running} onClick={stop}>
          STOP
        </button>
      </div>
      <label className="risk">
        Risk profile
        <select value={riskProfile} onChange={(e) => setRiskProfile(e.target.value)}>
          <option value="conservative">Conservative — EV &gt; 0.08</option>
          <option value="balanced">Balanced — EV &gt; 0.03 (value clamp)</option>
          <option value="aggressive">Aggressive — show full RNG board</option>
        </select>
      </label>
      <p className="hint">
        Worker uses table + previous matches, not club size. Graded weeks correct the next card.
      </p>
    </section>
  );
}
