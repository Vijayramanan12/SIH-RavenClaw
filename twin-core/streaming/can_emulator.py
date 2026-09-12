"""
CAN bus telemetry framing (emulated) for twin-core.

The PS explicitly allows "CAN bus/SocketCAN-based engine data acquisition"
as one route into the digital twin. There's no real ECU/FADEC hardware to
read from, so this module emulates what an acquisition layer would see:
each sensor in a telemetry_frame (../../docs/DATA_CONTRACT.md) is mapped to
an arbitration ID and packed into a 2-byte payload -- the shape a real
`candump` on a SocketCAN interface (can0) would show.

This is illustrative, not a byte-accurate replica of any specific Rotax
912 ECU's DBC file (none is public). Treat SIGNAL_MAP as a stand-in you'd
replace with the real DBC mapping if/when test-rig hardware is available.

Usage:
    from can_emulator import CANEmulator

    emulator = CANEmulator()
    frames = emulator.encode(telemetry_frame)   # -> list[CANFrame]
    sensors = emulator.decode(frames)           # -> dict, round-trips
"""

from dataclasses import dataclass
from typing import Dict, Iterable, List


# Arbitration ID + fixed-point scale for each sensor currently in
# telemetry_frame (docs/DATA_CONTRACT.md section 2). `scale` converts a
# float sensor value to an integer that fits in 2 bytes -- e.g. vibration_g
# at scale=1000 stores 0.512 g as the integer 512.
#
# NOTE: the extended sensors added to data/engine_data_generator.py
# (battery_voltage_v, alternator_current_a, injection_timing_btdc_deg,
# injector_pulse_width_ms) are not yet part of the agreed DATA_CONTRACT.
# Add entries here once the schema is bumped and ml-models/dashboard sign off.
SIGNAL_MAP = {
    "rpm":           {"can_id": 0x100, "scale": 1,    "signed": False},
    "cht_c":         {"can_id": 0x101, "scale": 10,   "signed": False},
    "egt_c":         {"can_id": 0x102, "scale": 10,   "signed": False},
    "fuel_flow_lph": {"can_id": 0x103, "scale": 100,  "signed": False},
    "oil_press_psi": {"can_id": 0x104, "scale": 10,   "signed": False},
    "oil_temp_c":    {"can_id": 0x105, "scale": 10,   "signed": False},
    "vibration_g":   {"can_id": 0x106, "scale": 1000, "signed": False},
    "ambient_c":     {"can_id": 0x107, "scale": 10,   "signed": True},
    "map_inhg":      {"can_id": 0x108, "scale": 10,   "signed": False},
}

_UINT16_MAX = 0xFFFF
_INT16_MIN, _INT16_MAX = -0x8000, 0x7FFF


@dataclass
class CANFrame:
    """One simulated CAN frame -- mirrors what python-can's Message gives you."""
    can_id: int
    signal: str
    dlc: int
    data: bytes

    @property
    def data_hex(self) -> str:
        return self.data.hex().upper()

    def __repr__(self) -> str:
        return f"CANFrame(id=0x{self.can_id:03X}, signal={self.signal}, data={self.data_hex})"


class CANEmulator:
    """Packs/unpacks telemetry_frame sensors as simulated 2-byte CAN payloads."""

    def __init__(self, signal_map: Dict[str, dict] = None):
        self.signal_map = signal_map or SIGNAL_MAP
        self._by_id = {meta["can_id"]: (signal, meta) for signal, meta in self.signal_map.items()}

    def encode(self, telemetry_frame: dict) -> List[CANFrame]:
        """
        Convert one telemetry_frame's sensors into a list of CANFrames, one
        per known signal. Accepts either the full frame (with a "sensors"
        key) or a bare sensors dict. Unknown sensor keys are skipped, not
        raised -- an emulator shouldn't crash the pipeline over schema
        drift; log that upstream instead.
        """
        sensors = telemetry_frame.get("sensors", telemetry_frame)
        frames = []
        for signal, meta in self.signal_map.items():
            if signal not in sensors:
                continue
            raw = round(sensors[signal] * meta["scale"])
            if meta["signed"]:
                raw = max(min(raw, _INT16_MAX), _INT16_MIN)
                data = raw.to_bytes(2, byteorder="big", signed=True)
            else:
                raw = max(min(raw, _UINT16_MAX), 0)
                data = raw.to_bytes(2, byteorder="big", signed=False)
            frames.append(CANFrame(can_id=meta["can_id"], signal=signal, dlc=2, data=data))
        return frames

    def decode(self, frames: Iterable[CANFrame]) -> Dict[str, float]:
        """Reverse of encode() -- reconstructs a sensors dict from CAN frames."""
        sensors = {}
        for frame in frames:
            if frame.can_id not in self._by_id:
                continue
            signal, meta = self._by_id[frame.can_id]
            raw = int.from_bytes(frame.data, byteorder="big", signed=meta["signed"])
            sensors[signal] = raw / meta["scale"]
        return sensors


if __name__ == "__main__":
    demo_frame = {
        "unit_id": 1,
        "cycle": 142,
        "sensors": {
            "rpm": 5001.2, "cht_c": 108.4, "egt_c": 795.1, "fuel_flow_lph": 14.8,
            "oil_press_psi": 57.9, "oil_temp_c": 99.6, "vibration_g": 0.51, "ambient_c": 27.3,
        },
    }
    emulator = CANEmulator()
    frames = emulator.encode(demo_frame)
    for f in frames:
        print(f)
    print("round-trip:", emulator.decode(frames))