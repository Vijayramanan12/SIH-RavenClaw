"""
fault_classifier.py — multi-class fault_mode classification (ml-models, Group 2).

Trains a Random Forest classifier to predict fault_mode (none / overheating
/ misfire_vibration / oil_degradation / sensor_drift) from the rolling
features across all sensors. fault_mode is the ground-truth label column
— training target, never an input feature.
"""

from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report

from features import add_rolling_features, feature_columns, load_dataset, stratified_group_split

ARTIFACT_PATH = Path(__file__).resolve().parents[1] / "artifacts" / "fault_classifier.joblib"


def train(df: pd.DataFrame = None) -> RandomForestClassifier:
    if df is None:
        df = add_rolling_features(load_dataset())

    cols = feature_columns(df)

    # NOTE: plain GroupShuffleSplit doesn't stratify by class -- with only
    # 8 units for some fault types, that risks a fault type landing with
    # zero test units (verified: with this file's own random_state=42,
    # plain GroupShuffleSplit puts "overheating" in the test set with 0
    # units, silently dropping it from classification_report entirely).
    # stratified_group_split (already used by rul_model.py) guarantees
    # every fault_mode gets proportional representation in both splits.
    train_df, test_df = stratified_group_split(df, test_size=0.2, random_state=42)

    model = RandomForestClassifier(
        n_estimators=300, max_depth=12, random_state=42, n_jobs=-1, class_weight="balanced"
    )
    model.fit(train_df[cols], train_df["fault_mode"])

    preds = model.predict(test_df[cols])
    print(classification_report(test_df["fault_mode"], preds))

    ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "feature_cols": cols, "classes": model.classes_.tolist()},
                ARTIFACT_PATH)
    return model


def load_model():
    bundle = joblib.load(ARTIFACT_PATH)
    return bundle["model"], bundle["feature_cols"], bundle["classes"]


def predict(df: pd.DataFrame) -> pd.DataFrame:
    """Adds predicted_fault_mode (str) and fault_probabilities (dict per row)."""
    model, cols, classes = load_model()
    df = df.copy()
    proba = model.predict_proba(df[cols])
    df["predicted_fault_mode"] = model.predict(df[cols])
    df["fault_probabilities"] = [dict(zip(classes, row.round(3))) for row in proba]
    return df


if __name__ == "__main__":
    raw = load_dataset()
    featured = add_rolling_features(raw)

    print("Training fault classifier...")
    train(featured)
    print(f"Saved model to {ARTIFACT_PATH}")

    scored = predict(featured)
    print("\nSample: one row per fault_mode, with predicted probabilities")
    sample = scored.groupby("fault_mode").tail(1)
    for _, row in sample.iterrows():
        print(f"  true={row['fault_mode']:<20} predicted={row['predicted_fault_mode']:<20} "
              f"probs={row['fault_probabilities']}")