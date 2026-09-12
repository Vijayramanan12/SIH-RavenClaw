import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Procedural engine animation — this glb ships with zero baked animation
// clips, so every moving part here is driven live in Three.js from
// telemetry.engine.rpm. No pre-recorded loop: raise/lower RPM on the
// dashboard and crank/piston/valve speed follows in real time.

const pad3 = (n) => String(n).padStart(3, '0');

// Real Rotax 912 idles ~1800-2800rpm, which is far too fast to read
// visually on screen. Scale it down to a watchable rev/sec range while
// keeping motion strictly proportional to the live RPM value.
const VISUAL_RPM_SCALE = 0.05;

// Reciprocating parts: piston + its pin move together, phase-offset by
// cylinder so the four don't move in lockstep (visually reads as a
// running multi-cylinder engine rather than a single piston x4).
const PISTON_GROUPS = [0, 1, 2, 3].map((i) => ({
  names: i === 0 ? ['piston', 'piston pin'] : [`piston.${pad3(i)}`, `piston pin.${pad3(i)}`],
  phase: i * 90,
}));

// Poppet valves: "valve big" = intake x4, "valve small" = exhaust x4.
// Exhaust phase offset ~180° from intake as a plausible 4-stroke pattern.
const VALVE_GROUPS = [0, 1, 2, 3].flatMap((i) => [
  { names: [i === 0 ? 'valve big' : `valve big.${pad3(i)}`], phase: i * 90 },
  { names: [i === 0 ? 'valve small' : `valve small.${pad3(i)}`], phase: i * 90 + 180 },
]);

// Cam followers/lifters — 8 of them (one per valve). Paired to the same
// phase as their corresponding valve so the lifter and valve appear to
// move together.
const PUSHER_GROUPS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
  names: [i === 0 ? 'cam pusher' : `cam pusher.${pad3(i)}`],
  phase: (i % 4) * 90 + (i < 4 ? 0 : 180),
}));

// Continuously-rotating shafts/gears, each geared off the crank at a
// speed ratio (camshaft turns at half crank speed on a 4-stroke; the
// prop and accessory gears use their approximate reduction ratios).
const ROTATE_GROUPS = [
  { keyword: 'CRANK', ratio: 1 },
  { keyword: 'CAM SHAFT', ratio: 0.5 },
  { keyword: 'PROP GEAR', ratio: 0.42 },
  { keyword: 'FUEL PUMP GEAR', ratio: 0.5 },
  { keyword: 'FUEL IMPELLER', ratio: 0.5 },
  { keyword: 'WATER PUMP IMPELLER', ratio: 0.5 },
];

function getByExactNames(scene, names) {
  const set = new Set(names.map((n) => n.toLowerCase()));
  const found = [];
  scene.traverse((obj) => {
    if (obj.isMesh && set.has((obj.name || '').toLowerCase())) found.push(obj);
  });
  return found;
}

function getByKeyword(scene, keyword) {
  const kw = keyword.toUpperCase();
  const found = [];
  scene.traverse((obj) => {
    if (obj.isMesh && (obj.name || '').toUpperCase().includes(kw)) found.push(obj);
  });
  return found;
}

function DebugNames({ scene }) {
  useEffect(() => {
    const names = [];
    scene.traverse((obj) => {
      if (obj.isMesh) names.push(obj.name);
    });
    console.log('=== ALL MESH NAMES ===');
    console.table(names.sort());
    console.log('=== MATCHING MECHANICAL NAMES ===');
    console.table(names.filter((name) => /piston|crank|valve|cam|gear|prop|impeller|pusher|pin/i.test(name)).sort());
  }, [scene]);

  return null;
}

// Builds an invisible pivot Group at the world-space center of the given
// meshes, reparents them onto it (Object3D.attach preserves their visual
// position), and picks the cluster's longest bounding-box dimension as
// its world-aligned rotation/translation axis. This lets us animate
// arbitrary CAD parts around their real mechanical axis without any
// hand-authored rig or skeleton in the source file.
function buildRig(scene, meshes) {
  if (!meshes.length) return null;

  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  meshes.forEach((m) => box.expandByObject(m));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  let axis;
  if (size.x >= size.y && size.x >= size.z) axis = new THREE.Vector3(1, 0, 0);
  else if (size.y >= size.x && size.y >= size.z) axis = new THREE.Vector3(0, 1, 0);
  else axis = new THREE.Vector3(0, 0, 1);

  const rig = new THREE.Group();
  rig.position.copy(center);
  scene.add(rig);
  scene.updateMatrixWorld(true);
  meshes.forEach((m) => rig.attach(m));

  return { rig, axis, basePosition: center.clone(), axisSize: Math.max(size.x, size.y, size.z) };
}

export default function EngineRig({ scene, rpmRef }) {
  const rigsRef = useRef(null);
  const crankAngleRef = useRef(0);

  // Build once when the model loads — cheap traversal, done a single
  // time, not on every telemetry tick.
  useEffect(() => {
    const rotate = ROTATE_GROUPS
      .map((cfg) => {
        const built = buildRig(scene, getByKeyword(scene, cfg.keyword));
        return built && { ...built, ratio: cfg.ratio };
      })
      .filter(Boolean);

    const piston = PISTON_GROUPS
      .map((cfg) => {
        const built = buildRig(scene, getByExactNames(scene, cfg.names));
        return built && { ...built, phase: cfg.phase };
      })
      .filter(Boolean);

    const valve = [...VALVE_GROUPS, ...PUSHER_GROUPS]
      .map((cfg) => {
        const built = buildRig(scene, getByExactNames(scene, cfg.names));
        return built && { ...built, phase: cfg.phase };
      })
      .filter(Boolean);

    rigsRef.current = { rotate, piston, valve };
  }, [scene]);

  useFrame((state, delta) => {
    const rigs = rigsRef.current;
    if (!rigs) return;

    const rpm = rpmRef?.current ?? 0;
    const visualRevPerSec = (rpm * VISUAL_RPM_SCALE) / 60;
    const deltaAngle = visualRevPerSec * 2 * Math.PI * delta;
    crankAngleRef.current += deltaAngle;
    const crankAngle = crankAngleRef.current;
    const camAngleDeg = THREE.MathUtils.radToDeg(crankAngle / 2);

    // Crank, camshaft, prop gear, accessory gears — continuous spin,
    // speed directly proportional to live RPM.
    rigs.rotate.forEach(({ rig, axis, ratio }) => {
      rig.rotateOnWorldAxis(axis, deltaAngle * ratio);
    });

    // Pistons — reciprocate along their own long axis; faster RPM =
    // faster oscillation (this is the "piston speed increases" ask).
    rigs.piston.forEach(({ rig, axis, basePosition, axisSize, phase }) => {
      const amplitude = axisSize * 0.18;
      const offset = amplitude * Math.sin(crankAngle + THREE.MathUtils.degToRad(phase));
      rig.position.set(
        basePosition.x + axis.x * offset,
        basePosition.y + axis.y * offset,
        basePosition.z + axis.z * offset
      );
    });

    // Valves + lifters — brief lift pulse once per cam cycle rather than
    // a full sinusoid, approximating real valve-open dwell.
    rigs.valve.forEach(({ rig, axis, basePosition, axisSize, phase }) => {
      const amplitude = axisSize * 0.12;
      const angleRad = THREE.MathUtils.degToRad(camAngleDeg - phase);
      const lift = amplitude * Math.pow(Math.max(0, Math.cos(angleRad)), 8);
      rig.position.set(
        basePosition.x + axis.x * lift,
        basePosition.y + axis.y * lift,
        basePosition.z + axis.z * lift
      );
    });
  });

  return <DebugNames scene={scene} />;
}

