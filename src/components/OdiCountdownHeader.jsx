import MatchdayRail from './MatchdayRail';
import { useBot } from '../BotContext';

export default function OdiCountdownHeader() {
  const { sync, status } = useBot();
  const snapshot = sync || status.lastSync || {};
  const phase = snapshot.phase || status.phase || 'prematch';

  return (
    <section className={`odi-header ${phase}`}>
      <div className="odi-header-top slim">
        <div className="odi-brand">
          <a className="cyber-btn demo-launch" href="#/demo">
            Bet demo
          </a>
          <p className="brand">virtualTOP$DC</p>
        </div>
      </div>
      <MatchdayRail />
    </section>
  );
}
