export default function Header({ uavId, missionState, connected, mode }) {
  return (
    <header className="header">
      <div className="header-brand">
        <span className="brand-mark" />
        UAV DIGITAL TWIN
      </div>

      <div className="header-status">
        <div className="status-chip">
          <span
            className="pulse-dot"
            style={{ background: connected ? undefined : 'var(--red)', boxShadow: connected ? undefined : '0 0 6px var(--red)' }}
          />
          {mode === 'live' ? 'LIVE SOCKET' : mode === 'connecting' ? 'CONNECTING…' : 'LIVE (SIMULATED)'}
        </div>

        <div className="status-chip mono">{uavId}</div>

        <span className="badge active">{missionState}</span>
      </div>
    </header>
  );
}
