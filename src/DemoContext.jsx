import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchResults } from './api';
import {
  beep,
  loadPending,
  loadSlips,
  loadStats,
  loadWallet,
  placeSlip,
  savePending,
  settleOpenSlips,
} from './demoBank';
import { useBot } from './BotContext';

const DemoContext = createContext(null);

function selId(row) {
  return `${row.fixtureId}:${row.key}`;
}

export function DemoProvider({ children }) {
  const { sync, feed } = useBot();
  const [slips, setSlips] = useState(() => loadSlips());
  const [stats, setStats] = useState(() => loadStats());
  const [wallet, setWallet] = useState(() => loadWallet());
  const [pending, setPending] = useState(() => loadPending());
  const [flash, setFlash] = useState(null);

  const refresh = useCallback(() => {
    setSlips(loadSlips());
    setStats(loadStats());
    setWallet(loadWallet());
    setPending(loadPending());
  }, []);

  const settle = useCallback(async () => {
    const open = loadSlips().some((row) => row.status === 'open');
    if (!open) return;
    let results = sync?.results || [];
    try {
      const pack = await fetchResults();
      results = pack.results || results;
    } catch {
      // keep last
    }
    const fixtures = (feed || []).map((row) => row.fixture || row);
    const next = settleOpenSlips({ results, fixtures });
    if (next.changed) {
      setSlips(next.slips);
      setStats(next.stats);
      setWallet(next.wallet);
      const won = next.justSettled.some((row) => row.status === 'won');
      const lost = next.justSettled.some((row) => row.status === 'lost');
      beep(won && !lost ? true : !won);
      setFlash({
        won,
        lost,
        text: next.justSettled
          .map((row) => `${row.status.toUpperCase()} · ${row.matchdayTime || ''} · KSh ${row.stake}`)
          .join(' · '),
      });
    }
  }, [sync, feed]);

  useEffect(() => {
    settle();
    const timer = setInterval(settle, 8000);
    return () => clearInterval(timer);
  }, [settle]);

  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(timer);
  }, [flash]);

  const addPending = useCallback((pick) => {
    setPending((prev) => {
      const id = selId(pick);
      const next = prev.some((row) => selId(row) === id)
        ? prev
        : [...prev, pick];
      savePending(next);
      return next;
    });
  }, []);

  const setPicks = useCallback((next) => {
    setPending((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      savePending(value);
      return value;
    });
  }, []);

  const place = useCallback(
    (payload) => {
      if (sync?.phase === 'live') {
        return { error: 'Card is LIVE — demo bets lock at kickoff.' };
      }
      const result = placeSlip(payload);
      refresh();
      return result;
    },
    [refresh, sync?.phase]
  );

  const liveLocked = sync?.phase === 'live';

  const value = useMemo(
    () => ({
      slips,
      stats,
      wallet,
      pending,
      openSlips: slips.filter((row) => row.status === 'open'),
      place,
      refresh,
      addPending,
      setPicks,
      liveLocked,
      flash,
    }),
    [slips, stats, wallet, pending, place, refresh, addPending, setPicks, liveLocked, flash]
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error('useDemo must be used within DemoProvider');
  return ctx;
}
