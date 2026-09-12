import { memo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer } from 'recharts';

const READOUTS = [
  { key: 'altitude', label: 'ALTITUDE', unit: ' m' },
  { key: 'speed', label: 'GROUND SPEED', unit: ' km/h' },
  { key: 'heading', label: 'HEADING', unit: '°' },
  { key: 'distanceToRTL', label: 'DIST TO RTL', unit: ' km' },
];

function batteryColor(pct) {
  if (pct <= 20) return 'var(--red)';
  if (pct <= 40) return 'var(--amber)';
  return 'var(--green)';
}

function BatteryBar({ percent }) {
  const data = [{ name: 'BATT', value: Math.round(percent) }];
  const color = batteryColor(percent);

  return (
    <div className="battery-bar-block">
      <div className="battery-bar-head">
        <span className="metric-label">BATTERY REMAINING</span>
        <span className="metric-value mono" style={{ color }}>
          {Math.round(percent)}%
        </span>
      </div>
      <div style={{ width: '100%', height: 34 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 4 }}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="name" hide />
            <Bar dataKey="value" radius={0} background={{ fill: 'var(--line)' }} barSize={18}>
              <Cell fill={color} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Live telemetry readout — sits at the bottom of the right column.
// Shows the fast-moving mission numbers (not engine/battery raw sensors,
// those live in the left ComponentPanel) plus the battery-remaining bar.
function TelemetryCards({ mission }) {
  return (
    <div className="section" style={{ borderBottom: 'none' }}>
      <div className="section-title">LIVE TELEMETRY</div>

      <BatteryBar percent={mission.battRemaining} />

      <div className="live-readout-grid">
        {READOUTS.map((r) => {
          const raw = mission[r.key];
          const display = typeof raw === 'number' ? (Number.isInteger(raw) ? raw : raw.toFixed(1)) : raw;
          return (
            <div className="live-readout-item" key={r.key}>
              <div className="label">{r.label}</div>
              <div className="value mono">
                {display}
                {r.unit}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(TelemetryCards);
