import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeMatchday, controlBot, fetchStatus, fetchSync, overrideStake } from './api';

const BotContext = createContext(null);

function idsKey(fixtures) {
  return (fixtures || []).map((row) => row.fixtureId).join('|');
}

function goalsOf(fx) {
  const h = fx?.homeGoals;
  const a = fx?.awayGoals;
  if (h == null || a == null || Number.isNaN(Number(h)) || Number.isNaN(Number(a))) return null;
  return Number(h) + Number(a);
}

function mergeLiveFixture(prev, fresh) {
  if (!fresh) return prev;
  const next = { ...prev, ...fresh };
  const prevG = goalsOf(prev);
  const freshG = goalsOf(fresh);
  if (freshG == null && prevG != null) {
    next.score = prev.score;
    next.homeGoals = prev.homeGoals;
    next.awayGoals = prev.awayGoals;
  } else if (freshG === 0 && prevG > 0) {
    next.score = prev.score;
    next.homeGoals = prev.homeGoals;
    next.awayGoals = prev.awayGoals;
  }
  return next;
}

function mergeLiveRows(rows, fixtures) {
  return (rows || []).map((row) => {
    const fresh = (fixtures || []).find((item) => String(item.fixtureId) === String(row.fixture?.fixtureId));
    return fresh ? { ...row, fixture: mergeLiveFixture(row.fixture, fresh) } : row;
  });
}

function readStore(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function BotProvider({ children }) {
  const [status, setStatus] = useState({
    running: false,
    lastPredictions: [],
    phase: 'prematch',
    countdownLabel: '00:00',
    countdownSeconds: 0,
    standings: { seasonId: '2026091202', rows: [] },
  });
  const [sync, setSync] = useState(null);
  const [feed, setFeed] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [stakeMode, setStakeModeState] = useState(() => readStore('vtop.stakeMode.v2', 'both'));
  const [stakeUnit, setStakeUnitState] = useState(() => Number(readStore('vtop.unit', '50')) || 50);
  const [feedFilter, setFeedFilterState] = useState(() => {
    const stored = readStore('vtop.feedFilter', 'all');
    return stored === 'sure-extra' || stored === 'skip-extra' ? 'all' : stored || 'all';
  });
  const selectedRef = useRef(null);
  const genRef = useRef(0);
  const cacheRef = useRef(new Map());
  const liveCountRef = useRef({ seconds: 0, at: null });
  const clickLock = useRef(false);

  const setStakeMode = useCallback((value) => {
    setStakeModeState(value);
    writeStore('vtop.stakeMode.v2', value);
  }, []);
  const setStakeUnit = useCallback((value) => {
    setStakeUnitState(Number(value));
    writeStore('vtop.unit', String(value));
  }, []);
  const setFeedFilter = useCallback((value) => {
    setFeedFilterState(value);
    writeStore('vtop.feedFilter', value);
  }, []);

  const applySync = useCallback((snapshot, rows) => {
    const merged = {
      ...snapshot,
      countdownSeconds: liveCountRef.current.seconds || snapshot.countdownSeconds,
      generatedAt: liveCountRef.current.at || snapshot.generatedAt,
    };
    setSync(merged);
    if (rows) setFeed(rows);
  }, []);

  const loadCard = useCallback(async (period) => {
    const mine = ++genRef.current;
    const cached = period ? cacheRef.current.get(period) : null;
    if (cached?.rows?.length) {
      applySync(cached.snapshot, cached.rows);
    }
    try {
      const snapshot = await fetchSync(period, { lite: Boolean(period) });
      if (mine !== genRef.current) return;
      if (snapshot.countdownSeconds != null) {
        liveCountRef.current = { seconds: snapshot.countdownSeconds, at: snapshot.generatedAt };
      }
      setError(null);

      const want = selectedRef.current;
      if (want && snapshot.selectedPeriod && snapshot.selectedPeriod !== want) {
        return;
      }

      const ids = idsKey(snapshot.fixtures);
      const hit = cacheRef.current.get(snapshot.selectedPeriod);
      if (hit && hit.ids === ids && hit.rows?.length) {
        const rows = mergeLiveRows(hit.rows, snapshot.fixtures);
        cacheRef.current.set(snapshot.selectedPeriod, { snapshot, rows, ids });
        applySync({ ...snapshot, strategy: snapshot.strategy || hit.snapshot.strategy }, rows);
        return;
      }

      const placeholders = (snapshot.fixtures || []).map((fixture) => {
        const prev = hit?.rows?.find((row) => row.fixture.fixtureId === fixture.fixtureId);
        return prev || { fixture, analysis: { prediction: null, vector: {}, aux: { vector: {} } } };
      });
      applySync(snapshot, placeholders);

      if (!snapshot.fixtures?.length) return;

      const analyzed = await analyzeMatchday({
        matchdayTime: snapshot.matchdayTime,
        fixtures: snapshot.fixtures,
        seasonId: snapshot.seasonId,
        week: snapshot.week,
        phase: snapshot.phase,
      });
      if (mine !== genRef.current) return;
      const rows = analyzed.rows || [];
      cacheRef.current.set(snapshot.selectedPeriod, { snapshot, rows, ids });
      applySync(
        {
          ...snapshot,
          strategy: {
            ...(snapshot.strategy || {}),
            current: analyzed.round || snapshot.strategy?.current,
          },
        },
        rows
      );
    } catch (err) {
      if (mine !== genRef.current) return;
      setError(
        /fetch|Failed|ECONNREFUSED|API not found/i.test(err.message)
          ? 'API offline — host needs the Node server (not a static Vercel site). Locally run npm run server.'
          : err.message
      );
    } finally {
      if (mine === genRef.current) setBusy(false);
    }
  }, [applySync]);

  const poll = useCallback(async () => {
    if (clickLock.current) return;
    try {
      const nextStatus = await fetchStatus();
      setStatus(nextStatus);
      const period = selectedRef.current;
      const snapshot = await fetchSync(period, { lite: true });
      if (snapshot.countdownSeconds != null) {
        liveCountRef.current = { seconds: snapshot.countdownSeconds, at: snapshot.generatedAt };
      }
      setSync((prev) => {
        if (!prev) return snapshot;
        return {
          ...prev,
          countdownSeconds: snapshot.countdownSeconds,
          countdownLabel: snapshot.countdownLabel,
          generatedAt: snapshot.generatedAt,
          periods: snapshot.periods || prev.periods,
          strategy: snapshot.strategy || nextStatus.strategy || prev.strategy,
          standings: snapshot.standings?.length ? snapshot.standings : prev.standings,
          fixtures: snapshot.fixtures?.length ? snapshot.fixtures : prev.fixtures,
          phase: snapshot.phase || prev.phase,
        };
      });
      setFeed((prev) => {
        if (prev.length) return prev;
        return (snapshot.fixtures || []).map((fixture) => ({
          fixture,
          analysis: { prediction: null, vector: {}, aux: { vector: {} } },
        }));
      });
      const want = selectedRef.current;
      if (want && snapshot.selectedPeriod !== want) return;
      const ids = idsKey(snapshot.fixtures);
      const key = snapshot.selectedPeriod;
      const hit = cacheRef.current.get(key);
      if (snapshot.phase === 'live' && key === (want || snapshot.livePeriodStart || key)) {
        if (!hit || hit.ids !== ids) {
          loadCard(period);
        } else {
          setFeed((prev) => {
            const rows = mergeLiveRows(prev, snapshot.fixtures);
            const cached = cacheRef.current.get(key);
            if (cached) cacheRef.current.set(key, { ...cached, rows });
            return rows;
          });
        }
        return;
      }
      if (!want && (!hit || hit.ids !== ids)) {
        loadCard(null);
      }
    } catch {
      // keep last good frame; loadCard shows hard errors
    }
  }, [loadCard]);

  const start = useCallback(async () => {
    try {
      const next = await controlBot({ action: 'START' });
      setStatus(next);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      const next = await controlBot({ action: 'STOP' });
      setStatus(next);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const selectPeriod = useCallback((startTime) => {
    if (selectedRef.current === startTime) return;
    selectedRef.current = startTime;
    setSelectedPeriod(startTime);
    clickLock.current = true;
    const hit = cacheRef.current.get(startTime);
    if (hit?.rows?.length) applySync(hit.snapshot, hit.rows);
    else setBusy(true);
    loadCard(startTime).finally(() => {
      clickLock.current = false;
    });
  }, [applySync, loadCard]);

  const overrideEasy = useCallback((fixtureId, easyPick) => {
    setFeed((prev) => {
      const next = prev.map((row) => {
        if (String(row.fixture.fixtureId) !== String(fixtureId)) return row;
        return { ...row, analysis: { ...row.analysis, easyPick: { ...easyPick, overridden: true } } };
      });
      const period = selectedRef.current || sync?.selectedPeriod;
      if (period && cacheRef.current.has(period)) {
        const hit = cacheRef.current.get(period);
        cacheRef.current.set(period, { ...hit, rows: next });
      }
      return next;
    });
    overrideStake({
      seasonId: sync?.seasonId,
      week: sync?.week,
      matchdayTime: sync?.matchdayTime,
      fixtureId,
      easyPick,
    }).catch(() => {});
  }, [sync]);

  useEffect(() => {
    loadCard(null);
  }, [loadCard]);

  useEffect(() => {
    const timer = setInterval(poll, sync?.phase === 'live' || status.phase === 'live' ? 1200 : 2500);
    return () => clearInterval(timer);
  }, [poll, sync?.phase, status.phase]);

  const visibleFeed = useMemo(() => {
    let rows = feed;
    if (feedFilter === 'sure-extra') rows = feed.filter((row) => row.analysis?.easyAdvice === 'SURE_BET');
    else if (feedFilter === 'skip-extra') rows = feed.filter((row) => row.analysis?.easyAdvice === 'DONT_RISK');
    if (!rows.length && feed.length) return feed;
    return rows;
  }, [feed, feedFilter]);

  const value = useMemo(
    () => ({
      status,
      sync,
      feed,
      visibleFeed,
      busy,
      error,
      start,
      stop,
      refresh: () => loadCard(selectedRef.current),
      selectedPeriod,
      selectPeriod,
      stakeMode,
      setStakeMode,
      stakeUnit,
      setStakeUnit,
      feedFilter,
      setFeedFilter,
      overrideEasy,
    }),
    [
      status,
      sync,
      feed,
      visibleFeed,
      busy,
      error,
      start,
      stop,
      selectedPeriod,
      selectPeriod,
      stakeMode,
      setStakeMode,
      stakeUnit,
      setStakeUnit,
      feedFilter,
      setFeedFilter,
      overrideEasy,
      loadCard,
    ]
  );

  return <BotContext.Provider value={value}>{children}</BotContext.Provider>;
}

export function useBot() {
  const ctx = useContext(BotContext);
  if (!ctx) throw new Error('useBot must be used within BotProvider');
  return ctx;
}
