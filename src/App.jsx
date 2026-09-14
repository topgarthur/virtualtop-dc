import { useState } from 'react';
import OdiCountdownHeader from './components/OdiCountdownHeader';
import MatchFeedCard from './components/MatchFeedCard';
import RoundChecker from './components/RoundChecker';
import CopyPicks from './components/CopyPicks';
import NextEventStage from './components/NextEventStage';
import DemoStats from './components/DemoStats';
import { useBot } from './BotContext';
import { useDemo } from './DemoContext';
import './App.css';

function Home() {
  const {
    visibleFeed,
    feed,
    busy,
    error,
    status,
    sync,
    stakeMode,
    setStakeMode,
    feedFilter,
    setFeedFilter,
  } = useBot();
  const { flash } = useDemo();
  const phase = sync?.phase || status.phase || 'prematch';
  const fixturesOn = (sync?.fixtures || feed).length > 0 || feed.length > 0;
  const [focusMode, setFocusMode] = useState(() => {
    try {
      return localStorage.getItem('vtop.focusMode') === '1';
    } catch {
      return false;
    }
  });
  const toggleFocus = (on) => {
    setFocusMode(on);
    try {
      localStorage.setItem('vtop.focusMode', on ? '1' : '0');
    } catch {
      // ignore
    }
  };

  return (
    <div className="app-shell compact">
      {flash && <div className={`settle-flash ${flash.won ? 'won' : 'lost'}`}>{flash.text}</div>}
      <OdiCountdownHeader />

      <div className={`board-split ${focusMode ? 'focus' : ''}`}>
        <section className="panel feed">
          <header className="panel-head">
            <div>
              <span className="kicker">{phase === 'live' ? 'LIVE on Odibet' : 'English League'}</span>
              <h2>{phase === 'live' ? 'Live matchday' : 'Match feed'}</h2>
            </div>
            <CopyPicks />
            {focusMode && (
              <button type="button" className="cyber-btn active" onClick={() => toggleFocus(false)}>
                Focus mode
              </button>
            )}
          </header>
          <div className="feed-tools">
            <div className="btn-row">
              <button
                type="button"
                className={`cyber-btn ${stakeMode === 'both' && feedFilter === 'all' ? 'active' : ''}`}
                onClick={() => {
                  setStakeMode('both');
                  setFeedFilter('all');
                }}
              >
                All
              </button>
              <button
                type="button"
                className={`cyber-btn ${stakeMode === '1x2' ? 'active' : ''}`}
                onClick={() => setStakeMode('1x2')}
              >
                1X2
              </button>
              <button
                type="button"
                className={`cyber-btn ${stakeMode === 'extra' ? 'active' : ''}`}
                onClick={() => setStakeMode('extra')}
              >
                View mode
              </button>
            </div>
            <div className="btn-row">
              <button type="button" className={`cyber-btn ${feedFilter === 'sure-extra' ? 'active' : ''}`} onClick={() => setFeedFilter('sure-extra')}>
                Sure extra
              </button>
              <button type="button" className={`cyber-btn ${feedFilter === 'skip-extra' ? 'active' : ''}`} onClick={() => setFeedFilter('skip-extra')}>
                Skip extra
              </button>
            </div>
          </div>
          {error && <p className="banner">{error}</p>}
          {busy && !feed.length && <p className="hint">syncing Odibet…</p>}
          {fixturesOn ? (
            <div className="cards">
              {visibleFeed.map((row) => (
                <MatchFeedCard key={row.fixture.fixtureId} row={row} focusMode={focusMode} />
              ))}
            </div>
          ) : (
            <div className="intermission">
              <p className="intermission-clock">{status.countdownLabel || sync?.countdownLabel || '00:00'}</p>
              <p className="hint">Waiting for the next Odibet English League card.</p>
            </div>
          )}
          {fixturesOn && !visibleFeed.length && <p className="hint">No cards in this filter.</p>}
        </section>
        {!focusMode && <NextEventStage onFocusMode={() => toggleFocus(true)} />}
      </div>

      <RoundChecker />
      <DemoStats />
    </div>
  );
}

export default Home;
