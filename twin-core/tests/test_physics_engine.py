import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "models"))

from mission_profile import MISSION_PROFILE, build_rpm_and_phase_trace  # noqa: E402
from physics_engine import (  # noqa: E402
    BASELINE,
    breach_flags,
    calculate_thermodynamics,
    compute_residuals,
    physics_informed_readings,
    to_engine_state,
)


def test_physics_informed_readings_at_idle():
    readings = physics_informed_readings(rpm=BASELINE["rpm_idle"], ambient_c=25.0)
    # at idle, rpm_frac clamps to 0, so cht/egt should sit near their floor values
    assert readings["rpm"] == BASELINE["rpm_idle"]
    assert 70 <= readings["cht_c"] < 90
    assert 390 <= readings["egt_c"] < 420


def test_physics_informed_readings_at_max_continuous_rpm():
    readings = physics_informed_readings(rpm=BASELINE["rpm_max_cont"], ambient_c=25.0)
    # at max RPM, rpm_frac clamps to 1, so cht/egt should be near their normal (not fault) ceiling
    assert abs(readings["cht_c"] - (BASELINE["cht_normal_c"] + 25 * 0.15)) < 1e-6
    assert abs(readings["egt_c"] - BASELINE["egt_normal_c"]) < 1e-6


def test_physics_informed_readings_clamps_beyond_max_rpm():
    # RPM past max_cont shouldn't push sensors past the max_cont values --
    # rpm_frac clamps to 1.0 rather than extrapolating.
    at_max = physics_informed_readings(rpm=BASELINE["rpm_max_cont"], ambient_c=25.0)
    beyond_max = physics_informed_readings(rpm=BASELINE["rpm_max_cont"] + 2000, ambient_c=25.0)
    assert at_max["cht_c"] == beyond_max["cht_c"]
    assert at_max["egt_c"] == beyond_max["egt_c"]


def test_mission_profile_trace_shape():
    rpm_trace, phase_trace = build_rpm_and_phase_trace()
    expected_len = sum(duration for _, duration, _ in MISSION_PROFILE)
    assert len(rpm_trace) == expected_len
    assert len(phase_trace) == expected_len
    # first phase should start at idle rpm, ramping toward the first target
    assert rpm_trace[0] == BASELINE["rpm_idle"]
    assert phase_trace[0] == MISSION_PROFILE[0][0]


def test_breach_flags_detects_overheat():
    frame = {
        "sensors": {"cht_c": 160, "egt_c": 850, "oil_press_psi": 55, "oil_temp_c": 100},
        "limits": {"cht_max_c": 150, "egt_max_c": 900, "oil_press_min_psi": 22,
                   "oil_press_max_psi": 72, "oil_temp_max_c": 120},
    }
    flags = breach_flags(frame)
    assert flags["cht_over"] is True
    assert flags["egt_over"] is False


def test_breach_flags_detects_low_oil_pressure():
    frame = {
        "sensors": {"cht_c": 100, "egt_c": 700, "oil_press_psi": 15, "oil_temp_c": 90},
        "limits": {"cht_max_c": 150, "egt_max_c": 900, "oil_press_min_psi": 22,
                   "oil_press_max_psi": 72, "oil_temp_max_c": 120},
    }
    flags = breach_flags(frame)
    assert flags["oil_press_low"] is True
    assert flags["oil_press_high"] is False


def test_breach_flags_uses_module_default_limits_when_omitted():
    healthy_frame = {"sensors": physics_informed_readings(BASELINE["rpm_cruise"], 25.0)}
    flags = breach_flags(healthy_frame)
    assert not any(flags.values())


def test_physics_informed_readings_includes_throttle_pct():
    idle = physics_informed_readings(BASELINE["rpm_idle"], 25.0)
    cruise = physics_informed_readings(BASELINE["rpm_max_cont"], 25.0)
    assert idle["throttle_pct"] == 0.0
    assert cruise["throttle_pct"] == 100.0


def test_to_engine_state_converts_units_and_renames_fields():
    sensors = physics_informed_readings(BASELINE["rpm_cruise"], 25.0)
    state = to_engine_state(sensors)
    assert set(state) == {
        "rpm", "throttle", "egt_c", "cht_c",
        "oil_pressure_bar", "oil_temperature_c", "fuel_flow_lph", "vibration_g",
    }
    # oil_press_psi -> oil_pressure_bar: 1 psi = 0.0689476 bar
    expected_bar = round(sensors["oil_press_psi"] * 0.0689476, 2)
    assert state["oil_pressure_bar"] == expected_bar
    assert state["throttle"] == sensors["throttle_pct"]


def test_to_engine_state_defaults_throttle_when_missing():
    sensors = {
        "rpm": 5000.0, "egt_c": 800.0, "cht_c": 110.0,
        "oil_press_psi": 58.0, "oil_temp_c": 100.0, "fuel_flow_lph": 15.0, "vibration_g": 0.5,
    }
    state = to_engine_state(sensors)
    assert state["throttle"] == 0.0


def test_physics_informed_readings_includes_map_inhg():
    idle = physics_informed_readings(BASELINE["rpm_idle"], 25.0)
    cruise = physics_informed_readings(BASELINE["rpm_max_cont"], 25.0)
    assert idle["map_inhg"] == BASELINE["map_idle_inhg"]
    assert cruise["map_inhg"] == BASELINE["map_max_inhg"]
    assert idle["map_inhg"] < cruise["map_inhg"]


def test_calculate_thermodynamics():
    cruise_sensors = physics_informed_readings(BASELINE["rpm_cruise"], 25.0)
    thermo = calculate_thermodynamics(cruise_sensors)
    assert thermo["brake_power_kw"] > 0
    assert thermo["brake_power_hp"] > 0
    assert thermo["torque_nm"] > 0
    assert 150 <= thermo["bsfc_g_kwh"] <= 350
    assert 20.0 <= thermo["thermal_efficiency_pct"] <= 42.0
    assert thermo["bmep_bar"] > 0
    assert thermo["volumetric_efficiency_pct"] > 0


def test_compute_residuals_healthy_vs_faulted():
    healthy = physics_informed_readings(BASELINE["rpm_cruise"], 25.0)
    nominal = dict(healthy)

    # Identical state -> discrepancy should be zero
    res_healthy = compute_residuals(healthy, nominal)
    assert res_healthy["discrepancy_score"] == 0.0
    assert res_healthy["state"] == "nominal"

    # Injected overheating fault -> discrepancy should spike
    faulted = dict(healthy)
    faulted["cht_c"] += 35.0
    faulted["egt_c"] += 60.0
    res_faulted = compute_residuals(faulted, nominal)
    assert res_faulted["discrepancy_score"] > 8.0
    assert res_faulted["state"] == "divergent"