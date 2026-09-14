import { useMemo, useState } from 'react';
import { useBot } from '../BotContext';
import { useDemo } from '../DemoContext';
import { combinedOdds } from '../demoBank';

const EXTRAS = [
  { key: 'dc1x', label: '1X', odd: 'dc1x' },
  { key: 'dcx2', label: 'X2', odd: 'dcx2' },
  { key: 'dc12', label: '12', odd: 'dc12' },
  { key: 'ov15', label: 'O1.5', odd: 'ov15' },
  { key: 'un15', label: 'U1.5', odd: 'un15' },
  { key: 'gg', label: 'GG', odd: 'gg' },
  { key: 'ng', label: 'NG', odd: 'ng' },
  { key: 'ov25', label: 'O2.5', odd: 'ov25' },
  { key: 'un25', label: 'U2.5', odd: 'un25' },
];

function selId(fixtureId, key) {
  return `${fixtureId}:${key}`;
}

export default function DemoPage() {
  const { feed, sync, status } = useBot();
  const { place, openSlips, slips, pending, setPicks, wallet, liveLocked, flash } = useDemo();
  const picks = pending;
  const [stake, setStake] = useState(50);
  const [note, setNote] = useState('');
  const fixtures = feed.map((row) => row.fixture || row);
  const oddsTotal = combinedOdds(picks);
  const possible = Number(stake) > 0 ? Number(stake) * oddsTotal : 0;

  const toggle = (pick) => {
    setPicks((prev) => {
      const id = selId(pick.fixtureId, pick.key);
      if (prev.some((row) => selId(row.fixtureId, row.key) === id)) {
        return prev.filter((row) => selId(row.fixtureId, row.key) !== id);
      }
      return [...prev, pick];
    });
  };

  const on = (fixtureId, key) => picks.some((row) => selId(row.fixtureId, row.key) === selId(fixtureId, key));

  const submit = () => {
    const amount = Number(stake);
    if (!picks.length) {
      setNote('Add at least one selection.');
      return;
    }
    if (!Number.isFinite(amount) || amount < 1) {
      setNote('Enter a stake in KSh.');
      return;
    }
    const result = place({
      picks,
      stake: amount,
      cardKey: `${sync?.seasonId || ''}:${sync?.week || ''}:${sync?.matchdayTime || ''}`,
      matchdayTime: sync?.matchdayTime,
      week: sync?.week,
      seasonId: sync?.seasonId,
    });
    if (result?.error) {
      setNote(result.error);
      return;
    }
    setNote(`Demo bet placed · KSh ${amount} @ ${oddsTotal.toFixed(2)}. Settles when this round’s official scores land.`);
  };

  const recent = useMemo(() => slips.slice(-8).reverse(), [slips]);

  return (
    <div className="app-shell demo-shell">
      {flash && <div className={`settle-flash ${flash.won ? 'won' : 'lost'}`}>{flash.text}</div>}
      <header className="odi-header demo-bar">
        <a className="cyber-btn" href="#/">
          ← Board
        </a>
        <div>
          <p className="brand">Bet demo</p>
          <p className="sub">Wallet KSh {Number(wallet?.cash || 0).toFixed(0)} · this device only</p>
        </div>
        <span className="mono">{sync?.countdownLabel || status.countdownLabel || '00:00'}</span>
      </header>

      <div className="demo-layout">
        <section className="panel">
          <header className="panel-head">
            <span className="kicker">English League card</span>
            <h2>Tap a market to add it</h2>
          </header>
          <div className="demo-matches">
            {fixtures.map((fx) => (
              <article key={fx.fixtureId} className="demo-match">
                <h3>
                  {fx.homeName || fx.homeTeam} <em>vs</em> {fx.awayName || fx.awayTeam}
                </h3>
                <div className="btn-row">
                  {[
                    { key: 'home', label: '1', odd: 'home' },
                    { key: 'draw', label: 'X', odd: 'draw' },
                    { key: 'away', label: '2', odd: 'away' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`cyber-btn ${on(fx.fixtureId, item.key) ? 'active' : ''}`}
                      onClick={() =>
                        toggle({
                          fixtureId: fx.fixtureId,
                          week: fx.week || sync?.week,
                          home: fx.homeName || fx.homeTeam,
                          away: fx.awayName || fx.awayTeam,
                          key: item.key,
                          label: item.label,
                          odds: fx.odds?.[item.odd],
                        })
                      }
                    >
                      {item.label} {fx.odds?.[item.odd] ? Number(fx.odds[item.odd]).toFixed(2) : ''}
                    </button>
                  ))}
                </div>
                <div className="btn-row wrap">
                  {EXTRAS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`ghost-btn ${on(fx.fixtureId, item.key) ? 'active' : ''}`}
                      onClick={() =>
                        toggle({
                          fixtureId: fx.fixtureId,
                          week: fx.week || sync?.week,
                          home: fx.homeName || fx.homeTeam,
                          away: fx.awayName || fx.awayTeam,
                          key: item.key,
                          label: item.label,
                          odds: fx.odds?.[item.odd],
                        })
                      }
                    >
                      {item.label} {fx.odds?.[item.odd] ? Number(fx.odds[item.odd]).toFixed(2) : ''}
                    </button>
                  ))}
                </div>
              </article>
            ))}
            {!fixtures.length && <p className="hint">Waiting for the Odibet card…</p>}
          </div>
        </section>

        <aside className="panel demo-slip">
          <header className="panel-head">
            <span className="kicker">Betslip</span>
            <h2>{picks.length} selection{picks.length === 1 ? '' : 's'}</h2>
          </header>
          {picks.map((row) => (
            <div key={selId(row.fixtureId, row.key)} className="slip-row">
              <span>
                {row.home} vs {row.away}
              </span>
              <strong>{row.label}</strong>
              <em>{row.odds ? Number(row.odds).toFixed(2) : '—'}</em>
            </div>
          ))}
          <label className="risk">
            Stake (KSh)
            <input
              type="number"
              min="1"
              step="1"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
            />
          </label>
          <p className="hint">
            Total odds {oddsTotal.toFixed(2)} · possible win KSh {possible.toFixed(2)}
            {liveLocked ? ' · locked (LIVE)' : ''}
          </p>
          <button type="button" className="cyber-btn go" disabled={liveLocked} onClick={submit}>
            {liveLocked ? 'Locked at kickoff' : 'Place demo bet'}
          </button>
          {note && <p className="hint">{note}</p>}

          <h3 className="slip-h">Open on this device</h3>
          {openSlips.length ? (
            openSlips.map((row) => (
              <p key={row.id} className="hint">
                KSh {row.stake} @ {row.odds} · {row.picks.length} pick · waiting for scores
              </p>
            ))
          ) : (
            <p className="hint">No open demo bets.</p>
          )}
          <h3 className="slip-h">Recent</h3>
          {recent.map((row) => (
            <div key={row.id} className={`slip-row ${row.status}`}>
              <span>{row.status.toUpperCase()}</span>
              <strong>KSh {row.stake}</strong>
              <em>{row.status === 'won' ? `+${row.payout}` : row.status === 'lost' ? '0' : 'open'}</em>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
