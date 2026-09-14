import { useBot } from '../BotContext';

function formLetters(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).toUpperCase().replace(/[^WDL]/g, '')).filter(Boolean);
  }
  return [...String(raw || '').toUpperCase()].filter((ch) => ch === 'W' || ch === 'D' || ch === 'L');
}

export default function StandingsTable() {
  const { sync, status } = useBot();
  const pack = Array.isArray(sync?.standings)
    ? { seasonId: sync.seasonId, rows: sync.standings }
    : status.standings || { seasonId: sync?.seasonId || '2026091502', rows: [] };
  const rows = pack.rows || [];
  const season = pack.seasonId || sync?.seasonId || '2026091502';

  return (
    <div className="odi-table">
      <h3 className="odi-table-title">English League Season #{season}</h3>
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
            <span className="form-pills">
              {formLetters(row.team_form).map((ch, index) => (
                <i key={`${ch}-${index}`} className={ch}>
                  {ch}
                </i>
              ))}
              {!formLetters(row.team_form).length && '—'}
            </span>
          </div>
        ))}
        {!rows.length && <p className="hint">Waiting for Odibet table…</p>}
      </div>
    </div>
  );
}
