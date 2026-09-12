import { useEffect, useState } from 'react';

export default function MissionStatus({ mission, connected, mode }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="mission-strip">
      <div className="item">
        <span className="label">PHASE</span>
        <span className="value">{mission.phase}</span>
      </div>
      <div className="item">
        <span className="label">MISSION TIME</span>
        <span className="value mono">{hh}:{mm}:{ss}</span>
      </div>
      <div className="item">
        <span className="label">LINK</span>
        <span className="value" style={{ color: connected ? 'var(--green)' : 'var(--red)' }}>
          {connected ? mode.toUpperCase() : 'LOST'}
        </span>
      </div>
    </div>
  );
}
