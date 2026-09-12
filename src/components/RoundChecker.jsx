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
  const totals = pack.totals || { cards: 0, weeks: 0, correct: 0, wrong: 0 };
  const lesson = pack.corrections?.lastLesson;
  const season = sync?.seasonId || pack.current?.seasonId || '2026091202';

  return (
    <section className="panel round-check">
      <header className="panel-head">
        <span className="kicker">Round predictor checker</span>
        <h2>Each kickoff · #{season}</h2>
      </header>
      <div className="round-score">
        <div>
          <b className="ok">{totals.correct ?? 0}</b>
          <span>correct all cards</span>
        </div>
        <div>
          <b className="bad">{totals.wrong ?? 0}</b>
          <span>wrong all cards</span>
        </div>
        <div>
          <b>{totals.cards ?? segments.length}</b>
          <span>kickoff segments</span>
        </div>
        <div>
          <b>{totals.weeks ?? 0}</b>
          <span>weeks graded</span>
        </div>
      </div>
      {segments.length ? (
        <div className="round-segments">
          {segments.map((card) => (
            <article key={card.key} className={`round-seg ${card.status || ''}`}>
              <header>
                <strong>{card.clock || card.matchdayTime || '--:--'}</strong>
                <span>
                  WEEK {card.week} · {card.correct} right / {card.wrong} wrong
                  {card.pending ? ` · ${card.pending} open` : ''}
                </span>
              </header>
              <div className="round-picks">
                {(card.picks || []).map((pick) => (
                  <div
                    key={pick.fixtureId}
                    className={`round-pick ${pick.ok === true ? 'yes' : ''} ${pick.ok === false ? 'no' : ''}`}
                  >
                    <span>
                      {pick.home} vs {pick.away}
                    </span>
                    <em>
                      pick {pickLabel(pick.pick)}
                      {pick.actual ? ` · actual ${pickLabel(pick.actual)}` : ''}
                      {pick.score ? ` ${pick.score}` : ''}
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
      {lesson && <p className="hint lesson">{lesson}</p>}
    </section>
  );
}
