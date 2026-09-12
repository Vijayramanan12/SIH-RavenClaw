"""
anomaly_detector.py — unsupervised anomaly scoring (ml-models, Group 2).

Trains an Isolation Forest on HEALTHY-ONLY rows (fault_mode == "none"),
using the rolling features from features.py across all sensors combined.
Never trains on fault_mode or RUL directly — those are labels, used only
to select the healthy training subset and to evaluate afterward.
"""

from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import IsolationForest

from features import add_rolling_features, feature_columns, load_dataset

ARTIFACT_PATH = Path(__file__).resolve().parents[1] / "artifacts" / "anomaly_model.joblib"


def train(df: pd.DataFrame = None) -> IsolationForest:
    if df is None:
        df = add_rolling_features(load_dataset())

    cols = feature_columns(df)
    healthy = df[df["fault_mode"] == "none"]

    model = IsolationForest(n_estimators=200, contamination=0.05, random_state=42)
    model.fit(healthy[cols])

    ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "feature_cols": cols}, ARTIFACT_PATH)
    return model


def load_model():
    bundle = joblib.load(ARTIFACT_PATH)
    return bundle["model"], bundle["feature_cols"]


def predict(df: pd.DataFrame) -> pd.DataFrame:
    """Adds is_anomalous (bool) and anomaly_score (float, higher = MORE anomalous).

    sklearn's IsolationForest.decision_function() returns higher = more
    normal (inlier), which is the opposite of what a field literally named
    "anomaly_score" should mean to a downstream consumer (dashboard, this
    health_report's `anomaly.score` field). Sign is flipped here so the
    convention is consistent everywhere it's used -- verified: without the
    flip, mean anomaly_score for overheating-fault rows (0.108) was LOWER
    than for healthy rows (0.119), i.e. faulty engines looked healthier.
    """
    model, cols = load_model()
    df = df.copy()
    df["anomaly_score"] = -model.decision_function(df[cols])
    df["is_anomalous"] = model.predict(df[cols]) == -1
    return df


if __name__ == "__main__":
    raw = load_dataset()
    featured = add_rolling_features(raw)

    print("Training anomaly detector on healthy-only rows...")
    train(featured)
    print(f"Saved model to {ARTIFACT_PATH}")

    scored = predict(featured)
    print("\nFraction of rows flagged anomalous, by fault_mode:")
    print(scored.groupby("fault_mode")["is_anomalous"].mean().sort_values(ascending=False))