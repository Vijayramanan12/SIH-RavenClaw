"""
Real-time telemetry push for twin-core.

Runs a live physics simulation (unit_generator.EngineUnitSimulator) rather
than replaying the static training CSV -- this is the actual "digital
twin" behavior: a virtual engine advancing in real time, not a recorded
trace being played back. Two things build on it:

  - WebSocket push of one telemetry_frame per second (or --interval),
    so the dashboard just opens a socket and renders whatever arrives.
  - POST /inject_fault to kick off a live-developing fault mid-stream,
    using fault_injector.apply_fault, independent of any pre-baked
    fault_mode -- this is what makes "trigger a fault, watch it get
    caught live" possible in a demo.

Run with: python live_stream.py
Then:     ws://localhost:8002/ws/telemetry?unit_id=1
          curl -X POST localhost:8002/inject_fault \\
               -d '{"fault_mode": "overheating", "unit_id": 1}' \\
               -H "Content-Type: application/json"

Note: this previously imported `ingestion` and `state_estimator`, which
don't exist anywhere in the repo -- this version is self-contained instead,
built directly on unit_generator.py and ../models/fault_injector.py.
"""

import asyncio
import sys
from pathlib import Path
from typing import Dict, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "models"))
from fault_injector import FAULT_MODES, apply_fault, reset_drift_state  # noqa: E402
from physics_engine import LIMITS, breach_flags, to_engine_state  # noqa: E402

from unit_generator import EngineUnitSimulator  # noqa: E402

app = FastAPI(title="twin-core live stream")

PUSH_INTERVAL_SECONDS = 1.0
FAULT_RAMP_CYCLES = 60  # cycles from injection to full-severity (progress=1.0)


class _FaultState:
    """Tracks an operator-triggered live fault, if any, for the demo."""

    def __init__(self):
        self.active_mode: Optional[str] = None
        self.cycles_since_injection: int = 0

    def trigger(self, fault_mode: str) -> None:
        if fault_mode not in FAULT_MODES:
            raise ValueError(f"unknown fault_mode: {fault_mode!r}")
        reset_drift_state()
        self.active_mode = None if fault_mode == "none" else fault_mode
        self.cycles_since_injection = 0

    def progress(self) -> float:
        return min(self.cycles_since_injection / FAULT_RAMP_CYCLES, 1.0)

    def tick(self) -> None:
        if self.active_mode is not None:
            self.cycles_since_injection += 1


# One simulator + fault state per connected unit_id, so two dashboard tabs
# watching different units don't share fault-injection state.
_simulators: Dict[int, EngineUnitSimulator] = {}
_fault_states: Dict[int, _FaultState] = {}


def _get_or_create(unit_id: int) -> EngineUnitSimulator:
    if unit_id not in _simulators:
        _simulators[unit_id] = EngineUnitSimulator(unit_id=unit_id, ambient_c=25.0)
        _fault_states[unit_id] = _FaultState()
    return _simulators[unit_id]


class InjectFaultRequest(BaseModel):
    fault_mode: str  # one of FAULT_MODES; "none" clears an active fault
    unit_id: int = 1


@app.post("/inject_fault")
def inject_fault(req: InjectFaultRequest):
    """Trigger (or clear) a live fault for the given unit's stream."""
    _get_or_create(req.unit_id)
    _fault_states[req.unit_id].trigger(req.fault_mode)
    return {"unit_id": req.unit_id, "active_mode": _fault_states[req.unit_id].active_mode}


@app.websocket("/ws/telemetry")
async def ws_telemetry(websocket: WebSocket, unit_id: int = 1):
    """Push one telemetry_frame per PUSH_INTERVAL_SECONDS until disconnected."""
    await websocket.accept()
    simulator = _get_or_create(unit_id)
    fault_state = _fault_states[unit_id]
    try:
        while True:
            frame = simulator.step()
            frame["limits"] = LIMITS

            if fault_state.active_mode is not None:
                frame["sensors"] = apply_fault(
                    fault_state.active_mode, fault_state.progress(), frame["sensors"]
                )
                frame["injected_fault"] = {
                    "mode": fault_state.active_mode,
                    "progress": round(fault_state.progress(), 3),
                }
                fault_state.tick()

            # always applied, healthy or faulty -- lag is part of normal
            # engine behavior, and any fault's heat buildup needs the same
            # inertia rather than jumping instantly
            frame["sensors"] = simulator.apply_thermal_lag(frame["sensors"])

            obs = simulator.observe(frame["sensors"])
            frame["residuals"] = obs["residuals"]
            frame["thermodynamics"] = obs["thermodynamics"]

            frame["breach_flags"] = breach_flags(frame)
            frame["engine_state"] = to_engine_state(frame["sensors"])
            await websocket.send_json(frame)
            await asyncio.sleep(PUSH_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        pass  # client closed the tab -- nothing to clean up


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)