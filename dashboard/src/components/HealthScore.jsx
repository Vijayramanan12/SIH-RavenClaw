import { memo } from 'react';

const STATUS_COLOR = {
  HEALTHY: 'var(--green)',
  CAUTION: 'var(--amber)',
  CRITICAL: 'var(--red)',
};

const STATUS_TONE = {
  HEALTHY: 'active',
  CAUTION: 'caution',
  CRITICAL: 'critical',
};

function HealthScore({ health }) {
  const { score, status, rulHours, confidence } = health;
  const color = STATUS_COLOR[status] ?? 'var(--cyan)';
  const tone = STATUS_TONE[status] ?? 'active';

  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);

  return (
    <div className="section">
      <div className="section-title">AI HEALTH SCORE</div>

      <div className="health-score-wrap">
        <div className="health-ring">
          <svg width="148" height="148" viewBox="0 0 148 148">
            <circle
              cx="74"
              cy="74"
              r={radius}
              fill="none"
              stroke="var(--line)"
              strokeWidth="8"
            />
            <circle
              cx="74"
              cy="74"
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth="8"
              strokeLinecap="square"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.6s ease' }}
            />
          </svg>
          <div className="health-ring-value">
            <span className="num" style={{ color }}>{score}</span>
            <span className="denom">/100</span>
          </div>
        </div>

        <span className={`status-tag ${tone} health-status-tag`}>{status}</span>

        <div className="health-substats">
          <div className="health-substat">
            <div className="label">RUL</div>
            <div className="value">{rulHours} HRS</div>
          </div>
          <div className="health-substat">
            <div className="label">CONFIDENCE</div>
            <div className="value">{confidence}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(HealthScore);
