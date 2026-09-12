import { memo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--bg-panel-raised)',
        border: '1px solid var(--line-bright)',
        padding: '8px 10px',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
      }}
    >
      <div style={{ color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name ?? p.dataKey.toUpperCase()}: {p.value}
        </div>
      ))}
    </div>
  );
}

// series: [{ key, color, label }]
function TrendChart({ title, data, series, height = 168 }) {
  const hasData = data && data.length > 1;

  return (
    <div className="graph-panel">
      <div className="graph-panel-head">
        <span className="graph-panel-title">{title}</span>
        <div className="trend-legend">
          {series.map((s) => (
            <div className="trend-legend-item" key={s.key}>
              <span className="trend-legend-swatch" style={{ background: s.color }} />
              {s.label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ width: '100%', height }}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="t"
                tick={{ fill: 'var(--text-dim)', fontSize: 9, fontFamily: 'var(--font-mono)' }}
                axisLine={{ stroke: 'var(--line)' }}
                tickLine={false}
                minTickGap={30}
              />
              <YAxis
                tick={{ fill: 'var(--text-dim)', fontSize: 9, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
                width={38}
              />
              <Tooltip content={<CustomTooltip />} />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="alert-empty">GATHERING TELEMETRY…</div>
        )}
      </div>
    </div>
  );
}

// Re-renders only when this chart's own data/series actually change --
// keeps the Engine graph from re-rendering when only Battery data ticks
// and vice versa, even though both read from the same telemetry object.
export default memo(TrendChart);
