"""
inference_api.py — serves health_report per docs/DATA_CONTRACT.md section 3.
 
Loads all three trained models (anomaly, RUL, fault classifier) and scores
the latest telemetry rows, returning the exact JSON shape twin-core/dashboard
expect. Run:
 
    python3 inference_api.py
 
Then:
    curl http://localhost:8002/health/latest
"""
 
from datetime import datetime, timezone
from pathlib import Path
 
import pandas as pd
from fastapi import FastAPI
 
import anomaly_detector
import fault_classifier
import rul_model
from features import add_rolling_features, load_dataset
 
app = FastAPI(title="ml-models health_report API")
 
_CACHE = {}  # lazily-loaded scored dataset, refreshed on first request
 
 
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
 
 
if __name__ == "__main__":
    import uvicorn
 
    # ensure all three model artifacts exist before serving
    for module, path in [
        (anomaly_detector, anomaly_detector.ARTIFACT_PATH),
        (rul_model, rul_model.ARTIFACT_PATH),
        (fault_classifier, fault_classifier.ARTIFACT_PATH),
    ]:
        if not Path(path).exists():
            print(f"Training missing model: {module.__name__}")
            module.train()
 
    uvicorn.run(app, host="127.0.0.1", port=8002)
 








