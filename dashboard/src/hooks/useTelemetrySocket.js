import { useEffect, useRef, useState } from 'react';
import { initialTelemetry, nextDemoFrame } from '../data/demoTelemetry';

const TREND_LENGTH = 40;
const DEMO_TICK_MS = 1200;
const SOCKET_URL = import.meta.env.VITE_TWIN_SOCKET_URL || 'ws://localhost:8002/ws/telemetry';

function healthFor(frame) {
  const sensors = frame.sensors;
  const flags = frame.breach_flags || {};
  const critical = flags.cht_over || flags.egt_over || flags.oil_press_low || flags.oil_temp_over;
  const caution = critical || sensors.vibration_g >= 1.2;
  return {
    score: critical ? 58 : caution ? 78 : 96,
    status: critical ? 'CRITICAL' : caution ? 'CAUTION' : 'HEALTHY',
    rulHours: critical ? 18 : caution ? 64 : 180,
    confidence: 92,
  };
}

// twin-core frames are engine-centric. Keep this translation at the network
// boundary so the viewer and all dashboard components read one stable shape.
function toDashboardTelemetry(payload, previous = initialTelemetry) {
  const frame = payload?.telemetry_frame || payload?.data || payload;
  if (!frame?.sensors) return null;
  const s = frame.sensors;
  const health = healthFor(frame);
  const engine = {
    rpm: Number(s.rpm) || 0,
    cht: Number(s.cht_c) || 0,
    egt: Number(s.egt_c) || 0,
    oilPressure: Number(s.oil_press_psi) || 0,
    vibration: Number(s.vibration_g) || 0,
  };
  const alerts = health.status === 'HEALTHY' ? [] : [{
    id: `engine-${frame.cycle}`,
    level: health.status === 'CRITICAL' ? 'critical' : 'warn',
    msg: 'ENGINE LIMIT EXCEEDED',
    time: new Date(frame.timestamp).toLocaleTimeString(),
  }];
  return {
    ...previous,
    uavId: `UAV-${String(frame.unit_id ?? 1).padStart(2, '0')}`,
    missionState: String(frame.phase || 'CRUISE').toUpperCase(),
    timestamp: frame.timestamp || new Date().toISOString(),
    engine,
    health,
    alerts,
  };
}

function pushTrend(trend, frame) {
  const point = {
    t: new Date(frame.timestamp).toLocaleTimeString('en-US', { hour12: false }),
    rpm: Math.round(frame.engine.rpm), egt: Math.round(frame.engine.egt), cht: Math.round(frame.engine.cht),
    voltage: Number(frame.battery.voltage.toFixed(1)), current: Number(frame.battery.current.toFixed(1)),
  };
  return [...(trend.length >= TREND_LENGTH ? trend.slice(1) : trend), point];
}

export default function useTelemetrySocket(unitId = 1) {
  const [telemetry, setTelemetry] = useState(initialTelemetry);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState('connecting');
  const demoTimerRef = useRef(null);
  const trendRef = useRef([]);

  useEffect(() => {
    let cancelled = false;
    const startDemo = () => {
      if (demoTimerRef.current) return;
      setMode('simulated');
      setConnected(true);
      demoTimerRef.current = setInterval(() => setTelemetry((previous) => {
        const next = nextDemoFrame(previous);
        trendRef.current = pushTrend(trendRef.current, next);
        return { ...next, trend: trendRef.current };
      }), DEMO_TICK_MS);
    };

    const socket = new WebSocket(`${SOCKET_URL}?unit_id=${unitId}`);
    socket.onopen = () => { if (!cancelled) { setConnected(true); setMode('live'); } };
    socket.onmessage = (event) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse(event.data);
        setTelemetry((previous) => {
          const next = toDashboardTelemetry(payload, previous);
          if (!next) return previous;
          trendRef.current = pushTrend(trendRef.current, next);
          return { ...next, trend: trendRef.current };
        });
      } catch { /* retain last valid frame */ }
    };
    socket.onerror = startDemo;
    socket.onclose = () => { if (!cancelled) startDemo(); };
    return () => {
      cancelled = true;
      socket.close();
      clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
    };
  }, [unitId]);

  return { telemetry, connected, mode };
}
