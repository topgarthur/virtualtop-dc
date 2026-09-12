import { useEffect, useRef } from 'react';
import { useBot } from '../BotContext';

export default function ErrorLogTerminal() {
  const { logs } = useBot();
  const scroller = useRef(null);

  useEffect(() => {
    if (scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [logs]);

  return (
    <section className="panel terminal">
      <header className="panel-head">
        <span className="kicker">Telemetry</span>
        <h2>Error log terminal</h2>
      </header>
      <div className="term-glass" ref={scroller}>
        {logs.length === 0 && <div className="term-line dim">awaiting OdiLeague stream…</div>}
        {logs.map((row) => (
          <div key={row.id} className={`term-line ${row.level || 'info'}`}>
            <span className="ts">{(row.ts || '').slice(11, 19)}</span>
            <span className="lvl">{(row.level || 'info').toUpperCase()}</span>
            <span>{row.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
