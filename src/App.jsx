import React, { useState, useEffect, useRef } from 'react';

// ============================================================================
// DERIV EVEN/ODD MARKET RANKER
// ============================================================================
// Ranks all Volatility Index markets by how tradable they currently are for
// Even/Odd digit contracts: rolling bias, statistical deviation, streak
// behavior, and bias stability.
//
// Two data modes, switchable in the UI:
//   - Demo:  simulated ticks, works anywhere
//   - Live:  real Deriv WebSocket feed — needs your own app_id
// ============================================================================

const MARKETS = [
  { symbol: 'R_10', label: 'Volatility 10' },
  { symbol: 'R_25', label: 'Volatility 25' },
  { symbol: 'R_50', label: 'Volatility 50' },
  { symbol: 'R_75', label: 'Volatility 75' },
  { symbol: 'R_100', label: 'Volatility 100' },
  { symbol: '1HZ10V', label: 'Volatility 10 (1s)' },
  { symbol: '1HZ25V', label: 'Volatility 25 (1s)' },
  { symbol: '1HZ50V', label: 'Volatility 50 (1s)' },
  { symbol: '1HZ75V', label: 'Volatility 75 (1s)' },
  { symbol: '1HZ100V', label: 'Volatility 100 (1s)' },
];

const WINDOW_SIZE = 200;
const DERIV_WS_URL = 'wss://ws.deriv.com/websockets/v3';

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function scoreMarket(digits) {
  if (digits.length < 30) return null;

  const n = digits.length;
  const evens = digits.filter((d) => d % 2 === 0).length;
  const evenPct = (evens / n) * 100;

  const expected = n / 2;
  const sd = Math.sqrt(n * 0.5 * 0.5);
  const z = (evens - expected) / sd;

  let streak = 1;
  const lastParity = digits[n - 1] % 2;
  for (let i = n - 2; i >= 0 && digits[i] % 2 === lastParity; i--) streak++;

  const half = Math.floor(n / 2);
  const firstHalfEvenPct =
    (digits.slice(0, half).filter((d) => d % 2 === 0).length / half) * 100;
  const secondHalfEvenPct =
    (digits.slice(half).filter((d) => d % 2 === 0).length / (n - half)) * 100;
  const stability = 100 - Math.abs(firstHalfEvenPct - secondHalfEvenPct);

  const deviation = Math.abs(evenPct - 50);
  const absZ = Math.abs(z);
  const tradability = deviation * 0.4 + Math.min(absZ, 4) * 10 * 0.35 + stability * 0.25;

  let label = 'Neutral';
  if (absZ >= 2 && stability >= 55) {
    label = evenPct > 50 ? 'Strong Even Bias' : 'Strong Odd Bias';
  } else if (absZ >= 1.2) {
    label = evenPct > 50 ? 'Mild Even Bias' : 'Mild Odd Bias';
  } else if (stability < 40) {
    label = 'Unstable / Avoid';
  }

  return {
    evenPct: evenPct.toFixed(1),
    oddPct: (100 - evenPct).toFixed(1),
    z: z.toFixed(2),
    streak,
    streakParity: lastParity === 0 ? 'Even' : 'Odd',
    stability: stability.toFixed(0),
    tradability: tradability.toFixed(1),
    label,
    sampleSize: n,
  };
}

// ---------------------------------------------------------------------------
// Demo feed — simulated ticks
// ---------------------------------------------------------------------------
function useSimulatedFeed(markets, enabled) {
  const [ticksByMarket, setTicksByMarket] = useState(() =>
    Object.fromEntries(markets.map((m) => [m.symbol, []]))
  );
  const biasRef = useRef(
    Object.fromEntries(markets.map((m) => [m.symbol, 0.5 + (Math.random() - 0.5) * 0.14]))
  );

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      setTicksByMarket((prev) => {
        const next = { ...prev };
        markets.forEach((m) => {
          biasRef.current[m.symbol] += (Math.random() - 0.5) * 0.01;
          biasRef.current[m.symbol] = Math.min(0.62, Math.max(0.38, biasRef.current[m.symbol]));
          const isEven = Math.random() < biasRef.current[m.symbol];
          const digit = isEven
            ? [0, 2, 4, 6, 8][Math.floor(Math.random() * 5)]
            : [1, 3, 5, 7, 9][Math.floor(Math.random() * 5)];
          const arr = [...(prev[m.symbol] || []), digit];
          next[m.symbol] = arr.length > WINDOW_SIZE ? arr.slice(-WINDOW_SIZE) : arr;
        });
        return next;
      });
    }, 450);
    return () => clearInterval(interval);
  }, [markets, enabled]);

  return { ticksByMarket, status: enabled ? 'connected' : 'idle' };
}

// ---------------------------------------------------------------------------
// Live feed — Deriv WebSocket with new endpoint
// ---------------------------------------------------------------------------
function lastDigitOf(quote, decimals) {
  const fixed = Number(quote).toFixed(decimals);
  return parseInt(fixed[fixed.length - 1], 10);
}

function useDerivFeed(markets, appId, enabled) {
  const [ticksByMarket, setTicksByMarket] = useState(() =>
    Object.fromEntries(markets.map((m) => [m.symbol, []]))
  );
  const [status, setStatus] = useState('idle');
  const decimalsRef = useRef({});
  const wsRef = useRef(null);
  const subscriptionsRef = useRef(new Set());

  useEffect(() => {
    if (!enabled || !appId) {
      setStatus('idle');
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (e) {}
        wsRef.current = null;
      }
      return;
    }

    setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(`${DERIV_WS_URL}?app_id=${appId}`);
    } catch (e) {
      console.error('WebSocket creation failed:', e);
      setStatus('error');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setStatus('connected');
      markets.forEach((m) => {
        ws.send(
          JSON.stringify({
            ticks_history: m.symbol,
            count: WINDOW_SIZE,
            end: 'latest',
            style: 'ticks',
            req_id: m.symbol,
          })
        );
      });
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        console.error('JSON parse error:', e);
        return;
      }

      if (data.error) {
        console.error('Deriv API error:', data.error.message);
        setStatus('error');
        return;
      }

      // History response
      if (data.msg_type === 'history' && data.echo_req && data.echo_req.ticks_history) {
        const symbol = data.echo_req.ticks_history;
        const decimals = data.pip_size != null ? data.pip_size : 2;
        decimalsRef.current[symbol] = decimals;
        const prices = (data.history && data.history.prices) || [];
        const digits = prices.map((p) => lastDigitOf(p, decimals));
        setTicksByMarket((prev) => ({
          ...prev,
          [symbol]: digits.slice(-WINDOW_SIZE),
        }));

        // Subscribe to live ticks
        if (!subscriptionsRef.current.has(symbol)) {
          ws.send(
            JSON.stringify({
              ticks: symbol,
              subscribe: 1,
              req_id: `${symbol}_live`,
            })
          );
          subscriptionsRef.current.add(symbol);
        }
      }

      // Live tick stream
      if (data.msg_type === 'tick' && data.tick) {
        const { symbol, quote, pip_size } = data.tick;
        const decimals =
          pip_size != null
            ? pip_size
            : decimalsRef.current[symbol] != null
            ? decimalsRef.current[symbol]
            : 2;
        const digit = lastDigitOf(quote, decimals);
        setTicksByMarket((prev) => {
          const arr = [...(prev[symbol] || []), digit];
          return {
            ...prev,
            [symbol]: arr.length > WINDOW_SIZE ? arr.slice(-WINDOW_SIZE) : arr,
          };
        });
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setStatus('error');
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      setStatus((s) => (s === 'error' ? s : 'closed'));
    };

    return () => {
      subscriptionsRef.current.clear();
      try {
        ws.close();
      } catch (e) {}
    };
  }, [enabled, appId, markets]);

  return { ticksByMarket, status };
}

// ---------------------------------------------------------------------------
// UI Components
// ---------------------------------------------------------------------------
const ACCENT = '#E8A33D';
const EVEN_COLOR = '#4C9F70';
const ODD_COLOR = '#C1654B';

function Bar({ evenPct }) {
  return (
    <div
      style={{
        display: 'flex',
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
        background: '#232B36',
      }}
    >
      <div style={{ width: `${evenPct}%`, background: EVEN_COLOR }} />
      <div style={{ width: `${100 - evenPct}%`, background: ODD_COLOR }} />
    </div>
  );
}

function MarketRow({ rank, market, score, isTop }) {
  if (!score) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '32px 1fr 90px',
          gap: 16,
          alignItems: 'center',
          padding: '14px 18px',
          color: '#5C6570',
          fontSize: 13,
        }}
      >
        <span>—</span>
        <span>{market.label}</span>
        <span>warming up…</span>
      </div>
    );
  }

  const labelColor = score.label.includes('Strong')
    ? ACCENT
    : score.label.includes('Avoid')
    ? '#8A93A0'
    : '#B7BEC7';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 1fr 130px 90px 90px',
        gap: 16,
        alignItems: 'center',
        padding: '16px 18px',
        borderRadius: 10,
        background: isTop ? 'rgba(232,163,61,0.08)' : 'transparent',
        border: isTop ? '1px solid rgba(232,163,61,0.35)' : '1px solid transparent',
      }}
    >
      <span
        style={{
          fontFamily: 'ui-monospace, monospace',
          color: '#5C6570',
          fontSize: 13,
        }}
      >
        {String(rank).padStart(2, '0')}
      </span>

      <div>
        <div style={{ fontSize: 14.5, color: '#E5E2DC', marginBottom: 6 }}>
          {market.label}
        </div>
        <Bar evenPct={parseFloat(score.evenPct)} />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
            fontSize: 11,
            color: '#7C8591',
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          <span>{score.evenPct}% even</span>
          <span>{score.oddPct}% odd</span>
        </div>
      </div>

      <span style={{ fontSize: 12.5, color: labelColor }}>{score.label}</span>

      <div
        style={{
          fontSize: 12.5,
          color: '#B7BEC7',
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        z {score.z}
      </div>

      <div
        style={{
          fontSize: 12.5,
          color: '#B7BEC7',
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        streak {score.streak}{score.streakParity[0]}
      </div>
    </div>
  );
}

const STATUS_COPY = {
  idle: { text: 'Demo mode', color: '#7C8591' },
  connecting: { text: 'Connecting…', color: ACCENT },
  connected: { text: 'Live', color: EVEN_COLOR },
  error: { text: 'Connection error — check app ID', color: ODD_COLOR },
  closed: { text: 'Disconnected', color: '#7C8591' },
};

export default function EvenOddRanker() {
  const [mode, setMode] = useState('demo');
  const [appId, setAppId] = useState('');

  const demo = useSimulatedFeed(MARKETS, mode === 'demo');
  const live = useDerivFeed(MARKETS, appId, mode === 'live');

  const { ticksByMarket, status } = mode === 'live' ? live : demo;

  const ranked = MARKETS.map((m) => ({
    market: m,
    score: scoreMarket(ticksByMarket[m.symbol] || []),
  })).sort((a, b) => {
    if (!a.score) return 1;
    if (!b.score) return -1;
    return parseFloat(b.score.tradability) - parseFloat(a.score.tradability);
  });

  const top = ranked[0];
  const statusInfo = STATUS_COPY[status] || STATUS_COPY.idle;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0F1419',
        color: '#E5E2DC',
        fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        padding: '28px 20px 40px',
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 18,
          }}
        >
          <div>
            <div style={{ fontSize: 12.5, color: statusInfo.color, marginBottom: 4 }}>
              {statusInfo.text}
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.3 }}>
              Even / Odd market ranker
            </h1>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setMode('demo')}
              style={{
                padding: '6px 12px',
                borderRadius: 7,
                fontSize: 12.5,
                cursor: 'pointer',
                border: mode === 'demo' ? `1px solid ${ACCENT}` : '1px solid #232B36',
                background:
                  mode === 'demo' ? 'rgba(232,163,61,0.12)' : 'transparent',
                color: mode === 'demo' ? ACCENT : '#8A93A0',
              }}
            >
              Demo
            </button>
            <button
              onClick={() => setMode('live')}
              style={{
                padding: '6px 12px',
                borderRadius: 7,
                fontSize: 12.5,
                cursor: 'pointer',
                border: mode === 'live' ? `1px solid ${ACCENT}` : '1px solid #232B36',
                background:
                  mode === 'live' ? 'rgba(232,163,61,0.12)' : 'transparent',
                color: mode === 'live' ? ACCENT : '#8A93A0',
              }}
            >
              Live
            </button>
          </div>
        </div>

        {mode === 'live' && (
          <div style={{ marginBottom: 18 }}>
            <input
              value={appId}
              onChange={(e) => setAppId(e.target.value.trim())}
              placeholder="Your Deriv app_id (from api.deriv.com/dashboard)"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                borderRadius: 8,
                background: '#171D26',
                border: '1px solid #232B36',
                color: '#E5E2DC',
                fontSize: 13,
                outline: 'none',
              }}
            />
            {!appId && (
              <div style={{ fontSize: 11.5, color: '#7C8591', marginTop: 6 }}>
                Live mode needs an app_id. Register at{' '}
                <a
                  href="https://api.deriv.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: ACCENT, textDecoration: 'none' }}
                >
                  api.deriv.com/dashboard
                </a>
              </div>
            )}
          </div>
        )}

        {top && top.score && (
          <div
            style={{
              padding: '20px 22px',
              borderRadius: 14,
              marginBottom: 22,
              background:
                'linear-gradient(135deg, rgba(232,163,61,0.14), rgba(232,163,61,0.03))',
              border: '1px solid rgba(232,163,61,0.3)',
            }}
          >
            <div style={{ fontSize: 12, color: '#C9A876', marginBottom: 6 }}>
              Best market right now
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 10 }}>
              {top.market.label}
            </div>
            <div style={{ fontSize: 13.5, color: '#D9CDB3' }}>
              {top.score.label} · {top.score.evenPct}% even over last{' '}
              {top.score.sampleSize} ticks · stability {top.score.stability}%
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {ranked.map((r, i) => (
            <MarketRow
              key={r.market.symbol}
              rank={i + 1}
              market={r.market}
              score={r.score}
              isTop={i === 0}
            />
          ))}
        </div>

        <div
          style={{
            marginTop: 24,
            fontSize: 11.5,
            color: '#5C6570',
            lineHeight: 1.6,
          }}
        >
          Tradability score blends deviation from 50/50, statistical confidence (z-score),
          and bias stability across the rolling window.
        </div>
      </div>
    </div>
  );
}
