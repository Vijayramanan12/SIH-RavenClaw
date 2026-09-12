"""
MQTT publisher for twin-core telemetry.

Wires the "synthetic data -> MQTT ingestion -> digital twin core state"
leg of the architecture: takes telemetry_frames (docs/DATA_CONTRACT.md)
and publishes them so ml-models and dashboard can subscribe instead of
polling twin_api.py's REST endpoint.

Topic convention:
    twin/{unit_id}/telemetry   one telemetry_frame per message (JSON)
    twin/{unit_id}/can         the same frame, CAN-encoded (can_emulator.py),
                               for demoing the acquisition-layer path end to end

Requires paho-mqtt (pin <2.0 -- see note in twin-core/requirements.txt).
Needs a running broker; for local dev, Mosquitto's docker image works:
    docker run -it -p 1883:1883 eclipse-mosquitto

Run standalone to replay the sample CSV over MQTT:
    python mqtt_publisher.py --csv ../../data/engine_telemetry_dataset.csv --unit-id 1
"""

import json
import logging
import time
from dataclasses import asdict, is_dataclass
from typing import Iterable

import paho.mqtt.client as mqtt

try:
    from .can_emulator import CANEmulator
except ImportError:  # running as a flat script rather than a package
    from can_emulator import CANEmulator

logger = logging.getLogger("twin_core.mqtt_publisher")

SENSOR_COLUMNS = [
    "rpm", "map_inhg", "cht_c", "egt_c", "fuel_flow_lph",
    "oil_press_psi", "oil_temp_c", "vibration_g", "ambient_c",
]


class TelemetryPublisher:
    """Thin wrapper around paho-mqtt for publishing telemetry_frames."""

    def __init__(self, broker_host: str = "localhost", broker_port: int = 1883,
                 client_id: str = "twin-core-publisher", qos: int = 0):
        self.qos = qos
        self._broker_host = broker_host
        self._broker_port = broker_port
        self._connected = False
        self._client = mqtt.Client(client_id=client_id)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect

    def _on_connect(self, client, userdata, flags, rc):
        self._connected = (rc == 0)
        if self._connected:
            logger.info("Connected to MQTT broker at %s:%s", self._broker_host, self._broker_port)
        else:
            logger.warning("MQTT connect failed, rc=%s", rc)

    def _on_disconnect(self, client, userdata, rc):
        self._connected = False
        logger.warning("Disconnected from MQTT broker, rc=%s", rc)

    def connect(self, timeout_s: float = 5.0) -> None:
        self._client.connect_async(self._broker_host, self._broker_port)
        self._client.loop_start()
        waited = 0.0
        while not self._connected and waited < timeout_s:
            time.sleep(0.1)
            waited += 0.1
        if not self._connected:
            logger.warning("Proceeding without confirmed broker connection "
                            "(paho will keep retrying automatically)")

    def disconnect(self) -> None:
        self._client.loop_stop()
        self._client.disconnect()

    def publish_telemetry(self, telemetry_frame: dict) -> None:
        """Publish one telemetry_frame to twin/{unit_id}/telemetry."""
        unit_id = telemetry_frame.get("unit_id", "unknown")
        topic = f"twin/{unit_id}/telemetry"
        self._client.publish(topic, json.dumps(telemetry_frame, default=str), qos=self.qos)

    def publish_can_frames(self, unit_id, frames: Iterable) -> None:
        """Publish CAN-encoded frames to twin/{unit_id}/can (demo path only)."""
        topic = f"twin/{unit_id}/can"
        serializable = [asdict(f) if is_dataclass(f) else dict(f) for f in frames]
        for item in serializable:
            if isinstance(item.get("data"), (bytes, bytearray)):
                item["data"] = item["data"].hex()
        self._client.publish(topic, json.dumps(serializable), qos=self.qos)


def stream_csv_over_mqtt(csv_path: str, unit_id: int, interval_s: float = 1.0,
                          broker_host: str = "localhost", broker_port: int = 1883,
                          publish_can: bool = False) -> None:
    """
    Demo/CLI helper: replay one unit's rows from the sample CSV over MQTT
    at a fixed cadence, so ml-models/dashboard can subscribe against
    something real while simulator/live_stream.py and state_estimator.py
    are still being built out.

    This builds telemetry_frames itself rather than importing
    state_estimator.to_telemetry_frame, since that module doesn't exist
    in the repo yet -- swap this call out once it lands.
    """
    import pandas as pd

    df = pd.read_csv(csv_path)
    unit_df = df[df["unit_id"] == unit_id].sort_values("cycle")
    if unit_df.empty:
        raise ValueError(f"no rows found for unit_id={unit_id} in {csv_path}")

    publisher = TelemetryPublisher(broker_host, broker_port)
    publisher.connect()
    emulator = CANEmulator() if publish_can else None

    try:
        for _, row in unit_df.iterrows():
            frame = {
                "unit_id": int(row["unit_id"]),
                "cycle": int(row["cycle"]),
                "phase": row["phase"],
                "sensors": {col: float(row[col]) for col in SENSOR_COLUMNS},
            }
            publisher.publish_telemetry(frame)
            if emulator is not None:
                publisher.publish_can_frames(frame["unit_id"], emulator.encode(frame))
            logger.info("published unit=%s cycle=%s", frame["unit_id"], frame["cycle"])
            time.sleep(interval_s)
    finally:
        publisher.disconnect()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Replay a unit's telemetry over MQTT.")
    parser.add_argument("--csv", required=True, help="path to engine_telemetry_dataset.csv")
    parser.add_argument("--unit-id", type=int, default=1)
    parser.add_argument("--interval", type=float, default=1.0, help="seconds between messages")
    parser.add_argument("--broker-host", default="localhost")
    parser.add_argument("--broker-port", type=int, default=1883)
    parser.add_argument("--publish-can", action="store_true",
                         help="also publish CAN-encoded frames to twin/{unit_id}/can")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    stream_csv_over_mqtt(args.csv, args.unit_id, args.interval,
                         args.broker_host, args.broker_port, args.publish_can)