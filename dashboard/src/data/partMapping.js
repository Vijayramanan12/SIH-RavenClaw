// Maps each clickable item in the left ComponentPanel to the real glTF
// node names inside uav.glb. Matching is a case-insensitive substring
// test against each node's name.
//
// v2 model (inner-view cutaway): named parts are now the actual
// mechanical components (crankshaft, pistons, cam/valve train,
// carburetor, fuel/water pumps) rather than the outer CAD shell.
// `modeled: false` entries have no corresponding geometry in this glb —
// clicking them tells the user that instead of silently doing nothing.

export const PART_MAP = {
  engine: {
    label: 'Engine (full assembly)',
    keywords: [
      'ROTAX', 'CRANK', 'CAM', 'CYLINDER', 'PISTON', 'VALVE', 'CARB',
      'CHOKE', 'FLOAT', 'DIAPHRAGM', 'THROTTLE', 'FUEL', 'WATER',
      'PROP GEAR', 'ALTERNATER', 'AIR FILTER',
    ],
    modeled: true,
  },
  rpm: {
    label: 'Crankshaft, camshaft & prop gear',
    keywords: ['CRANK', 'CAM SHAFT', 'PROP GEAR'],
    modeled: true,
  },
  cht: {
    label: 'Cylinder heads',
    keywords: ['CYLINDER HEAD'],
    modeled: true,
  },
  egt: {
    label: 'Cylinders & exhaust valves',
    keywords: ['CYLINDER.', 'VALVE SMALL'],
    modeled: true,
  },
  oil: {
    label: 'Oil system',
    keywords: [],
    modeled: false,
  },
  vibration: {
    label: 'Engine mounts',
    keywords: [],
    modeled: false,
  },
  battery: { label: 'Battery pack', keywords: [], modeled: false },
  propulsion: { label: 'Propulsion / propeller', keywords: [], modeled: false },
  flightControl: { label: 'Flight controller', keywords: [], modeled: false },
  sensors: { label: 'GPS / sensors', keywords: [], modeled: false },
};

export function findMatchingMeshes(root, key) {
  const config = PART_MAP[key];
  if (!config || !config.keywords.length) return [];
  const upperKeywords = config.keywords.map((k) => k.toUpperCase());
  const matches = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const name = (obj.name || '').toUpperCase();
    if (upperKeywords.some((kw) => name.includes(kw))) {
      matches.push(obj);
    }
  });
  return matches;
}
