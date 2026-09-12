import { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, ContactShadows, Center } from '@react-three/drei';
import * as THREE from 'three';
import { findMatchingMeshes, PART_MAP } from '../data/partMapping';
import EngineRig from './EngineRig';

const MODEL_PATH = '/models/uav.glb';

// Gives every mesh its own material instance (glTF/drei cache and reuse
// materials across meshes that share one), so highlighting one part never
// bleeds onto another part that happened to share a material slot.
function useOwnMaterials(scene) {
  return useMemo(() => {
    const meshes = [];
    scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.material = obj.material.clone();
        // Keep the unselected engine opaque and depth-correct. Transparency
        // is enabled only while inspecting a selected part; leaving every
        // mesh transparent causes the cutaway's solid parts to bleed through.
        obj.material.transparent = false;
        obj.material.depthWrite = true;
        obj.userData.baseColor = obj.material.color.clone();
        obj.userData.baseEmissive = obj.material.emissive
          ? obj.material.emissive.clone()
          : new THREE.Color(0x000000);
        meshes.push(obj);
      }
    });
    return meshes;
  }, [scene]);
}

function HighlightController({ scene, allMeshes, selectedPart, accentColor }) {
  const matchedRef = useRef([]);

  useEffect(() => {
    matchedRef.current = selectedPart ? findMatchingMeshes(scene, selectedPart) : [];
  }, [scene, selectedPart]);

  useFrame((state) => {
    const hasSelection = matchedRef.current.length > 0;
    const pulse = (Math.sin(state.clock.elapsedTime * 4) + 1) / 2; // 0..1
    const accent = accentColor;

    for (const mesh of allMeshes) {
      const isMatched = matchedRef.current.includes(mesh);
      const mat = mesh.material;
      if (!mat) continue;

      // Force the highlighted part to draw last (on top of everything else
      // in the transparent pass) regardless of its distance from the
      // camera, so it can never get visually buried inside the chassis.
      mesh.renderOrder = isMatched ? 10 : 0;

      if (isMatched) {
        mat.transparent = true;
        mat.depthWrite = false;
        if (mat.emissive) {
          mat.emissive.copy(accent);
          mat.emissiveIntensity = 0.5 + pulse * 1.5;
        }
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, 1, 0.15);
      } else if (hasSelection) {
        mat.transparent = true;
        mat.depthWrite = false;
        // dim everything not part of the current selection so the
        // highlighted part visually pops out ("spotlight" effect)
        if (mat.emissive) {
          mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity ?? 0, 0, 0.2);
        }
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, 0.15, 0.15);
      } else {
        mat.transparent = false;
        mat.depthWrite = true;
        if (mat.emissive) {
          mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity ?? 0, 0, 0.2);
        }
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, 1, 0.15);
      }
    }
  });

  return null;
}

function CameraFocus({ scene, selectedPart, controlsRef }) {
  const targetPos = useRef(new THREE.Vector3());
  const hasTarget = useRef(false);

  useEffect(() => {
    if (!selectedPart) {
      hasTarget.current = false;
      return;
    }
    const matches = findMatchingMeshes(scene, selectedPart);
    if (!matches.length) {
      hasTarget.current = false;
      return;
    }
    const box = new THREE.Box3();
    matches.forEach((m) => box.expandByObject(m));
    box.getCenter(targetPos.current);
    hasTarget.current = true;
  }, [scene, selectedPart]);

  useFrame((state) => {
    if (!hasTarget.current || !controlsRef.current) return;
    controlsRef.current.target.lerp(targetPos.current, 0.06);
    controlsRef.current.update();
  });

  return null;
}

function UavModel({ selectedPart, accentColor, controlsRef, rpmRef }) {
  const { scene } = useGLTF(MODEL_PATH);
  const allMeshes = useOwnMaterials(scene);

  return (
    <Center>
      <primitive object={scene} />
      <HighlightController
        scene={scene}
        allMeshes={allMeshes}
        selectedPart={selectedPart}
        accentColor={accentColor}
      />
      <CameraFocus scene={scene} selectedPart={selectedPart} controlsRef={controlsRef} />
      <EngineRig scene={scene} rpmRef={rpmRef} />
    </Center>
  );
}

function RigCamera({ zoomed }) {
  useFrame((state) => {
    // The GLB is exported at a much larger scale than the old UAV model.
    // Start framed wide enough to see the complete engine; zoom is opt-in.
    const targetZ = zoomed ? 4.8 : 8.4;
    state.camera.position.z += (targetZ - state.camera.position.z) * 0.08;
    state.camera.updateProjectionMatrix();
  });
  return null;
}

function Loader() {
  return <div className="viewer-loading">LOADING DIGITAL TWIN…</div>;
}

const ACCENT = {
  HEALTHY: new THREE.Color('#3ddad2'),
  CAUTION: new THREE.Color('#ffb238'),
  CRITICAL: new THREE.Color('#ff4d4d'),
};

function DroneViewer({ healthStatus = 'HEALTHY', selectedPart = null, rpmRef }) {
  const [autoRotate, setAutoRotate] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const controlsRef = useRef();

  // Selection pauses auto-rotate so the highlighted/pulsing part is easy
  // to actually look at instead of spinning past.
  useEffect(() => {
    if (selectedPart) setAutoRotate(false);
  }, [selectedPart]);

  const partConfig = selectedPart ? PART_MAP[selectedPart] : null;
  const notModeled = partConfig && partConfig.modeled === false;
  const accent = ACCENT[healthStatus] ?? ACCENT.HEALTHY;
  const highlightColor = notModeled ? new THREE.Color('#ff4d4d') : new THREE.Color('#3ddad2');

  return (
    <div className="viewer-col">
      <div className="viewer-label">
        <div className="kicker">3D UAV</div>
        <div className="title">DIGITAL TWIN</div>
      </div>

      {partConfig && (
        <div className={`viewer-selection-banner ${notModeled ? 'warn' : ''}`}>
          {notModeled
            ? `${partConfig.label} — not included in this 3D model`
            : `Highlighting: ${partConfig.label}`}
        </div>
      )}

      <div className="viewer-crosshair">
        <span />
        <span />
        <span />
        <span />
      </div>

      <div className="viewer-canvas-wrap">
        <Suspense fallback={<Loader />}>
          <Canvas camera={{ position: [3.2, 1.6, 8.4], fov: 45 }} dpr={[1, 2]}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 8, 5]} intensity={1.4} color={accent} />
            <directionalLight position={[-5, -3, -5]} intensity={0.4} color="#3ddad2" />
            <Suspense fallback={null}>
              <UavModel
                selectedPart={selectedPart}
                accentColor={highlightColor}
                controlsRef={controlsRef}
                rpmRef={rpmRef}
              />
              <Environment preset="city" />
            </Suspense>
            <ContactShadows position={[0, -1.2, 0]} opacity={0.5} blur={2.5} far={4} />
            <RigCamera zoomed={zoomed} />
            <OrbitControls
              ref={controlsRef}
              autoRotate={autoRotate}
              autoRotateSpeed={0.7}
              enablePan={false}
              minDistance={3.5}
              maxDistance={14}
            />
          </Canvas>
        </Suspense>
      </div>

      <div className="viewer-controls">
        <button
          className={`viewer-btn ${autoRotate ? 'on' : ''}`}
          onClick={() => setAutoRotate((v) => !v)}
        >
          ↻ ROTATE
        </button>
        <button
          className={`viewer-btn ${zoomed ? 'on' : ''}`}
          onClick={() => setZoomed((v) => !v)}
        >
          🔍 ZOOM
        </button>
      </div>
    </div>
  );
}

useGLTF.preload(MODEL_PATH);

// Re-render when health status changes OR when the selected part changes --
// everything else in telemetry ticking should not touch this subtree.
// (rpmRef is intentionally excluded: it's a stable ref object whose
// .current mutates every tick without changing identity, which is what
// lets EngineRig animate every frame without forcing this component,
// or the rest of the dashboard, to re-render.)
export default memo(
  DroneViewer,
  (prev, next) => prev.healthStatus === next.healthStatus && prev.selectedPart === next.selectedPart
);
