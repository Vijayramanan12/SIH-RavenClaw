"""
This originally tested a `state_estimator.py` module that never actually
existed in the repo (to_telemetry_frame / breach_flags). That job is now
split across:
  - simulator/unit_generator.py's EngineUnitSimulator.step() -- builds the
    telemetry_frame shape directly, cycle by cycle
  - models/physics_engine.py's breach_flags() -- limit checking

breach_flags() has its own coverage in test_physics_engine.py. This file
now checks the frame shape .step() produces, which is what
test_to_telemetry_frame_shape() used to check.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "simulator"))

from unit_generator import EngineUnitSimulator  # noqa: E402


def test_step_produces_telemetry_frame_shape():
    sim = EngineUnitSimulator(unit_id=1, ambient_c=25.0, seed=0)
    frame = sim.step()
    assert frame["unit_id"] == 1
    assert frame["cycle"] == 0
    assert "timestamp" in frame
    assert isinstance(frame["phase"], str)
    assert set(frame["sensors"]) == {
        "rpm", "cht_c", "egt_c", "fuel_flow_lph", "map_inhg",
        "oil_press_psi", "oil_temp_c", "vibration_g", "ambient_c", "throttle_pct",
    }


def test_step_advances_cycle_each_call():
    sim = EngineUnitSimulator(unit_id=1, ambient_c=25.0, seed=0)
    first = sim.step()
    second = sim.step()
    assert second["cycle"] == first["cycle"] + 1


def test_step_wraps_around_after_full_mission():
    sim = EngineUnitSimulator(unit_id=1, ambient_c=25.0, seed=0)
    for _ in range(sim.n_cycles):
        sim.step()
    wrapped = sim.step()
    assert wrapped["cycle"] == sim.n_cycles  # cycle count keeps rising...
    # ...but the underlying trace index has looped back to the start
    assert wrapped["phase"] == sim._phase_trace[0]


def test_reset_returns_to_cycle_zero():
    sim = EngineUnitSimulator(unit_id=1, ambient_c=25.0, seed=0)
    sim.step()
    sim.step()
    sim.reset()
    assert sim.cycle == 0


def test_thermal_lag_cold_starts_at_ambient():
    sim = EngineUnitSimulator(unit_id=1, ambient_c=18.0, seed=0)
    assert sim._cht_lag == 18.0
    assert sim._oil_temp_lag == 18.0


def test_thermal_lag_climbs_gradually_not_instantly():
    sim = EngineUnitSimulator(unit_id=1, ambient_c=18.0, seed=0)
    frame = sim.step()  # idle phase, raw cht target is well above 18C ambient
    lagged = sim.apply_thermal_lag(frame["sensors"])
    # cycle 1: should have moved from ambient toward the target, but not
    # reached anywhere close to it yet (alpha=0.03 -> slow climb)
    assert 18.0 < lagged["cht_c"] < frame["sensors"]["cht_c"]


def test_thermal_lag_responds_to_fault_adjusted_input():
    """
    apply_thermal_lag() must operate on whatever raw cht_c it's handed --
    if the caller runs fault_injector.apply_fault() first (the correct
    pipeline order), the fault's temperature delta reaches the lag filter
    instead of being tacked on after it.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "models"))
    from fault_injector import apply_fault  # noqa: E402

    sim_healthy = EngineUnitSimulator(unit_id=1, ambient_c=25.0, seed=0)
    sim_faulted = EngineUnitSimulator(unit_id=1, ambient_c=25.0, seed=0)

    for _ in range(20):  # let both settle identically before diverging
        f1 = sim_healthy.step()
        sim_healthy.apply_thermal_lag(f1["sensors"])
        f2 = sim_faulted.step()
        sim_faulted.apply_thermal_lag(f2["sensors"])

    frame_h = sim_healthy.step()
    frame_f = sim_faulted.step()

    healthy_lagged = sim_healthy.apply_thermal_lag(frame_h["sensors"])
    faulted_sensors = apply_fault("overheating", 1.0, frame_f["sensors"])
    faulted_lagged = sim_faulted.apply_thermal_lag(faulted_sensors)

    assert faulted_lagged["cht_c"] > healthy_lagged["cht_c"]