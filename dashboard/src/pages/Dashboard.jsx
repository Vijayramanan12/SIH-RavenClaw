import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Header from '../components/Header';
import ComponentPanel from '../components/ComponentPanel';
import HealthScore from '../components/HealthScore';
import AlertPanel from '../components/AlertPanel';
import TrendChart from '../components/TrendChart';
import TelemetryCards from '../components/TelemetryCards';
import MissionStatus from '../components/MissionStatus';
import useTelemetrySocket from '../hooks/useTelemetrySocket';

// The 3D viewer pulls in three.js + drei + a 16MB glTF — code-split it so
// the rest of the dashboard (readouts, charts) paints immediately instead
// of waiting on the 3D bundle and model download.
const DroneViewer = lazy(() => import('../components/DroneViewer'));

const ENGINE_SERIES = [
  { key: 'rpm', color: '#3ddad2', label: 'RPM' },
  { key: 'egt', color: '#ffb238', label: 'EGT' },
  { key: 'cht', color: '#ff4d4d', label: 'CHT' },
];

const BATTERY_SERIES = [
  { key: 'voltage', color: '#3ddad2', label: 'VOLTAGE' },
  { key: 'current', color: '#ffb238', label: 'CURRENT' },
];

export default function Dashboard() {
  const { telemetry, connected, mode } = useTelemetrySocket();
  const [selectedPart, setSelectedPart] = useState(null);

  // A ref, not state: rpmRef.current updates every telemetry tick without
  // changing identity, so EngineRig (inside the memoized DroneViewer) can
  // read the live RPM every animation frame without forcing DroneViewer,
  // or the rest of the dashboard, to re-render on each tick.
  const rpmRef = useRef(telemetry.engine.rpm);
  useEffect(() => {
    rpmRef.current = telemetry.engine.rpm;
  }, [telemetry.engine.rpm]);

  // Memoized so the two graph panels only re-render when the trend buffer
  // itself changes, not on every unrelated telemetry field tick.
  const trend = telemetry.trend;
  const engineTrendData = useMemo(() => trend, [trend]);
  const batteryTrendData = useMemo(() => trend, [trend]);

  return (
    <div className="app-shell">
      <Header
        uavId={telemetry.uavId}
        missionState={telemetry.missionState}
        connected={connected}
        mode={mode}
      />

      <div className="dashboard-grid">
        <ComponentPanel
          telemetry={telemetry}
          selectedPart={selectedPart}
          onSelectPart={setSelectedPart}
        />

        <Suspense fallback={<div className="viewer-col"><div className="viewer-loading">LOADING DIGITAL TWIN…</div></div>}>
          <DroneViewer
            healthStatus={telemetry.health.status}
            selectedPart={selectedPart}
            rpmRef={rpmRef}
          />
        </Suspense>

        <div className="grid-col">
          <HealthScore health={telemetry.health} />
          <AlertPanel alerts={telemetry.alerts} />
          <TelemetryCards mission={telemetry.mission} />
        </div>
      </div>

      <MissionStatus mission={telemetry.mission} connected={connected} mode={mode} />

      <div className="graphs-strip">
        <TrendChart title="ENGINE TREND — RPM / EGT / CHT" data={engineTrendData} series={ENGINE_SERIES} />
        <TrendChart title="BATTERY TREND — VOLTAGE / CURRENT" data={batteryTrendData} series={BATTERY_SERIES} />
      </div>
    </div>
  );
}
