import { useBot } from '../BotContext';

export default function StandingsTable() {
  const { sync, status } = useBot();
  const pack = sync?.standings
    ? { seasonId: sync.seasonId, rows: sync.standings }
    : status.standings || { seasonId: '2026091202', rows: [] };
  const rows = pack.rows || [];

  return (
    <section className="panel standings">
      <header className="panel-head">
        <span className="kicker">English League</span>
        <h2>Standings #{pack.seasonId || '2026091202'}</h2>
      </header>
      <div className="stand-table">
        <div className="stand-row head">
          <span>P</span>
          <span>Team</span>
          <span>Pts</span>
          <span>Form</span>
        </div>
        {rows.map((row) => (
          <div key={`${row.pos}-${row.team_name}`} className={`stand-row ${row.pos <= 4 ? 'top' : ''} ${row.pos >= 18 ? 'drop' : ''}`}>
            <span>{row.pos}</span>
            <span>{row.team_name}</span>
            <span>{row.points}</span>
            <span className="form">{row.team_form}</span>
          </div>
        ))}
        {!rows.length && <p className="hint">Waiting for Odibet table…</p>}
      </div>
    </section>
  );
}
