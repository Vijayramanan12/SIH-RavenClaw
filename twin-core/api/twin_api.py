"""
Digital twin core REST API for twin-core.

Serves the current telemetry_frame (docs/DATA_CONTRACT.md section 2) via
polling, for consumers that don't want a WebSocket. For push-based
streaming with live fault injection, run simulator/live_stream.py instead
(port 8002) -- this file (port 8001) is the simpler polling counterpart
the original README documented.

Note: this previously imported `ingestion` and `state_estimator`, which
don't exist anywhere in the repo -- this version is self-contained
instead, built directly on ../simulator/unit_generator.py and
../models/physics_engine.py.

Run with: python twin_api.py
Then:     curl http://localhost:8001/telemetry/latest
          curl http://localhost:8001/telemetry/latest?unit_id=2
"""

import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "models"))
from physics_engine import LIMITS, breach_flags, to_engine_state  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "simulator"))
from unit_generator import EngineUnitSimulator  # noqa: E402

app = FastAPI(title="twin-core")

# One simulator per requested unit_id, advancing one cycle per GET -- the
# same "advances each call" behavior the original README described, just
# now backed by a live physics model instead of a CSV cursor.
_simulators = {}


def _get_or_create(unit_id: int) -> EngineUnitSimulator:
    if unit_id not in _simulators:
        _simulators[unit_id] = EngineUnitSimulator(unit_id=unit_id, ambient_c=25.0)
    return _simulators[unit_id]


@app.get("/telemetry/latest")
def latest(unit_id: int = 1):
    """Return the next telemetry_frame for this unit (advances one cycle per call)."""
    simulator = _get_or_create(unit_id)
    frame = simulator.step()
    frame["sensors"] = simulator.apply_thermal_lag(frame["sensors"])
    obs = simulator.observe(frame["sensors"])
    frame["residuals"] = obs["residuals"]
    frame["thermodynamics"] = obs["thermodynamics"]
    frame["limits"] = LIMITS
    frame["breach_flags"] = breach_flags(frame)
    frame["engine_state"] = to_engine_state(frame["sensors"])
    return frame


@app.get("/health")
def health():
    """Basic liveness check -- useful for the dashboard team to poll before wiring up."""
    return {"status": "ok", "active_units": list(_simulators.keys())}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)