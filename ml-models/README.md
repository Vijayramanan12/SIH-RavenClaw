# ml-models (Group 2)

**Owns:** C → Fault Detection & Predictive Analytics, D → AI/ML Layer.

## Scope

- **Anomaly detection**: flag telemetry that deviates from healthy
  operation (start simple — e.g. Isolation Forest / autoencoder
  reconstruction error — then iterate).
- **RUL estimation**: regression model predicting `RUL` (cycles remaining)
  from a telemetry window, trained on the `RUL` column in
  `data/engine_telemetry_dataset.csv`.
- **Fault classification**: predict which `fault_mode` (or none) is
  developing, from `overheating`, `misfire_vibration`, `oil_degradation`,
  `sensor_drift`.
- Package all three into one `health_report` per `docs/DATA_CONTRACT.md`,
  served for `dashboard` to consume.

## Layout

```
ml-models/
├── src/
│   ├── features.py          # windowing + feature extraction from raw telemetry
│   ├── anomaly_detector.py  # unsupervised anomaly scoring
│   ├── rul_model.py         # RUL regression (train + predict)
│   ├── fault_classifier.py  # fault_mode classification (train + predict)
│   └── inference_api.py     # serves health_report (FastAPI stub)
├── notebooks/                # EDA / experiments
├── tests/
└── requirements.txt
```

## Quickstart

```bash
cd ml-models
pip install -r requirements.txt
python src/rul_model.py          # trains a baseline model on ../data/engine_telemetry_dataset.csv
python src/inference_api.py      # serves health_report at http://localhost:8003/health/latest
```

The live dashboard sends each WebSocket telemetry frame to
`POST /health/score` on port 8003. This scores the exact displayed frame
with the three trained artifacts; port 8002 remains reserved for
`twin-core/simulator/live_stream.py`.

## Notes on the dataset

- `fault_mode` and `RUL` are **ground truth labels for training/eval only**
  — at inference time you'll only have the sensor columns, exactly like a
  real deployment. Don't accidentally feed them in as model features.
- The generator (`../data/engine_data_generator.py`) is seeded
  (`np.random.default_rng(42)`), so re-running it gives the same dataset —
  useful for reproducible experiments. Increase `n_healthy` /
  `n_faulty_per_mode` there if you need more training data.
- This is synthetic data standing in for real telemetry — expect to retune
  or replace models once real/rig data is available; keep the
  feature/label pipeline in `features.py` decoupled from any one dataset.

## Next steps for this group

1. Start with the baseline threshold approach in
   `twin-core/src/state_estimator.py::breach_flags` as the thing to beat.
2. Get a first RUL regression + anomaly detector working end-to-end against
   `telemetry_frame`s from `twin-core`'s API before optimizing accuracy.
3. Add explainability (e.g. feature importances or SHAP) for the fault
   classifier — the PS lists "Explainable AI for fault diagnosis" as a
   desired innovation area.
