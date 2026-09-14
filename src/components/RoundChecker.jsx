import { useBot } from '../BotContext';

function pickLabel(tag) {
  if (tag === 'HOME_WIN') return 'HOME';
  if (tag === 'AWAY_WIN') return 'AWAY';
  return 'DRAW';
}

export default function RoundChecker() {
  const { sync, status } = useBot();
  const pack = sync?.strategy || status.strategy || {};
  const segments = pack.segments || pack.recent || (pack.current ? [pack.current] : []);
  const totals = pack.totals || { cards: 0, weeks: 0, correct: 0, wrong: 0, easyCorrect: 0, easyWrong: 0 };
  const season = sync?.seasonId || pack.current?.seasonId || '2026091202';
  const markets = (pack.marketStats || []).filter((row) => !['HOME_WIN', 'AWAY_WIN', 'DRAW'].includes(row.key));
  const oneX = (pack.marketStats || []).filter((row) => ['HOME_WIN', 'AWAY_WIN', 'DRAW'].includes(row.key));

  return (
    <section className="panel round-check">
      <header className="panel-head">
        <span className="kicker">Round predictor checker</span>
        <h2>Each kickoff · #{season}</h2>
      </header>
      <div className="round-score">
        <div>
          <b className="ok">{totals.correct ?? 0}</b>
          <span>1X2 correct</span>
        </div>
        <div>
          <b className="bad">{totals.wrong ?? 0}</b>
          <span>1X2 wrong</span>
        </div>
        <div>
          <b className="ok">{totals.easyCorrect ?? 0}</b>
          <span>extra correct</span>
        </div>
        <div>
          <b className="bad">{totals.easyWrong ?? 0}</b>
          <span>extra wrong</span>
        </div>
      </div>
      {markets.length > 0 && (
        <div className="hit-rates">
          <h3>Extra market hit rates</h3>
          <div className="hit-grid">
            {markets.map((row) => (
              <div key={row.key} className="hit-cell">
                <strong>{row.label}</strong>
                <b>{(row.rate * 100).toFixed(0)}%</b>
                <span>
                  {row.hits}/{row.n}
                </span>
              </div>
            ))}
          </div>
          {oneX.length > 0 && (
            <div className="hit-grid slim">
              {oneX.map((row) => (
                <div key={row.key} className="hit-cell">
                  <strong>{pickLabel(row.key)}</strong>
                  <b>{(row.rate * 100).toFixed(0)}%</b>
                  <span>
                    {row.hits}/{row.n}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {segments.length ? (
        <div className="round-segments">
          {segments.map((card) => (
            <article key={card.key} className={`round-seg ${card.status || ''}`}>
              <header>
                <strong>{card.clock || card.matchdayTime || '--:--'}</strong>
                <span>
                  WEEK {card.week} · 1X2 {card.correct}/{card.wrong}
                  {card.easyCorrect != null ? ` · extra ${card.easyCorrect}/${card.easyWrong}` : ''}
                  {card.pending ? ` · ${card.pending} open` : ''}
                </span>
              </header>
              <div className="round-picks">
                {(card.picks || []).map((pick) => (
                  <div
                    key={pick.fixtureId}
                    className={`round-pick ${pick.easyOk === true ? 'yes' : ''} ${pick.easyOk === false ? 'no' : ''} ${
                      pick.ok === true && pick.easyOk == null ? 'yes' : ''
                    } ${pick.ok === false && pick.easyOk == null ? 'no' : ''}`}
                  >
                    <span>
                      {pick.home} vs {pick.away}
                    </span>
                    <em>
                      1X2 {pickLabel(pick.pick)}
                      {pick.ok === true ? ' hit' : pick.ok === false ? ' miss' : ''}
                      {pick.easyPick?.label ? ` · extra ${pick.easyPick.label}` : ''}
                      {pick.easyOk === true ? ' hit' : pick.easyOk === false ? ' miss' : ''}
                      {pick.score ? ` · ${pick.score}` : ''}
                    </em>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="hint">Each purple kickoff time gets its own score after that card finishes.</p>
      )}
    </section>
  );
}
