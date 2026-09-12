import MatchdayRail from './MatchdayRail';
import { useBot } from '../BotContext';

export default function OdiCountdownHeader() {
  const { sync, status } = useBot();
  const snapshot = sync || status.lastSync || {};
  const phase = snapshot.phase || status.phase || 'prematch';
  const matchdayTime = snapshot.matchdayTime || status.matchdayTime || '--:--';

  return (
    <section className={`odi-header ${phase}`}>
      <div className="odi-header-top">
        <div className="odi-brand">
          <p className="brand">virtualTOP$DC</p>
          <p className="sub">OdiLeague English · live Odibet sync</p>
        </div>
        <div className="odi-cycle">
          <div className="next-event">
            <span className="kicker">
              {phase === 'live' ? 'Playing now' : phase === 'prematch' ? 'Selected matchday' : 'Between rounds'}
            </span>
            <p className="mono">
              {snapshot.roundLabel || `kickoff ${matchdayTime} · #${snapshot.seasonId || '2026091202'}`}
            </p>
          </div>
        </div>
        <div className="odi-meta">
          <span>odibets.com/league</span>
          <span>{status.lastTick ? `tick ${status.lastTick.slice(11, 19)}` : 'awaiting sync'}</span>
        </div>
      </div>
      <MatchdayRail />
    </section>
  );
}
