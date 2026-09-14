import { useState } from 'react';
import { useBot } from '../BotContext';
import StandingsTable from './StandingsTable';

export default function NextEventStage({ onFocusMode }) {
  const { sync, status } = useBot();
  const [tab, setTab] = useState('live');
  const phase = sync?.phase || status.phase || 'prematch';
  const clock = sync?.countdownLabel || status.countdownLabel || '00:00';
  const live = phase === 'live';

  return (
    <aside className={`stage-wrap ${live ? 'live' : ''}`}>
      <div className="stage-tabs">
        <button type="button" className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>
          Live
        </button>
        <button type="button" className={tab === 'standings' ? 'on' : ''} onClick={() => setTab('standings')}>
          Standings
        </button>
        <button type="button" className="focus-tab" onClick={onFocusMode}>
          Focus mode
        </button>
      </div>
      {tab === 'standings' ? (
        <div className="stage-standings">
          <StandingsTable />
        </div>
      ) : (
        <div className={`next-stage ${live ? 'live' : ''}`}>
          <div className="pitch">
            <span className="odi-ball" aria-hidden="true">
              ⚽
            </span>
            <p className="stage-kicker">{live ? 'Playing now' : 'Next event in'}</p>
            <p className="stage-clock">{clock}</p>
          </div>
        </div>
      )}
    </aside>
  );
}
