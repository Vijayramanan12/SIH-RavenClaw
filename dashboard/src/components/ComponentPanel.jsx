import { memo } from 'react';
import { THRESHOLDS } from '../data/demoTelemetry';
import { PART_MAP } from '../data/partMapping';

function severity(value, warn, critical, invert = false) {
  if (invert) {
    if (value <= critical) return 'critical';
    if (value <= warn) return 'warn';
    return 'ok';
  }
  if (value >= critical) return 'critical';
  if (value >= warn) return 'warn';
  return 'ok';
}

function MetricRow({ label, value, unit, level, partKey, selectedPart, onSelectPart }) {
  const active = selectedPart === partKey;
  return (
    <div
      className={`metric-row clickable ${active ? 'is-selected' : ''}`}
      onClick={() => onSelectPart(active ? null : partKey)}
      role="button"
      tabIndex={0}
    >
      <span className="metric-label">{label}</span>
      <span className={`metric-value mono ${level}`}>
        {value}
        {unit}
      </span>
    </div>
  );
}

function StatusRow({ label, status, tone, partKey, selectedPart, onSelectPart }) {
  const active = selectedPart === partKey;
  return (
    <div
      className={`status-line clickable ${active ? 'is-selected' : ''}`}
      onClick={() => onSelectPart(active ? null : partKey)}
      role="button"
      tabIndex={0}
    >
      <span className="metric-label">{label}</span>
      <span className={`status-tag ${tone}`}>{status}</span>
    </div>
  );
}

function SectionTitle({ children, partKey, selectedPart, onSelectPart }) {
  const active = selectedPart === partKey;
  const modeled = PART_MAP[partKey]?.modeled;
  return (
    <div
      className={`section-title clickable ${active ? 'is-selected' : ''}`}
      onClick={() => onSelectPart(active ? null : partKey)}
      role="button"
      tabIndex={0}
    >
      {children}
      {!modeled && <span className="not-modeled-dot" title="Not in current 3D model" />}
    </div>
  );
}

function ComponentPanel({ telemetry, selectedPart, onSelectPart }) {
  const { engine, battery, propulsion, flightControl, sensors } = telemetry;

  const chtLevel = severity(engine.cht, THRESHOLDS.cht.warn, THRESHOLDS.cht.critical);
  const egtLevel = severity(engine.egt, THRESHOLDS.egt.warn, THRESHOLDS.egt.critical);
  const oilLevel = severity(
    engine.oilPressure,
    THRESHOLDS.oilPressure.warnLow,
    THRESHOLDS.oilPressure.criticalLow,
    true
  );
  const vibLevel = severity(
    engine.vibration,
    THRESHOLDS.vibration.warn,
    THRESHOLDS.vibration.criticalLevel
  );
  const battTempLevel = severity(battery.temp, THRESHOLDS.battTemp.warn, THRESHOLDS.battTemp.critical);
  const battVoltLevel = severity(
    battery.voltage,
    THRESHOLDS.battVoltage.warnLow,
    THRESHOLDS.battVoltage.criticalLow,
    true
  );

  const propTone = propulsion.status === 'NORMAL' ? 'normal' : propulsion.status === 'CAUTION' ? 'caution' : 'critical';

  const rowProps = { selectedPart, onSelectPart };

  return (
    <div className="grid-col">
      <div className="section">
        <SectionTitle partKey="engine" {...rowProps}>ENGINE</SectionTitle>
        <MetricRow label="RPM" value={Math.round(engine.rpm)} unit="" level="" partKey="rpm" {...rowProps} />
        <MetricRow label="CHT" value={engine.cht.toFixed(0)} unit="°C" level={chtLevel} partKey="cht" {...rowProps} />
        <MetricRow label="EGT" value={engine.egt.toFixed(0)} unit="°C" level={egtLevel} partKey="egt" {...rowProps} />
        <MetricRow label="Oil" value={engine.oilPressure.toFixed(0)} unit=" psi" level={oilLevel} partKey="oil" {...rowProps} />
        <MetricRow label="Vib" value={engine.vibration.toFixed(1)} unit=" g" level={vibLevel} partKey="vibration" {...rowProps} />
      </div>

      {telemetry.thermodynamics && (
        <div className="section">
          <SectionTitle partKey="thermo" {...rowProps}>THERMODYNAMICS</SectionTitle>
          <MetricRow label="Brake Power" value={telemetry.thermodynamics.brakePowerKw.toFixed(1)} unit=" kW" level="" partKey="thermo" {...rowProps} />
          <MetricRow label="Torque" value={telemetry.thermodynamics.torqueNm.toFixed(0)} unit=" N·m" level="" partKey="thermo" {...rowProps} />
          <MetricRow label="Thermal Eff" value={telemetry.thermodynamics.thermalEfficiency.toFixed(1)} unit=" %" level="" partKey="thermo" {...rowProps} />
          <MetricRow label="BSFC" value={Math.round(telemetry.thermodynamics.bsfc)} unit=" g/kWh" level="" partKey="thermo" {...rowProps} />
        </div>
      )}

      {telemetry.residuals && (
        <div className="section">
          <SectionTitle partKey="observer" {...rowProps}>TWIN OBSERVER</SectionTitle>
          <StatusRow
            label="Observer Fit"
            status={telemetry.residuals.state.toUpperCase()}
            tone={telemetry.residuals.state === 'nominal' ? 'normal' : telemetry.residuals.state === 'caution' ? 'caution' : 'critical'}
            partKey="observer"
            {...rowProps}
          />
          <MetricRow
            label="Δ CHT"
            value={(telemetry.residuals.chtDelta > 0 ? '+' : '') + telemetry.residuals.chtDelta.toFixed(1)}
            unit="°C"
            level={Math.abs(telemetry.residuals.chtDelta) > 15 ? 'critical' : Math.abs(telemetry.residuals.chtDelta) > 5 ? 'warn' : ''}
            partKey="cht"
            {...rowProps}
          />
          <MetricRow
            label="Δ EGT"
            value={(telemetry.residuals.egtDelta > 0 ? '+' : '') + telemetry.residuals.egtDelta.toFixed(1)}
            unit="°C"
            level={Math.abs(telemetry.residuals.egtDelta) > 30 ? 'critical' : Math.abs(telemetry.residuals.egtDelta) > 10 ? 'warn' : ''}
            partKey="egt"
            {...rowProps}
          />
          <MetricRow
            label="Discrepancy"
            value={telemetry.residuals.discrepancyScore.toFixed(2)}
            unit=" σ"
            level={telemetry.residuals.discrepancyScore > 7.5 ? 'critical' : telemetry.residuals.discrepancyScore > 3.5 ? 'warn' : ''}
            partKey="observer"
            {...rowProps}
          />
        </div>
      )}

      <div className="section">
        <SectionTitle partKey="battery" {...rowProps}>BATTERY</SectionTitle>
        <MetricRow label="Voltage" value={battery.voltage.toFixed(1)} unit=" V" level={battVoltLevel} partKey="battery" {...rowProps} />
        <MetricRow label="Current" value={battery.current.toFixed(1)} unit=" A" level="" partKey="battery" {...rowProps} />
        <MetricRow label="Temp" value={battery.temp.toFixed(0)} unit="°C" level={battTempLevel} partKey="battery" {...rowProps} />
      </div>

      <div className="section">
        <SectionTitle partKey="propulsion" {...rowProps}>PROPULSION</SectionTitle>
        <StatusRow label="Status" status={propulsion.status} tone={propTone} partKey="propulsion" {...rowProps} />
      </div>

      <div className="section">
        <SectionTitle partKey="flightControl" {...rowProps}>FLIGHT CONTROL</SectionTitle>
        <StatusRow label="Status" status={flightControl.status} tone="active" partKey="flightControl" {...rowProps} />
      </div>

      <div className="section" style={{ borderBottom: 'none' }}>
        <SectionTitle partKey="sensors" {...rowProps}>SENSORS</SectionTitle>
        <StatusRow label="GPS" status={sensors.gps} tone="locked" partKey="sensors" {...rowProps} />
      </div>
    </div>
  );
}

export default memo(ComponentPanel);
