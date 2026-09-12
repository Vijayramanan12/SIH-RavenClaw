# UAV Digital Twin Dashboard — SIH 2026, PS 54

A real-time UAV health-monitoring dashboard: engine/battery telemetry, an
AI health score with RUL/confidence, fault alerts, live battery-% and
engine/battery trend graphs, and an interactive 3D digital twin rendered
from `uav.glb`.

## Run it

```bash
cd uav-dashboard
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│  HEADER: brand · live socket · UAV id · mission badge          │
├───────────────┬──────────────────────────┬─────────────────────┤
│ COMPONENT      │                          │ AI HEALTH SCORE      │
│ PANEL          │      3D DIGITAL TWIN     │ FAULT ALERTS         │
│ (engine/batt/  │      (uav.glb)           │ LIVE TELEMETRY        │
│ propulsion/    │                          │  - battery % (bar)    │
│ flight ctrl/   │                          │  - altitude/speed/    │
│ sensors)       │                          │    heading/dist-RTL   │
├───────────────┴──────────────────────────┴─────────────────────┤
│  MISSION STATUS strip: phase · mission time · link              │
├───────────────────────────────┬──────────────────────────────────┤
│  ENGINE TREND (RPM/EGT/CHT)    │  BATTERY TREND (Voltage/Current)   │
└───────────────────────────────┴──────────────────────────────────┘
```

- **Battery %** is shown as a live bar chart (`TelemetryCards.jsx`,
  right column bottom) rather than a plain number, colored green → amber →
  red as the pack drains.
- **Live telemetry** (altitude, speed, heading, distance-to-RTL) sits in
  the bottom of the right column, not the footer — the footer is reserved
  for the two live graphs.
- **Two live graphs** at the bottom: Engine trend (RPM/EGT/CHT) and
  Battery trend (Voltage/Current), sharing one reusable `TrendChart`
  component so adding a third graph later is a one-line change in
  `Dashboard.jsx`.

## Live telemetry vs. simulated demo mode

By default the dashboard streams **simulated telemetry** (see
`src/data/demoTelemetry.js`) so it's fully demoable without any backend.

To wire it to a real ground-control WebSocket feed, set an env var:

```bash
# .env
VITE_TELEMETRY_WS=ws://localhost:8765/uav-01
```

`src/hooks/useTelemetrySocket.js` connects to it, expecting JSON frames
shaped like `initialTelemetry` in `demoTelemetry.js` — battery `voltage`
and `current` now also feed the Battery Trend graph automatically.

If the socket drops or was never configured, the dashboard falls back to
simulated frames so the UI never goes blank mid-demo.

## About the uav.glb model — what it actually contains

Inspecting the uploaded file: it's a **Rotax 912 engine assembly**, not a
full UAV airframe — 109 named CAD parts (cylinders, carburetors, water
lines, crankcase, chassis mounts), no animations, no propeller, no
fuselage/wings, no battery pack, no flight-controller box, no landing
gear, no antennas/sensors.

That's fine for an "engine digital twin" close-up (which is most of what
this dashboard actually monitors — RPM/CHT/EGT/oil/vibration), but if you
want the center viewer to show the **whole UAV**, you'll need to add:

- Fuselage / wing shell
- Propeller — as its **own separate node** in the glTF, so it can be
  spun live in Three.js tied to the RPM reading (the current model has
  zero animation clips, so this has to be a distinct mesh you rotate
  programmatically, not baked into the file)
- Battery pack housing
- Flight-controller / avionics enclosure
- Landing gear
- GPS/telemetry antenna (cosmetic, ties to the GPS LOCKED indicator)

These can be one combined glb (easiest to load) or separate glb files per
subsystem if you want to swap/hide parts independently later.

**Also worth doing regardless:** the engine file is 16MB across 109
meshes, which is heavy for a live dashboard. Before the final demo, run
it through `gltf-transform` (Draco or meshopt compression) to cut load
time — something like:

```bash
npx @gltf-transform/cli optimize public/models/uav.glb public/models/uav.glb --compress draco
```

## Performance notes (this pass)

- 3D viewer is **code-split** (`React.lazy`) so the three.js/drei bundle
  and the glTF download don't block the rest of the dashboard from
  painting.
- `DroneViewer` is memoized to only re-render on health-status *band*
  changes (HEALTHY/CAUTION/CRITICAL), not on every telemetry tick — it's
  the most expensive thing on the page.
- `ComponentPanel`, `HealthScore`, `AlertPanel`, `TelemetryCards`, and the
  chart component are all `React.memo`'d.
- Chart line animation is disabled (`isAnimationActive={false}`) since
  data already updates every tick — animating on top of that just burns
  frames without adding information.

## Structure

```
src/
├── components/   Header, ComponentPanel, DroneViewer, HealthScore,
│                 AlertPanel, TelemetryCards (live telemetry + batt bar),
│                 MissionStatus, TrendChart (generic, reused for both graphs)
├── data/         demoTelemetry.js — seed state + simulator + thresholds
├── hooks/        useTelemetrySocket.js — live socket w/ simulated fallback
└── pages/        Dashboard.jsx — assembles the layout
```

## Next steps

- Threshold colors (green/amber/red) for CHT, EGT, oil pressure, vibration
  and battery are centralized in `THRESHOLDS` (`demoTelemetry.js`) — tune
  to your actual airframe's flight manual limits.
- AI health score, RUL and confidence are currently derived by the
  simulator; swap in your trained model's output by having the backend
  push those fields over the socket instead.

## Engine animation (procedural, RPM-driven)

The uploaded `uav.glb` is now an inner-view cutaway with real moving
parts (crankshaft, 4 pistons, camshaft + 8 valve lifters, 8 poppet
valves, prop reduction gear, fuel pump gear/impeller, water pump
impeller) — but it ships with **zero baked animation clips**. Instead of
requiring a re-authored/rigged glb, `src/components/EngineRig.jsx`
animates everything live in Three.js, driven directly by
`telemetry.engine.rpm`:

- **How it finds the parts**: on model load it does a one-time scene
  traversal, groups meshes by name (e.g. all `crank*`/`crankshaft*`
  meshes together, each `piston`/`piston pin` pair together, etc.),
  computes each group's world-space bounding box, and picks the
  longest bounding-box dimension as that group's rotation/translation
  axis. This works without any hand-placed pivot points in the source
  file.
- **How it moves**: an invisible pivot `Group` is created at each
  cluster's center and the real meshes are reparented onto it with
  `Object3D.attach()` (preserves their visual position exactly). Every
  frame, `EngineRig` rotates/translates these pivot groups — crank,
  camshaft and gears spin continuously; pistons reciprocate
  sinusoidally along their axis; valves and lifters get a brief lift
  pulse timed to the camshaft angle.
- **Speed is live, not looped**: RPM is read from a `ref`
  (`rpmRef.current`) every animation frame, not a prop, specifically so
  raising/lowering RPM on the dashboard changes crank/piston/valve
  speed in real time without re-rendering the rest of the app 60 times
  a second. Real Rotax RPM (1800–2800) is scaled down
  (`VISUAL_RPM_SCALE` in `EngineRig.jsx`) to a watchable rev/sec range
  — it's still strictly proportional to the live value, just not
  1:1 real-time, since actual RPM would spin too fast to see.

**Tuning it**: `EngineRig.jsx` has three config arrays at the top —
`PISTON_GROUPS`, `VALVE_GROUPS`/`PUSHER_GROUPS`, `ROTATE_GROUPS` — each
just a list of `{ names/keyword, phase/ratio }`. Add a part by adding
one entry; no other code changes needed as long as the part's mesh
name is unique enough to match cleanly.

## Highlight mapping updated for the new model

Since this glb's node names are completely different from the previous
outer-shell version (English component names now: `crank`, `piston`,
`cylinder head`, `valve big/small`, etc. instead of French CAD names),
`src/data/partMapping.js` was remapped:

| Left-panel item | Highlights |
|---|---|
| ENGINE | whole assembly |
| RPM | crank, camshaft, prop gear |
| CHT | cylinder heads |
| EGT | cylinders + exhaust valves |
| Oil, Vibration | **not in this model** — no oil pump/filter or engine-mount hardware is present in this cutaway export; clicking them shows the "not included" banner rather than highlighting nothing silently |
| Battery, Propulsion, Flight Control, Sensors | still not modeled (unchanged from before) |

If you get a version with oil-system or mount geometry, add matching
keywords to `oil`/`vibration` in `partMapping.js` and set
`modeled: true` — highlighting will work immediately, no other changes
needed.
