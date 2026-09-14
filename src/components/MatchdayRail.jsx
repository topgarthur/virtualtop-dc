import { useEffect, useState } from 'react';
import { useBot } from '../BotContext';

function pad(n) {
  return String(Math.max(0, n)).padStart(2, '0');
}

function formatRemain(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 600) return `${Math.floor(s / 60)}m`;
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export default function MatchdayRail({ compact = false }) {
  const { sync, status, selectedPeriod, selectPeriod } = useBot();
  const snapshot = sync || status.lastSync || {};
  const periods = snapshot.periods || [];
  const selected = selectedPeriod || snapshot.selectedPeriod;
  const phase = snapshot.liveMinute > 0 || snapshot.phase === 'live' || status.phase === 'live' ? 'live' : snapshot.phase || status.phase || 'prematch';
  const baseSeconds = Number(snapshot.countdownSeconds ?? status.countdownSeconds ?? 0);
  const generatedAt = snapshot.generatedAt || status.lastTick;
  const [remain, setRemain] = useState(baseSeconds);

  useEffect(() => {
    setRemain(baseSeconds);
    const origin = generatedAt ? new Date(generatedAt).getTime() : Date.now();
    const tick = () => {
      const elapsed = (Date.now() - origin) / 1000;
      setRemain(Math.max(0, baseSeconds - elapsed));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [baseSeconds, generatedAt]);

  return (
    <div className={`odi-rail ${compact ? 'compact' : ''}`}>
      <div className={`rail-count ${phase === 'live' && remain <= 90 ? 'live' : ''}`} title="Time left on the current live/next matchday">
        {formatRemain(remain)}
      </div>
      <div className="rail-times">
        {periods.map((period) => {
          const active = period.startTime === selected;
          return (
            <button
              key={period.startTime}
              type="button"
              className={`rail-kick ${active ? 'active' : ''} ${period.phase === 'live' ? 'playing' : ''}`}
              onClick={() => {
                if (!active) selectPeriod(period.startTime);
              }}
            >
              {period.clock}
            </button>
          );
        })}
      </div>
    </div>
  );
}
