import { memo } from 'react';

const ICON = {
  ok: '✓',
  warn: '!',
  critical: '✕',
};

function AlertPanel({ alerts }) {
  const list = alerts?.length ? alerts : [{ id: 'none', level: 'ok', msg: 'NORMAL', time: '' }];

  return (
    <div className="section">
      <div className="section-title">FAULT ALERTS</div>

      {list.map((a) => (
        <div className="alert-item" key={a.id}>
          <span className={`alert-icon ${a.level}`}>{ICON[a.level] ?? '•'}</span>
          <div className="alert-body">
            <div className="msg">{a.msg}</div>
            {a.time ? <div className="time">{a.time}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default memo(AlertPanel);
