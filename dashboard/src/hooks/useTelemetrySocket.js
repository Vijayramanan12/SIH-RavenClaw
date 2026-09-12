import { useEffect, useRef, useState } from 'react';
import { initialTelemetry, nextDemoFrame } from '../data/demoTelemetry';

const TREND_LENGTH = 40;
const DEMO_TICK_MS = 1200;
const SOCKET_URL = import.meta.env.VITE_TWIN_SOCKET_URL || 'ws://localhost:8002/ws/telemetry';
const ML_API_URL = import.meta.env.VITE_ML_API_URL || 'http://localhost:8003';

function fallbackHealthFor(frame) {
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

function healthForModel(report, fallback) {
  if (!report?.fault_probabilities) return fallback;
  const probabilities = report.fault_probabilities;
  const faultRisk = 1 - Math.max(0, Math.min(1, Number(probabilities.none) || 0));
  const anomalous = Boolean(report.anomaly?.is_anomalous);
  const score = Math.round(Math.max(0, 100 - faultRisk * 65 - (anomalous ? 25 : 0)));
  const status = (anomalous || faultRisk >= 0.7) ? 'CRITICAL' : faultRisk >= 0.35 ? 'CAUTION' : 'HEALTHY';
  return {
    score,
    status,
    rulHours: Math.max(0, Number(report.rul_estimate_cycles) || 0),
    confidence: Math.round(Math.max(...Object.values(probabilities).map(Number)) * 100),
  };
}

// twin-core frames are engine-centric. Keep this translation at the network
// boundary so the viewer and all dashboard components read one stable shape.
function toDashboardTelemetry(payload, previous = initialTelemetry, healthReport = null) {
  const frame = payload?.telemetry_frame || payload?.data || payload;
  if (!frame?.sensors) return null;
  const s = frame.sensors;
  const health = healthForModel(healthReport, fallbackHealthFor(frame));
  const engine = {
    rpm: Number(s.rpm) || 0,
    cht: Number(s.cht_c) || 0,
    egt: Number(s.egt_c) || 0,
    oilPressure: Number(s.oil_press_psi) || 0,
    vibration: Number(s.vibration_g) || 0,
  };
  const frameTimestamp = frame.timestamp || new Date().toISOString();
  const thermo = frame.thermodynamics || {};
  const res = frame.residuals || {};
  const thermodynamics = {
    brakePowerKw: Number(thermo.brake_power_kw) || previous.thermodynamics?.brakePowerKw || 48.0,
    brakePowerHp: Number(thermo.brake_power_hp) || previous.thermodynamics?.brakePowerHp || 64.0,
    torqueNm: Number(thermo.torque_nm) || previous.thermodynamics?.torqueNm || 92.0,
    bsfc: Number(thermo.bsfc_g_kwh) || previous.thermodynamics?.bsfc || 280,
    thermalEfficiency: Number(thermo.thermal_efficiency_pct) || previous.thermodynamics?.thermalEfficiency || 29.0,
  };
  const residuals = {
    discrepancyScore: Number(res.discrepancy_score) || 0.0,
    state: res.state || 'nominal',
    chtDelta: Number(res.cht_delta_c) || 0.0,
    egtDelta: Number(res.egt_delta_c) || 0.0,
  };

  const alerts = health.status === 'HEALTHY' ? [] : [{
    id: `engine-${frame.cycle}`,
    level: health.status === 'CRITICAL' ? 'critical' : 'warn',
    msg: healthReport?.advisory || 'ENGINE LIMIT EXCEEDED',
    time: new Date(frameTimestamp).toLocaleTimeString(),
  }];
  return {
    ...previous,
    uavId: `UAV-${String(frame.unit_id ?? 1).padStart(2, '0')}`,
    cycle: Number(frame.cycle),
    missionState: String(frame.phase || 'CRUISE').toUpperCase(),
    timestamp: frameTimestamp,
    engine,
    thermodynamics,
    residuals,
    health,
    alerts,
    mission: {
      ...previous.mission,
      phase: String(frame.phase || 'CRUISE').toUpperCase(),
    },
  };
}

async function scoreWithTrainedModels(frame) {
  const response = await fetch(`${ML_API_URL}/health/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(frame),
  });
  if (!response.ok) throw new Error(`ML API returned ${response.status}`);
  return response.json();
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
        const frame = payload?.telemetry_frame || payload?.data || payload;
        setTelemetry((previous) => {
          const next = toDashboardTelemetry(payload, previous);
          if (!next) return previous;
          trendRef.current = pushTrend(trendRef.current, next);
          return { ...next, trend: trendRef.current };
        });
        scoreWithTrainedModels(frame).then((report) => {
          if (cancelled) return;
          setTelemetry((previous) => (
            previous.cycle === Number(report.cycle)
              ? toDashboardTelemetry(frame, previous, report)
              : previous
          ));
        }).catch(() => { /* retain threshold fallback when ML API is offline */ });
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
