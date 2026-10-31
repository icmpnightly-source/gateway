import L from 'leaflet';
import type { LatLngTuple } from 'leaflet';
import { hubWaypoints, leavesUzbekistan } from './uzbekistan';

// Straight-line (great-circle) distance in metres, not a road distance.
export function distanceBetween(a: LatLngTuple, b: LatLngTuple) {
  return L.latLng(a).distanceTo(b);
}

// Public OSRM demo server: driving routes over OpenStreetMap roads. It is
// rate-limited and has no uptime guarantee, so production should point at its
// own OSRM instance instead.
const OSRM_ROUTE_URL = 'https://router.project-osrm.org/route/v1/driving';

// How many alternatives to ask OSRM for on top of its main route. OSRM may
// return fewer when there are no reasonable detours.
const OSRM_ALTERNATIVES = 3;

export type Route = { positions: LatLngTuple[]; distance: number; duration: number };

export type RouteResult =
  | { status: 'found'; main: Route; alternatives: Route[] }
  // OSRM found routes, but every one of them crosses a border.
  | { status: 'outside' }
  | { status: 'failed' };

type OsrmResponse = {
  code: string;
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
};

// Plain fetch rather than the app's api client, which would attach the user's
// auth token to a third-party request. OSRM only offers alternatives for a
// route without intermediate waypoints.
async function fetchRoutes(waypoints: LatLngTuple[], signal: AbortSignal): Promise<Route[]> {
  // OSRM works in lng,lat order.
  const coordinates = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const alternatives = waypoints.length === 2 ? OSRM_ALTERNATIVES : 'false';
  const response = await fetch(
    `${OSRM_ROUTE_URL}/${coordinates}?overview=full&geometries=geojson&alternatives=${alternatives}`,
    { signal },
  );
  if (!response.ok) throw new Error(`OSRM request failed: ${response.status}`);

  const data = (await response.json()) as OsrmResponse;
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(`OSRM found no route: ${data.code}`);

  return data.routes.map((route) => ({
    positions: route.geometry.coordinates.map(([lng, lat]): LatLngTuple => [lat, lng]),
    distance: route.distance,
    duration: route.duration,
  }));
}

// OSRM cannot be told to stay inside a country, so drop the routes that cross
// a border and take the shortest remaining one; the others become
// alternatives.
function pickUzbekistanRoutes(routes: Route[]): RouteResult {
  const inside = routes.filter((route) => !leavesUzbekistan(route.positions)).sort((a, b) => a.distance - b.distance);
  if (!inside.length) return { status: 'outside' };
  const [main, ...alternatives] = inside;
  return { status: 'found', main, alternatives };
}

// When every route OSRM suggests crosses a border, ask again through the main
// road hubs between the two points, which keeps the route in the country.
export async function findUzbekistanRoute(from: LatLngTuple, to: LatLngTuple, signal: AbortSignal) {
  const direct = pickUzbekistanRoutes(await fetchRoutes([from, to], signal));
  if (direct.status === 'found') return direct;

  const hubs = hubWaypoints(from, to);
  if (!hubs.length) return direct;
  return pickUzbekistanRoutes(await fetchRoutes([from, ...hubs, to], signal));
}
