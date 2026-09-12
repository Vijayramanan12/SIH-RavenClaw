"""
inference_api.py — serves health_report per docs/DATA_CONTRACT.md section 3.
 
Loads all three trained models (anomaly, RUL, fault classifier) and scores
the latest telemetry rows, returning the exact JSON shape twin-core/dashboard
expect. Run:
 
    python3 inference_api.py
 
Then:
    curl http://localhost:8003/health/latest
"""
 
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import pandas as pd
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import anomaly_detector
import fault_classifier
import rul_model
from features import SENSOR_COLUMNS, add_rolling_features, load_dataset

app = FastAPI(title="ml-models health_report API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    # Vite selects the next free port when 5173 is occupied. Permit local
    # development origins on that port too, without opening the API to the web.
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

_CACHE = {}  # lazily-loaded scored dataset, refreshed on first request

TWIN_CORE_URL = "http://localhost:8001/telemetry/latest"
LIVE_HISTORY_LEN = 60  # a few multiples of ROLL_WINDOW so rolling stats aren't just 1-2 points
_live_history: Dict[int, List[dict]] = {}

# --- models loaded ONCE here, not per-request ---------------------------
# anomaly_detector.predict()/fault_classifier.predict()/rul_model.predict()
# each call their own load_model(), which re-reads from disk every time --
# fine for the batch /health/latest path (scored once, cached), but would
# mean re-reading the ~47MB rul_model.joblib off disk on every single live
# poll if reused as-is for /health/live below. Loading each (model, cols)
# bundle once here and scoring against the cached objects directly avoids
# that repeated disk I/O.
_anomaly_model = _anomaly_cols = None
_rul_model_obj = _rul_cols = None
_fault_model = _fault_cols = _fault_classes = None


def _load_models_once():
    """Load (or train) artifacts before the first inference request."""
    global _anomaly_model, _anomaly_cols, _rul_model_obj, _rul_cols
    global _fault_model, _fault_cols, _fault_classes
    if _anomaly_model is not None:
        return

    for module, path in [
        (anomaly_detector, anomaly_detector.ARTIFACT_PATH),
        (rul_model, rul_model.ARTIFACT_PATH),
        (fault_classifier, fault_classifier.ARTIFACT_PATH),
    ]:
        if not Path(path).exists():
            module.train()

    _anomaly_model, _anomaly_cols = anomaly_detector.load_model()
    _rul_model_obj, _rul_cols = rul_model.load_model()
    _fault_model, _fault_cols, _fault_classes = fault_classifier.load_model()
 
 
@app.get("/")
def root():
    """Root URL also returns the latest health_report directly, so visiting
    just http://127.0.0.1:8002/ works instead of 404ing."""
    return health_latest()
 
 
def _get_scored_dataset() -> pd.DataFrame:
    if "scored" not in _CACHE:
        raw = load_dataset()
        featured = add_rolling_features(raw)
        featured = anomaly_detector.predict(featured)
        featured = rul_model.predict(featured)
        featured = fault_classifier.predict(featured)
        _CACHE["scored"] = featured
    return _CACHE["scored"]
 
 
def _advisory_for(row: pd.Series) -> str:
    """Simple rule-based advisory text from the model outputs. Replace with
    something smarter (e.g. templated per fault_mode) as the project matures."""
    top_fault = max(
        row["fault_probabilities"].items(), key=lambda kv: kv[1]
    )
    fault_name, fault_prob = top_fault
 
    if fault_name == "none" or fault_prob < 0.5:
        return "No significant fault signature detected."
 
    rul = row["rul_estimate_cycles"]
    readable = fault_name.replace("_", " ")
    return f"{readable.capitalize()} signature detected ({fault_prob:.0%} confidence) — estimated {rul} cycles remaining."
 
 
def _row_to_health_report(row: pd.Series) -> dict:
    return {
        "unit_id": int(row["unit_id"]),
        "cycle": int(row["cycle"]),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "anomaly": {
            "is_anomalous": bool(row["is_anomalous"]),
            "score": round(float(row["anomaly_score"]), 3),
        },
        "rul_estimate_cycles": int(row["rul_estimate_cycles"]),
        "fault_probabilities": {k: round(float(v), 3) for k, v in row["fault_probabilities"].items()},
        "advisory": _advisory_for(row),
    }
 
 
@app.get("/health/latest")
def health_latest(unit_id: int | None = None):
    """Returns the health_report for the most recent cycle of the given
    unit_id (or the first unit if unspecified)."""
    df = _get_scored_dataset()
    if unit_id is not None:
        df = df[df["unit_id"] == unit_id]
    else:
        df = df[df["unit_id"] == df["unit_id"].iloc[0]]
 
    latest = df.sort_values("cycle").iloc[-1]
    return _row_to_health_report(latest)
 
 
@app.get("/health/{unit_id}/{cycle}")
def health_at_cycle(unit_id: int, cycle: int):
    """Returns the health_report for a specific unit_id + cycle (useful for
    dashboard mission replay)."""
    df = _get_scored_dataset()
    row = df[(df["unit_id"] == unit_id) & (df["cycle"] == cycle)]
    if row.empty:
        return {"error": f"no data for unit_id={unit_id}, cycle={cycle}"}
    return _row_to_health_report(row.iloc[0])


def _score_live_row(df: pd.DataFrame) -> pd.Series:
    """
    Score the last row of df using the models cached at module load time
    (see top of file) instead of anomaly_detector.predict() etc., which
    would each re-read their model from disk on every call -- fine once
    for the batch endpoints above, too slow to do on every live poll.
    """
    _load_models_once()
    row = df.iloc[[-1]]
    anomaly_score = -_anomaly_model.decision_function(row[_anomaly_cols])[0]
    is_anomalous = bool(_anomaly_model.predict(row[_anomaly_cols])[0] == -1)
    rul_estimate = int(round(_rul_model_obj.predict(row[_rul_cols])[0]))
    proba = _fault_model.predict_proba(row[_fault_cols])[0]
    fault_probabilities = dict(zip(_fault_classes, proba.round(3)))

    result = row.iloc[0].copy()
    result["anomaly_score"] = anomaly_score
    result["is_anomalous"] = is_anomalous
    result["rul_estimate_cycles"] = rul_estimate
    result["fault_probabilities"] = fault_probabilities
    return result


def _score_telemetry_frame(payload: dict) -> dict:
    """Score one twin-core telemetry_frame, retaining per-unit feature history."""
    sensors = payload.get("sensors") if isinstance(payload, dict) else None
    if not isinstance(sensors, dict):
        raise HTTPException(status_code=422, detail="body must be a telemetry_frame with a sensors object")

    try:
        unit_id, cycle = int(payload["unit_id"]), int(payload["cycle"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="telemetry_frame requires integer unit_id and cycle") from exc

    row = {"unit_id": unit_id, "cycle": cycle, "phase": payload.get("phase", "unknown")}
    for col in SENSOR_COLUMNS:
        if col not in sensors:
            raise HTTPException(status_code=422, detail=f"telemetry_frame is missing sensor '{col}'")
        row[col] = sensors[col]

    history = _live_history.setdefault(unit_id, [])
    # A simulator restart begins a new trajectory; a duplicate browser retry
    # must not distort rolling features by adding the same cycle twice.
    if history and cycle < history[-1]["cycle"]:
        history.clear()
    if not history or cycle > history[-1]["cycle"]:
        history.append(row)
        del history[:-LIVE_HISTORY_LEN]

    scored_row = _score_live_row(add_rolling_features(pd.DataFrame(history)))
    report = _row_to_health_report(scored_row)
    report["timestamp"] = payload.get("timestamp") or report["timestamp"]
    return report


@app.post("/health/score")
def score_telemetry_frame(payload: dict):
    """Score the exact telemetry frame received by a dashboard/WebSocket client."""
    return _score_telemetry_frame(payload)


@app.get("/health/live")
def health_live(unit_id: int = 1):
    """
    Pulls the latest telemetry_frame from twin-core's REST API
    (twin-core/api/twin_api.py) and scores it -- this is the actual
    real-time path the PS asks for, as opposed to /health/latest above,
    which only replays the static offline training CSV and returns the
    same answer every time regardless of what the live simulation is doing.

    Keeps a small in-memory rolling history per unit_id, since
    add_rolling_features() needs several recent cycles to compute
    meaningful rolling stats, not just the single frame that just arrived.
    """
    try:
        resp = requests.get(TWIN_CORE_URL, params={"unit_id": unit_id}, timeout=5)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise HTTPException(
            status_code=502,
            detail=f"couldn't reach twin-core at {TWIN_CORE_URL} ({e}) -- "
                   f"is twin-core/api/twin_api.py running?",
        )

    return _score_telemetry_frame(resp.json())

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8003)
