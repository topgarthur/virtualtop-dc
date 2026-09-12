import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeMatchday, controlBot, fetchLogs, fetchStatus, fetchSync } from './api';

const BotContext = createContext(null);

export function BotProvider({ children }) {
  const [riskProfile, setRiskProfile] = useState('balanced');
  const [status, setStatus] = useState({
    running: false,
    circuitOpen: false,
    lastPredictions: [],
    phase: 'prematch',
    countdownLabel: '00:00',
    countdownSeconds: 0,
    standings: { seasonId: '2026091202', rows: [] },
  });
  const [sync, setSync] = useState(null);
  const [feed, setFeed] = useState([]);
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const analyzedKey = useRef(null);

  const applySync = useCallback((snapshot, rows) => {
    setSync(snapshot);
    if (rows) setFeed(rows);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, snapshot] = await Promise.all([fetchStatus(), fetchSync(selectedPeriod)]);
      setStatus(nextStatus);
      setError(null);

      const key = `${snapshot.phase}|${snapshot.matchdayTime}|${(snapshot.fixtures || [])
        .map((row) => `${row.fixtureId}:${row.score}`)
        .join('|')}`;

      const expireSelection = () => {
        const stillListed = (snapshot.periods || []).some((period) => period.startTime === selectedPeriod);
        if (selectedPeriod && !stillListed) setSelectedPeriod(null);
      };

      if (nextStatus.lastPredictions?.length && nextStatus.matchdayTime === snapshot.matchdayTime) {
        analyzedKey.current = key;
        applySync({ ...snapshot, strategy: snapshot.strategy || nextStatus.strategy }, nextStatus.lastPredictions);
        expireSelection();
        return;
      }

      if (!snapshot.fixtures?.length) {
        analyzedKey.current = key;
        applySync({ ...snapshot, strategy: snapshot.strategy || nextStatus.strategy }, []);
        expireSelection();
        return;
      }

      if (analyzedKey.current === key) {
        applySync({ ...snapshot, strategy: snapshot.strategy || nextStatus.strategy });
        expireSelection();
        return;
      }

      setBusy(true);
      const analyzed = await analyzeMatchday({
        matchdayTime: snapshot.matchdayTime,
        fixtures: snapshot.fixtures,
        seasonId: snapshot.seasonId,
        week: snapshot.week,
        phase: snapshot.phase,
      });
      analyzedKey.current = key;
      applySync(
        {
          ...snapshot,
          strategy: {
            ...(snapshot.strategy || nextStatus.strategy || {}),
            current: analyzed.round || snapshot.strategy?.current,
          },
        },
        analyzed.rows || []
      );
      expireSelection();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [applySync, selectedPeriod]);

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
    setSelectedPeriod(startTime);
    analyzedKey.current = null;
  }, []);

  useEffect(() => {
    refresh();
    fetchLogs()
      .then((data) => setLogs(data.logs || []))
      .catch(() => {});
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const source = new EventSource('/v1/bot/logs?stream=1');
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.hello && payload.recent) {
          setLogs((prev) => (prev.length ? prev : payload.recent));
          return;
        }
        setLogs((prev) => {
          const next = [...prev, payload];
          return next.length > 180 ? next.slice(next.length - 180) : next;
        });
      } catch {
        // ignore malformed SSE frames
      }
    };
    source.onerror = () => {};
    return () => source.close();
  }, []);

  const value = useMemo(
    () => ({
      riskProfile,
      setRiskProfile,
      status,
      sync,
      feed,
      logs,
      busy,
      error,
      start,
      stop,
      refresh,
      selectedPeriod,
      selectPeriod,
    }),
    [riskProfile, status, sync, feed, logs, busy, error, start, stop, refresh, selectedPeriod, selectPeriod]
  );

  return <BotContext.Provider value={value}>{children}</BotContext.Provider>;
}

export function useBot() {
  const ctx = useContext(BotContext);
  if (!ctx) throw new Error('useBot must be used within BotProvider');
  return ctx;
}
