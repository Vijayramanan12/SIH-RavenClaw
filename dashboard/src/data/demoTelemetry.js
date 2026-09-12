// Demo/simulated telemetry for UAV Digital Twin (SIH 2026 - PS 54)
// Used as the initial state and as a fallback data generator when
// a live WebSocket telemetry feed (useTelemetrySocket) isn't connected.

export const initialTelemetry = {
  uavId: 'UAV-01',
  missionState: 'MISSION ACTIVE',
  connected: false,
  timestamp: Date.now(),

  engine: {
    rpm: 2450,
    cht: 168, // cylinder head temp, °C
    egt: 645, // exhaust gas temp, °C
    oilPressure: 52, // psi
    vibration: 2.1, // g
  },

  thermodynamics: {
    brakePowerKw: 48.2,
    brakePowerHp: 64.6,
    torqueNm: 92.4,
    bsfc: 282,
    thermalEfficiency: 29.4,
  },

  residuals: {
    discrepancyScore: 0.65,
    state: 'nominal',
    chtDelta: 0.4,
    egtDelta: 1.2,
  },

  battery: {
    voltage: 24.6,
    current: 18.4,
    temp: 41,
  },

  propulsion: { status: 'NORMAL' },
  flightControl: { status: 'ACTIVE' },
  sensors: { gps: 'LOCKED' },

  health: {
    score: 94,
    status: 'HEALTHY',
    rulHours: 126,
    confidence: 96,
  },

  alerts: [
    { id: 'a1', level: 'ok', msg: 'All systems nominal', time: '00:00:00' },
  ],

  trend: [], // populated by useTelemetrySocket ring buffer

  mission: {
    phase: 'CRUISE',
    altitude: 412, // m AGL
    speed: 61, // km/h
    heading: 214, // deg
    battRemaining: 68, // %
    distanceToRTL: 3.2, // km
  },
};

// Bounds used to derive threshold-based status coloring across the UI.
export const THRESHOLDS = {
  cht: { warn: 190, critical: 215 },
  egt: { warn: 700, critical: 760 },
  oilPressure: { warnLow: 35, criticalLow: 25 },
  vibration: { warn: 3.5, criticalLevel: 5 },
  battVoltage: { warnLow: 22, criticalLow: 20 },
  battTemp: { warn: 55, critical: 65 },
  healthScore: { warn: 75, critical: 50 },
};

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function jitter(value, amount) {
  return value + (Math.random() - 0.5) * amount;
}

// Produces the next simulated telemetry frame from a previous one.
// Mirrors the shape a real WebSocket payload from the ground-control
// backend would deliver, so swapping in a real feed is a drop-in change.
export function nextDemoFrame(prev) {
  const rpm = clamp(jitter(prev.engine.rpm, 30), 1800, 2800);
  const cht = clamp(jitter(prev.engine.cht, 1.2), 120, 230);
  const egt = clamp(jitter(prev.engine.egt, 4), 500, 800);
  const oilPressure = clamp(jitter(prev.engine.oilPressure, 0.8), 20, 65);
  const vibration = clamp(jitter(prev.engine.vibration, 0.15), 0.5, 6);

  const voltage = clamp(jitter(prev.battery.voltage, 0.1), 19, 25.2);
  const current = clamp(jitter(prev.battery.current, 0.6), 5, 35);
  const battTemp = clamp(jitter(prev.battery.temp, 0.4), 25, 70);

  const scoreDrift = clamp(
    jitter(prev.health.score, 0.6) -
      (cht > THRESHOLDS.cht.warn ? 0.4 : 0) -
      (vibration > THRESHOLDS.vibration.warn ? 0.5 : 0),
    35,
    99
  );

  const status =
    scoreDrift < THRESHOLDS.healthScore.critical
      ? 'CRITICAL'
      : scoreDrift < THRESHOLDS.healthScore.warn
      ? 'CAUTION'
      : 'HEALTHY';

  const alerts = [];
  if (cht > THRESHOLDS.cht.critical) {
    alerts.push({ level: 'critical', msg: 'CHT exceeds critical limit' });
  } else if (cht > THRESHOLDS.cht.warn) {
    alerts.push({ level: 'warn', msg: 'CHT trending high' });
  }
  if (vibration > THRESHOLDS.vibration.criticalLevel) {
    alerts.push({ level: 'critical', msg: 'Excess vibration on airframe' });
  } else if (vibration > THRESHOLDS.vibration.warn) {
    alerts.push({ level: 'warn', msg: 'Vibration above nominal band' });
  }
  if (voltage < THRESHOLDS.battVoltage.criticalLow) {
    alerts.push({ level: 'critical', msg: 'Battery voltage critically low' });
  } else if (voltage < THRESHOLDS.battVoltage.warnLow) {
    alerts.push({ level: 'warn', msg: 'Battery voltage below nominal' });
  }
  if (alerts.length === 0) {
    alerts.push({ level: 'ok', msg: 'All systems nominal' });
  }

  const now = new Date();
  const time = now.toTimeString().slice(0, 8);

  const brakePowerKw = clamp(Number(((rpm / 5500) * 73.5 * 0.9).toFixed(1)), 8, 73);
  const brakePowerHp = clamp(Number((brakePowerKw * 1.341).toFixed(1)), 10, 98);
  const torqueNm = clamp(Number(((brakePowerKw * 1000) / ((2 * Math.PI * rpm) / 60)).toFixed(1)), 40, 130);
  const thermalEfficiency = clamp(Number(jitter(prev.thermodynamics?.thermalEfficiency ?? 29.4, 0.2).toFixed(1)), 22, 33);
  const bsfc = clamp(Math.round(jitter(prev.thermodynamics?.bsfc ?? 282, 2)), 240, 320);

  const discrepancyScore = Number(
    (0.5 + (cht > THRESHOLDS.cht.warn ? 3.5 : 0) + (vibration > THRESHOLDS.vibration.warn ? 4.0 : 0)).toFixed(2)
  );
  const resState = discrepancyScore < 3.5 ? 'nominal' : discrepancyScore < 7.5 ? 'caution' : 'divergent';

  return {
    ...prev,
    timestamp: Date.now(),
    engine: { rpm, cht, egt, oilPressure, vibration },
    thermodynamics: {
      brakePowerKw,
      brakePowerHp,
      torqueNm,
      bsfc,
      thermalEfficiency,
    },
    residuals: {
      discrepancyScore,
      state: resState,
      chtDelta: Number((cht - 160).toFixed(1)),
      egtDelta: Number((egt - 640).toFixed(1)),
    },
    battery: { voltage, current, temp: battTemp },
    propulsion: {
      status: vibration > THRESHOLDS.vibration.warn ? 'CAUTION' : 'NORMAL',
    },
    flightControl: { status: 'ACTIVE' },
    sensors: { gps: 'LOCKED' },
    health: {
      score: Math.round(scoreDrift),
      status,
      rulHours: clamp(
        Math.round(jitter(prev.health.rulHours, 0.3)),
        4,
        400
      ),
      confidence: clamp(Math.round(jitter(prev.health.confidence, 0.5)), 70, 99),
    },
    alerts: alerts.map((a, i) => ({
      id: `${Date.now()}-${i}`,
      time,
      ...a,
    })),
    mission: {
      ...prev.mission,
      altitude: clamp(jitter(prev.mission.altitude, 2), 50, 900),
      speed: clamp(jitter(prev.mission.speed, 1.5), 0, 110),
      heading: (prev.mission.heading + jitter(0, 1) + 360) % 360,
      battRemaining: clamp(prev.mission.battRemaining - 0.02, 0, 100),
      distanceToRTL: clamp(jitter(prev.mission.distanceToRTL, 0.05), 0, 20),
    },
  };
}

