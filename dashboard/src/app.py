"""Small Streamlit fallback for environments that do not run the React client."""

import os
from datetime import datetime

import requests
import streamlit as st

API_URL = os.getenv("TWIN_API_URL", "http://localhost:8001")


@st.cache_data(ttl=2)
def load_frame():
	response = requests.get(f"{API_URL}/telemetry/latest", timeout=2)
	response.raise_for_status()
	return response.json()


st.set_page_config(page_title="RavenClaw Engine Command", page_icon="RC", layout="wide")
st.title("RavenClaw / Engine Command")
st.caption(f"Twin API: {API_URL} | {datetime.now().strftime('%H:%M:%S')}")

try:
	frame = load_frame()
	sensors = frame.get("sensors", {})
	st.success(f"Unit {frame.get('unit_id', 1)} connected · cycle {frame.get('cycle', '--')} · {frame.get('phase', 'unknown')}")
	columns = st.columns(4)
	metrics = [("RPM", "rpm", "rev/min"), ("CHT", "cht_c", "°C"), ("EGT", "egt_c", "°C"), ("Oil pressure", "oil_press_psi", "psi")]
	for column, (label, key, unit) in zip(columns, metrics):
		column.metric(label, f"{sensors.get(key, 0):.1f} {unit}")
	st.subheader("Telemetry frame")
	st.json(frame)
except requests.RequestException as error:
	st.warning("Twin API is offline. Start it on port 8001 to view live telemetry.")
	st.code(str(error))