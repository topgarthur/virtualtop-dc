import OdiCountdownHeader from './components/OdiCountdownHeader';
import MatchFeedCard from './components/MatchFeedCard';
import BotControlPanel from './components/BotControlPanel';
import ErrorLogTerminal from './components/ErrorLogTerminal';
import StandingsTable from './components/StandingsTable';
import RoundChecker from './components/RoundChecker';
import { useBot } from './BotContext';
import './App.css';

function App() {
  const { feed, busy, error, status, sync } = useBot();
  const phase = sync?.phase || status.phase || 'prematch';
  const fixturesOn = (sync?.fixtures || feed).length > 0 || feed.length > 0;

  return (
    <div className="app-shell">
      <OdiCountdownHeader />

      <section className="panel feed">
        <header className="panel-head">
          <span className="kicker">{phase === 'live' ? 'LIVE on Odibet' : 'English League'}</span>
          <h2>{phase === 'live' ? 'Live matchday' : 'Match feed'}</h2>
        </header>
        {error && <p className="banner">{error}</p>}
        {busy && <p className="hint">syncing Odibet…</p>}
        {fixturesOn ? (
          <div className="cards">
            {feed.map((row) => (
              <MatchFeedCard key={row.fixture.fixtureId} row={row} />
            ))}
          </div>
        ) : (
          <div className="intermission">
            <p className="intermission-clock">{status.countdownLabel || sync?.countdownLabel || '00:00'}</p>
            <p className="hint">Waiting for the next Odibet English League card.</p>
          </div>
        )}
      </section>

      <RoundChecker />

      <div className="grid">
        <BotControlPanel />
        <StandingsTable />
        <ErrorLogTerminal />
      </div>
    </div>
  );
}

export default App;
