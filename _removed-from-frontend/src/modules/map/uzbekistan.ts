import L from 'leaflet';
import type { LatLngTuple } from 'leaflet';
import border from './data/uzbekistan.json';

// Uzbekistan's border as Leaflet polygons: each polygon is a list of rings,
// the first being the outline and the rest holes (enclaves of neighbours).
// The GeoJSON source stores points as [lng, lat].
export const UZBEKISTAN_POLYGONS: LatLngTuple[][][] = (border.coordinates as [number, number][][][]).map((polygon) =>
  polygon.map((ring) => ring.map(([lng, lat]): LatLngTuple => [lat, lng])),
);

const UZBEKISTAN_BOUNDS = L.latLngBounds(UZBEKISTAN_POLYGONS.flat(2));

// Ray casting: counts how many ring edges a ray from the point crosses.
function isInRing([lat, lng]: LatLngTuple, ring: LatLngTuple[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    if (latI > lat !== latJ > lat && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI) {
      inside = !inside;
    }
  }
  return inside;
}

export function isInUzbekistan(point: LatLngTuple) {
  if (!UZBEKISTAN_BOUNDS.contains(point)) return false;
  return UZBEKISTAN_POLYGONS.some(
    ([outline, ...holes]) => isInRing(point, outline) && !holes.some((hole) => isInRing(point, hole)),
  );
}

// Main road hubs and the highways between them that stay inside Uzbekistan
// (each edge was checked against OSRM). The shortest road between two places
// often cuts through a neighbour, e.g. the Fergana valley to Termez goes via
// Khujand and Dushanbe; routing through these hubs keeps it in the country.
const HUBS = {
  andijan: [40.7821, 72.3442],
  namangan: [40.9983, 71.6726],
  fergana: [40.3864, 71.7864],
  kokand: [40.5286, 70.9428],
  angren: [41.0167, 70.1436],
  tashkent: [41.3111, 69.2797],
  gulistan: [40.4897, 68.7842],
  jizzakh: [40.1158, 67.8422],
  samarkand: [39.6542, 66.9597],
  navoi: [40.0844, 65.3792],
  bukhara: [39.7747, 64.4286],
  karshi: [38.8606, 65.7847],
  shahrisabz: [39.0578, 66.8342],
  guzar: [38.6208, 66.2481],
  termez: [37.2242, 67.2783],
  denov: [38.2667, 67.8989],
  urgench: [41.55, 60.6333],
  nukus: [42.46, 59.6103],
} satisfies Record<string, LatLngTuple>;

type Hub = keyof typeof HUBS;

const HUB_EDGES: [Hub, Hub][] = [
  ['andijan', 'namangan'],
  ['andijan', 'fergana'],
  ['fergana', 'kokand'],
  ['namangan', 'kokand'],
  ['kokand', 'angren'],
  ['namangan', 'angren'],
  ['angren', 'tashkent'],
  ['angren', 'gulistan'],
  ['tashkent', 'gulistan'],
  ['gulistan', 'jizzakh'],
  ['jizzakh', 'samarkand'],
  ['samarkand', 'navoi'],
  ['navoi', 'bukhara'],
  ['bukhara', 'karshi'],
  ['samarkand', 'shahrisabz'],
  ['shahrisabz', 'guzar'],
  ['karshi', 'guzar'],
  ['guzar', 'termez'],
  ['termez', 'denov'],
  ['bukhara', 'urgench'],
  ['urgench', 'nukus'],
];

// A hub this close to the start or end adds nothing but a detour into its
// city centre, so it is left out of the waypoints.
const HUB_SKIP_METERS = 15000;

function distance(a: LatLngTuple, b: LatLngTuple) {
  return L.latLng(a).distanceTo(b);
}

function nearestHub(point: LatLngTuple): Hub {
  const hubs = Object.keys(HUBS) as Hub[];
  return hubs.reduce((best, hub) => (distance(point, HUBS[hub]) < distance(point, HUBS[best]) ? hub : best));
}

// Waypoints that lead from one point to another along the hub network
// (Dijkstra over straight-line edge lengths), without the start and end.
export function hubWaypoints(from: LatLngTuple, to: LatLngTuple): LatLngTuple[] {
  const start = nearestHub(from);
  const end = nearestHub(to);
  const dist = new Map<Hub, number>([[start, 0]]);
  const previous = new Map<Hub, Hub>();
  const unvisited = new Set(Object.keys(HUBS) as Hub[]);

  while (unvisited.size) {
    let current: Hub | undefined;
    for (const hub of unvisited) {
      if (dist.has(hub) && (current === undefined || dist.get(hub)! < dist.get(current)!)) current = hub;
    }
    if (current === undefined || current === end) break;
    unvisited.delete(current);

    for (const [a, b] of HUB_EDGES) {
      const next = a === current ? b : b === current ? a : undefined;
      if (!next || !unvisited.has(next)) continue;
      const candidate = dist.get(current)! + distance(HUBS[current], HUBS[next]);
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        previous.set(next, current);
      }
    }
  }

  const path: Hub[] = [end];
  while (path[0] !== start) {
    const before = previous.get(path[0]);
    if (!before) return [];
    path.unshift(before);
  }

  return path
    .map((hub) => HUBS[hub])
    .filter((hub) => distance(hub, from) > HUB_SKIP_METERS && distance(hub, to) > HUB_SKIP_METERS);
}

// The border is simplified, so a road running right along it can dip "out"
// for a short stretch. Only a longer stretch outside counts as leaving.
const BORDER_TOLERANCE_METERS = 2000;

// Testing every point of a long route against the border takes a noticeable
// fraction of a second, so only test points about this far apart. It is well
// under the tolerance, so a real crossing is still caught.
const CHECK_SPACING_METERS = 300;

export function leavesUzbekistan(path: LatLngTuple[]) {
  let outsideMeters = 0;
  let sinceCheckMeters = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) sinceCheckMeters += L.latLng(path[i - 1]).distanceTo(path[i]);
    const isCheckPoint = i === 0 || i === path.length - 1 || sinceCheckMeters >= CHECK_SPACING_METERS;
    if (!isCheckPoint) continue;

    outsideMeters = isInUzbekistan(path[i]) ? 0 : outsideMeters + sinceCheckMeters;
    if (outsideMeters > BORDER_TOLERANCE_METERS) return true;
    sinceCheckMeters = 0;
  }
  return false;
}
