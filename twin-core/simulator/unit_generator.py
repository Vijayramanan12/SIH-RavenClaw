"""
Stateful, cycle-by-cycle engine unit simulator for twin-core.

This is the orchestration layer: it owns *state* (which cycle a unit is on,
its RNG, and its running thermal-lag values) and calls into the domain
models in ../models/ for the physics (physics_engine.physics_informed_readings)
and the mission shape (mission_profile.build_rpm_and_phase_trace).

Thermal lag lives here, not in physics_engine.py, because it needs
per-unit persistent state (the previous cycle's lagged temperature) --
physics_engine's functions are deliberately pure/stateless so they can be
reused anywhere (tests, notebooks) without instantiating a simulator.

Pipeline order for each cycle, enforced by callers (dataset_generator.py,
live_stream.py, twin_api.py), is:

    1. sim.step()                      raw physics + instantaneous noise
    2. fault_injector.apply_fault(...) fault's raw temperature delta added
    3. sim.apply_thermal_lag(...)      lag + final noise on cht_c/oil_temp_c

Step 3 must come after step 2: a developing fault's heat buildup has the
same thermal inertia as normal operation, so it should never bypass the
lag by being added on top of an already-lagged value (that was a bug in
an earlier version of this file -- see docs/DATA_CONTRACT.md changelog).

Used by:
  - dataset_generator.py  -- runs the full pipeline n_cycles times per unit, batched
  - live_stream.py        -- runs it once per second, indefinitely
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "models"))
from mission_profile import build_rpm_and_phase_trace  # noqa: E402
from physics_engine import (  # noqa: E402
    BASELINE,
    calculate_thermodynamics,
    compute_residuals,
    lag_step,
    physics_informed_readings,
)


class EngineUnitSimulator:
    """
    Call .step() once per tick to advance one cycle and get a fresh
    telemetry_frame-shaped dict. cht_c/oil_temp_c come back as *raw*
    physics targets (no lag or measurement noise yet) -- call
    apply_thermal_lag() on the sensors dict after any fault has been
    layered on, to get the final smoothed values.

    Loops back to the start of the mission profile once it reaches the
    end, so a live demo can run indefinitely without restarting the process.
    """

    def __init__(self, unit_id: int, ambient_c: float = 25.0, seed: int = None, profile=None):
        self.unit_id = unit_id
        self.ambient_c = ambient_c
        self.rng = np.random.default_rng(seed)
        self._rpm_trace, self._phase_trace = build_rpm_and_phase_trace(profile)
        self.cycle = 0

        # Cold start: the engine begins at ambient temperature and warms up
        # over the first many cycles, rather than snapping to the idle
        # target on cycle 0.
        self._cht_lag = ambient_c
        self._oil_temp_lag = ambient_c
        self._cht_alpha = BASELINE.get("cht_thermal_alpha", 0.03)
        self._oil_temp_alpha = BASELINE.get("oil_temp_thermal_alpha", 0.02)

        # Parallel virtual nominal twin state (ideal physics observer baseline)
        self._nominal_cht_lag = ambient_c
        self._nominal_oil_temp_lag = ambient_c
        self._last_rpm = BASELINE["rpm_idle"]

    @property
    def n_cycles(self) -> int:
        return len(self._rpm_trace)

    def step(self) -> dict:
        """
        Advance one cycle; returns a telemetry_frame-shaped dict.
        cht_c/oil_temp_c are still raw targets at this point -- call
        apply_thermal_lag() (after any fault injection) to finalize them.
        """
        idx = self.cycle % self.n_cycles
        rpm = float(self._rpm_trace[idx] + self.rng.normal(0, 15))
        self._last_rpm = rpm
        sensors = physics_informed_readings(rpm, self.ambient_c)

        # Sensors with no meaningful thermal mass: noise applied immediately.
        # cht_c/oil_temp_c are deliberately left alone here -- see
        # apply_thermal_lag().
        sensors["egt_c"] += float(self.rng.normal(0, 5))
        sensors["oil_press_psi"] += float(self.rng.normal(0, 1.0))
        sensors["vibration_g"] += float(self.rng.normal(0, 0.05))
        sensors["map_inhg"] += float(self.rng.normal(0, 0.2))

        frame = {
            "unit_id": self.unit_id,
            "cycle": self.cycle,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "phase": self._phase_trace[idx],
            "sensors": sensors,
        }
        self.cycle += 1
        return frame

    def apply_thermal_lag(self, sensors: dict) -> dict:
        """
        Smooth cht_c/oil_temp_c toward their (possibly fault-adjusted) raw
        targets using a persistent per-unit exponential lag, then add final
        measurement noise. Call this *after* fault_injector.apply_fault(),
        every cycle (healthy or faulty) -- lag is part of normal engine
        behavior, not just a fault-time effect.
        """
        s = dict(sensors)
        self._cht_lag = lag_step(self._cht_lag, s["cht_c"], self._cht_alpha)
        self._oil_temp_lag = lag_step(self._oil_temp_lag, s["oil_temp_c"], self._oil_temp_alpha)
        s["cht_c"] = self._cht_lag + float(self.rng.normal(0, 1.5))
        s["oil_temp_c"] = self._oil_temp_lag + float(self.rng.normal(0, 1.0))
        return s

    def observe(self, finalized_sensors: dict) -> dict:
        """
        Digital Twin State Observer:
        Runs the clean nominal virtual twin in lockstep with the engine RPM,
        and computes:
          1. Physics residuals (Delta = Sensor_meas - Sensor_nominal)
          2. Normalized discrepancy score (physical model divergence)
          3. Thermodynamic performance indicators (Brake Power, Torque, BSFC, Thermal Efficiency)
        """
        rpm = finalized_sensors.get("rpm", self._last_rpm)
        nominal_raw = physics_informed_readings(rpm, self.ambient_c)
        self._nominal_cht_lag = lag_step(self._nominal_cht_lag, nominal_raw["cht_c"], self._cht_alpha)
        self._nominal_oil_temp_lag = lag_step(self._nominal_oil_temp_lag, nominal_raw["oil_temp_c"], self._oil_temp_alpha)

        nominal_state = dict(nominal_raw)
        nominal_state["cht_c"] = self._nominal_cht_lag
        nominal_state["oil_temp_c"] = self._nominal_oil_temp_lag

        residuals = compute_residuals(finalized_sensors, nominal_state)
        thermodynamics = calculate_thermodynamics(finalized_sensors)

        return {
            "residuals": residuals,
            "thermodynamics": thermodynamics,
        }

    def reset(self) -> None:
        """Restart the mission from cycle 0 and re-cold-start thermal state."""
        self.cycle = 0
        self._cht_lag = self.ambient_c
        self._oil_temp_lag = self.ambient_c
        self._nominal_cht_lag = self.ambient_c
        self._nominal_oil_temp_lag = self.ambient_c


if __name__ == "__main__":
    sim = EngineUnitSimulator(unit_id=1, ambient_c=28.0, seed=1)
    for _ in range(5):
        frame = sim.step()
        frame["sensors"] = sim.apply_thermal_lag(frame["sensors"])
        print(frame)