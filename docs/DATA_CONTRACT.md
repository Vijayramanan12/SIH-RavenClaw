# Data Contract

**schema_version: 1.3**

This is the shared interface between `twin-core`, `ml-models`, and
`dashboard`. All three groups should treat this file as the source of truth
for field names and types. **Propose changes via PR, not silent edits.**

## 1. Raw telemetry row (CSV / DataFrame)

Produced by `data/engine_data_generator.py`, or in production by
`twin-core`'s ingestion layer reading real ECU/FADEC/CAN bus data.

| Field | Type | Units | Notes |
|---|---|---|---|
| `unit_id` | int | – | one engine "mission" / run-to-failure trajectory |
| `cycle` | int | sample index | 1 sample ≈ 1 Hz telemetry tick |
| `phase` | str | – | `idle`, `climb`, `cruise`, `descent` |
| `rpm` | float | rev/min | |
| `cht_c` | float | °C | Cylinder Head Temperature |
| `egt_c` | float | °C | Exhaust Gas Temperature |
| `fuel_flow_lph` | float | L/h | |
| `oil_press_psi` | float | psi | |
| `oil_temp_c` | float | °C | |
| `vibration_g` | float | g | |
| `ambient_c` | float | °C | environmental condition for that mission |
| `map_inhg` | float | inHg | Manifold Absolute Pressure — added schema_version 1.2 |
| `fault_mode` | str | – | ground-truth label: `none`, `overheating`, `misfire_vibration`, `oil_degradation`, `sensor_drift` (used for training/eval only — not available at inference time) |
| `RUL` | int | cycles | ground-truth Remaining Useful Life, capped at 200 (used for training/eval only) |

## 2. `telemetry_frame` — twin-core → ml-models / dashboard

One synchronized snapshot of engine state, emitted per cycle. JSON shape:

```json
{
  "unit_id": 1,
  "cycle": 142,
  "timestamp": "2026-09-08T10:15:32Z",
  "phase": "cruise",
  "sensors": {
    "rpm": 5001.2,
    "cht_c": 108.4,
    "egt_c": 795.1,
    "fuel_flow_lph": 14.8,
    "oil_press_psi": 57.9,
    "oil_temp_c": 99.6,
    "vibration_g": 0.51,
    "ambient_c": 27.3,
    "throttle_pct": 84.2,
    "map_inhg": 24.1
  },
  "limits": {
    "cht_max_c": 150,
    "egt_max_c": 900,
    "oil_press_min_psi": 22,
    "oil_press_max_psi": 72,
    "oil_temp_max_c": 120
  },
  "engine_state": {
    "rpm": 5001.2,
    "throttle": 84.2,
    "egt_c": 795.1,
    "cht_c": 108.4,
    "oil_pressure_bar": 3.99,
    "oil_temperature_c": 99.6,
    "fuel_flow_lph": 14.8,
    "vibration_g": 0.51
  },
  "thermodynamics": {
    "brake_power_kw": 62.16,
    "brake_power_hp": 83.4,
    "torque_nm": 118.7,
    "bsfc_g_kwh": 171.4,
    "thermal_efficiency_pct": 28.5,
    "bmep_bar": 10.02,
    "volumetric_efficiency_pct": 76.5
  },
  "residuals": {
    "cht_delta_c": 0.8,
    "egt_delta_c": 2.1,
    "oil_press_delta_psi": -0.4,
    "oil_temp_delta_c": 0.5,
    "vibration_delta_g": 0.012,
    "fuel_flow_delta_lph": 0.1,
    "discrepancy_score": 0.84,
    "state": "nominal"
  }
}
```

`limits` lets the dashboard and ml-models flag threshold breaches without
hardcoding engine specs in three places.

`engine_state` (added in schema_version 1.1) is a reduced, animation-ready
view of the same cycle for the 3D viewer (dashboard/Group 3) — different
units and names than `sensors` on purpose:

| Field | Type | Units | Source |
|---|---|---|---|
| `rpm` | float | rev/min | `sensors.rpm`, rounded |
| `throttle` | float | % (0–100) | `sensors.throttle_pct` — see note below |
| `egt_c` | float | °C | `sensors.egt_c`, rounded |
| `cht_c` | float | °C | `sensors.cht_c`, rounded |
| `oil_pressure_bar` | float | bar | `sensors.oil_press_psi` × 0.0689476 |
| `oil_temperature_c` | float | °C | `sensors.oil_temp_c`, rounded |
| `fuel_flow_lph` | float | L/h | `sensors.fuel_flow_lph`, rounded |
| `vibration_g` | float | g | `sensors.vibration_g`, rounded |

**Known simplification:** the current simulator has no independent throttle
input — mission phases drive target RPM directly, and `throttle_pct` is
derived as the same RPM-based load fraction that drives every other sensor.
That's backwards from a real engine (throttle causes RPM, not the reverse).
It's a reasonable stand-in for now; revisit if the 3D animation needs
throttle to visibly lead RPM changes rather than track them exactly.

`sensors.throttle_pct` is new in schema_version 1.1 too — ml-models can
ignore it if it isn't useful as a model feature yet.

## 3. `health_report` — ml-models → dashboard

Emitted whenever ml-models scores a `telemetry_frame` (or a batch, for
post-flight replay). JSON shape:

```json
{
  "unit_id": 1,
  "cycle": 142,
  "timestamp": "2026-09-08T10:15:32Z",
  "anomaly": {
    "is_anomalous": true,
    "score": 0.83
  },
  "rul_estimate_cycles": 58,
  "fault_probabilities": {
    "none": 0.05,
    "overheating": 0.72,
    "misfire_vibration": 0.03,
    "oil_degradation": 0.15,
    "sensor_drift": 0.05
  },
  "advisory": "CHT trending toward limit — recommend ground inspection within 60 cycles."
}
```

## 4. Versioning

If a field must change (rename, new unit, new fault mode, etc.):

1. Bump the `schema_version` string at the top of this file.
2. Update this doc in the same PR as the code change.
3. Ping the other two groups before merging — they consume this shape.

### Changelog
- **1.3** — added `thermodynamics` block (derived Brake Power, Torque, BSFC,
  Thermal Efficiency, BMEP, Volumetric Efficiency) and `residuals` block
  (physical delta between actual engine sensors and parallel virtual nominal twin,
  plus normalized discrepancy score) for true physics-informed digital twin monitoring.
- **1.2** — added `sensors.map_inhg` (Manifold Absolute Pressure). Also:
  thermal lag on `cht_c`/`oil_temp_c` now cold-starts at ambient temperature
  and is applied *after* fault injection (previously a fault's temperature
  rise bypassed the lag and jumped instantly — fixed in both
  `data/engine_data_generator.py` and `twin-core/simulator/unit_generator.py`).
  `sensor_drift` can now bias EGT, CHT, *or* oil pressure (previously EGT
  only) — kept consistent between the batch generator and the live
  `fault_injector.py`.
- **1.1** — added `sensors.throttle_pct` and the `engine_state` block for
  the 3D viewer's animation inputs.
- **1.0** — initial `telemetry_frame` / `health_report` shapes.