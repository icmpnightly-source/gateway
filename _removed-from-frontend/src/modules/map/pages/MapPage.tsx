import { Button, Form, Input, Modal, Select, Tooltip, message, theme } from 'antd';
import { MapPinPlus, Ruler, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip as MapTooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { LatLngTuple } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { UZBEKISTAN_POLYGONS, isInUzbekistan } from '../uzbekistan';
import { distanceBetween, findUzbekistanRoute, type RouteResult } from '../routing';

// Leaflet resolves its default marker images from the CSS url, which breaks
// under Vite bundling, so point it at the imported assets explicitly.
const defaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Same pin, recoloured, for markers picked by the distance tool.
const measureIcon = L.icon({
  ...defaultIcon.options,
  className: 'hue-rotate-150 saturate-200',
});

// Tashkent
const DEFAULT_CENTER: LatLngTuple = [41.3111, 69.2797];
const DEFAULT_ZOOM = 12;

// Zoom used when a selected group has a single marker to fly to.
const GROUP_FOCUS_ZOOM = 15;

// Groups are numbered and shown as "N-guruh"; the list of groups is whatever
// numbers the markers use.
type Group = number;

type MapMarker = { group: Group; position: LatLngTuple };

const MARKERS: (MapMarker & { key: string })[] = [
  { key: 'defaultMarker', group: 1, position: DEFAULT_CENTER },
  { key: 'chorsu', group: 2, position: [41.3265, 69.2361] },
  { key: 'tvTower', group: 3, position: [41.3456, 69.2847] },
  { key: 'bukhara', group: 4, position: [39.7747, 64.4286] },
  { key: 'surkhandarya', group: 5, position: [37.2242, 67.2783] },
];

// Markers the user places with the add tool. Each one gets a new group of its
// own, optionally named by the user (otherwise shown as "N-guruh"). Names are
// free text rather than translation keys, and markers are kept in this
// browser only.
type CustomMarker = MapMarker & { id: string; name: string; groupName?: string };

type NewMarkerForm = { name: string; groupName?: string };

const CUSTOM_MARKERS_STORAGE_KEY = 'map.customMarkers';

function nextGroup(markers: MapMarker[]): Group {
  return Math.max(0, ...markers.map((marker) => marker.group)) + 1;
}

function loadCustomMarkers(): CustomMarker[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CUSTOM_MARKERS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];

    // Markers saved before groups were assigned automatically have none (or
    // an old string id); give each of them a new group of its own.
    const markers: CustomMarker[] = [];
    for (const marker of parsed as CustomMarker[]) {
      const group = typeof marker.group === 'number' ? marker.group : nextGroup([...MARKERS, ...markers]);
      markers.push({ ...marker, group });
    }
    return markers;
  } catch {
    return [];
  }
}

function saveCustomMarkers(markers: CustomMarker[]) {
  try {
    localStorage.setItem(CUSTOM_MARKERS_STORAGE_KEY, JSON.stringify(markers));
  } catch {
    // Storage can be unavailable (private mode, blocked site data); markers
    // then simply last until the page is reloaded.
  }
}

// Leaflet only measures its container on window resize, so layout changes
// like collapsing the sidebar leave grey, untiled areas. Watch the container
// itself and let Leaflet re-measure whenever its size changes.
function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

// Renders React content as a Leaflet control, so it sits in the map's own
// control corners next to the zoom buttons and clicks or scrolls on it do not
// reach the map (e.g. placing a marker under a button).
function MapControl({ position, children }: { position: L.ControlPosition; children: ReactNode }) {
  const map = useMap();
  const [container] = useState(() => {
    const element = L.DomUtil.create('div');
    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
    return element;
  });

  useEffect(() => {
    const control = new L.Control({ position });
    control.onAdd = () => container;
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, position, container]);

  return createPortal(children, container);
}

// Moves the map to the markers of the selected group: flies to a lone marker,
// or fits all of the group's markers into view when there are several.
function FlyToGroup({ group, markers }: { group?: Group; markers: MapMarker[] }) {
  const map = useMap();

  useEffect(() => {
    if (!group) return;
    const positions = markers.filter((marker) => marker.group === group).map((marker) => marker.position);
    if (positions.length === 1) {
      map.flyTo(positions[0], GROUP_FOCUS_ZOOM);
    } else if (positions.length > 1) {
      map.flyToBounds(L.latLngBounds(positions), { padding: [40, 40] });
    }
    // Only a new selection should move the map, not adding a marker to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, map]);

  return null;
}

// While the add tool is active, shows a crosshair cursor and reports where
// the user clicks on the map.
function AddMarkerOnClick({ active, onPick }: { active: boolean; onPick: (position: LatLngTuple) => void }) {
  const map = useMapEvents({
    click(event) {
      if (active) onPick([event.latlng.lat, event.latlng.lng]);
    },
  });

  useEffect(() => {
    const container = map.getContainer();
    container.style.cursor = active ? 'crosshair' : '';
    return () => {
      container.style.cursor = '';
    };
  }, [active, map]);

  return null;
}

// crypto.randomUUID() only exists in secure contexts, so it is missing when
// the dev server is opened by its network IP; the id only has to be unique
// within this browser's saved markers.
function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatPosition([lat, lng]: LatLngTuple) {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Brings a freshly calculated route fully into view.
function FitRoute({ positions }: { positions: LatLngTuple[] }) {
  const map = useMap();

  useEffect(() => {
    map.flyToBounds(L.latLngBounds(positions), { padding: [60, 60] });
  }, [positions, map]);

  return null;
}

export function MapPage() {
  const { t } = useTranslation();
  const [selectedGroup, setSelectedGroup] = useState<Group>();
  const [customMarkers, setCustomMarkers] = useState<CustomMarker[]>(loadCustomMarkers);
  const [isAdding, setIsAdding] = useState(false);
  const [pendingPosition, setPendingPosition] = useState<LatLngTuple>();
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureIds, setMeasureIds] = useState<string[]>([]);
  const [form] = Form.useForm<NewMarkerForm>();
  const { token } = theme.useToken();
  const [messageApi, messageContextHolder] = message.useMessage();

  const allMarkers: MapMarker[] = [...MARKERS, ...customMarkers];
  const newGroup = nextGroup(allMarkers);
  const groupLabel = (group: Group) =>
    customMarkers.find((marker) => marker.group === group)?.groupName || t('map.groupName', { number: group });
  const groupOptions = [...new Set(allMarkers.map((marker) => marker.group))]
    .sort((a, b) => a - b)
    .map((group) => ({ value: group, label: groupLabel(group) }));

  // Built-in and user markers in one list, so the map and the distance tool
  // can treat them alike. Built-in markers use their translation key as id.
  const markerItems = [
    ...MARKERS.map(({ key, group, position }) => ({
      id: key,
      name: t(`map.markers.${key}`),
      group,
      position,
      deletable: false,
    })),
    ...customMarkers.map(({ id, name, group, position }) => ({ id, name, group, position, deletable: true })),
  ];
  const measured = markerItems.filter((marker) => measureIds.includes(marker.id));
  const distance = measured.length === 2 ? distanceBetween(measured[0].position, measured[1].position) : undefined;

  // Road route for the picked pair. The result remembers which pair it was
  // for, so a stale answer is ignored and "loading" needs no extra state.
  const pairKey = measured.length === 2 ? JSON.stringify([measured[0].position, measured[1].position]) : undefined;
  const [routeResult, setRouteResult] = useState<{ pairKey: string; result: RouteResult }>();

  useEffect(() => {
    if (!pairKey) return;
    const [from, to] = JSON.parse(pairKey) as [LatLngTuple, LatLngTuple];
    const controller = new AbortController();
    findUzbekistanRoute(from, to, controller.signal)
      .then((result) => setRouteResult({ pairKey, result }))
      .catch(() => {
        if (!controller.signal.aborted) setRouteResult({ pairKey, result: { status: 'failed' } });
      });
    return () => controller.abort();
  }, [pairKey]);

  const currentResult = routeResult && routeResult.pairKey === pairKey ? routeResult.result : undefined;
  const route = currentResult?.status === 'found' ? currentResult.main : undefined;
  const alternativeRoutes = currentResult?.status === 'found' ? currentResult.alternatives : [];
  const isRouteLoading = !!pairKey && !currentResult;

  const formatDistance = (meters: number) =>
    meters < 1000
      ? t('map.distanceM', { value: Math.round(meters) })
      : t('map.distanceKm', { value: (meters / 1000).toFixed(2) });

  const formatDuration = (seconds: number) => {
    const totalMinutes = Math.max(1, Math.round(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? t('map.durationHours', { hours, minutes }) : t('map.durationMinutes', { minutes });
  };

  const measureResult = () => {
    if (distance === undefined) return t('map.measureHint');
    const straight = formatDistance(distance);
    let result: string;
    if (isRouteLoading) {
      result = t('map.routeLoading', { straight });
    } else if (route) {
      result = t('map.routeSummary', {
        distance: formatDistance(route.distance),
        duration: formatDuration(route.duration),
        straight,
      });
      if (alternativeRoutes.length) {
        const list = alternativeRoutes.map((alternative) => formatDistance(alternative.distance)).join(', ');
        result += `; ${t('map.routeAlternatives', { list })}`;
      }
    } else if (currentResult?.status === 'outside') {
      result = t('map.routeOutside', { straight });
    } else {
      result = t('map.routeFailed', { straight });
    }
    return `${measured[0].name} — ${measured[1].name}: ${result}`;
  };

  const toggleAdding = () => {
    setIsAdding(!isAdding);
    setIsMeasuring(false);
    setMeasureIds([]);
  };

  const toggleMeasuring = () => {
    setIsMeasuring(!isMeasuring);
    setMeasureIds([]);
    setIsAdding(false);
  };

  // Clicking a picked marker unpicks it; picking a third starts a new pair.
  const handleMapPick = (position: LatLngTuple) => {
    if (isInUzbekistan(position)) {
      setPendingPosition(position);
    } else {
      messageApi.warning(t('map.outsideUzbekistan'));
    }
  };

  const handleMeasurePick = (id: string) => {
    setMeasureIds((ids) => {
      if (ids.includes(id)) return ids.filter((pickedId) => pickedId !== id);
      return ids.length >= 2 ? [id] : [...ids, id];
    });
  };

  const updateCustomMarkers = (markers: CustomMarker[]) => {
    setCustomMarkers(markers);
    saveCustomMarkers(markers);
  };

  const handleDeleteMarker = (id: string) => {
    const markers = customMarkers.filter((marker) => marker.id !== id);
    updateCustomMarkers(markers);
    // The marker's group disappears with it, so drop it from the selection too.
    if (selectedGroup !== undefined && ![...MARKERS, ...markers].some((marker) => marker.group === selectedGroup)) {
      setSelectedGroup(undefined);
    }
  };

  const handleAddMarker = ({ name, groupName }: NewMarkerForm) => {
    if (!pendingPosition) return;
    updateCustomMarkers([
      ...customMarkers,
      {
        id: createId(),
        name: name.trim(),
        group: newGroup,
        groupName: groupName?.trim() || undefined,
        position: pendingPosition,
      },
    ]);
    setPendingPosition(undefined);
  };

  return (
    <div className="h-full">
      {messageContextHolder}
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
        className="isolate h-full min-h-[400px] w-full"
      >
        <MapResizeHandler />
        <MapControl position="topright">
          {/* See-through so the map shows beneath; fully opaque while in use. */}
          <div className="flex gap-(--c-spacing-xs) opacity-80 transition-opacity hover:opacity-100 focus-within:opacity-100">
            <Tooltip title={t('map.addMarkerHint')} open={isAdding && !pendingPosition} placement="bottom">
              <Button
                type={isAdding ? 'primary' : 'default'}
                icon={<MapPinPlus size={16} />}
                onClick={toggleAdding}
                className="shadow-(--c-box-shadow-card)"
              >
              
              </Button>
            </Tooltip>
            <Tooltip
              title={measureResult()}
              open={isMeasuring}
              placement="bottom"
            >
              <Button
                type={isMeasuring ? 'primary' : 'default'}
                icon={<Ruler size={16} />}
                onClick={toggleMeasuring}
                className="shadow-(--c-box-shadow-card)"
              >
               
              </Button>
            </Tooltip>
            <Select
              allowClear
              value={selectedGroup}
              onChange={setSelectedGroup}
              placeholder={t('map.selectGroup')}
              options={groupOptions}
              className="w-48 shadow-(--c-box-shadow-card)"
            />
          </div>
        </MapControl>
        <FlyToGroup group={selectedGroup} markers={allMarkers} />
        <AddMarkerOnClick active={isAdding} onPick={handleMapPick} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {/* Outlines Uzbekistan's border. */}
        <Polygon
          positions={UZBEKISTAN_POLYGONS}
          interactive={false}
          pathOptions={{ color: token.colorPrimary, weight: 2, fill: false }}
        />
        {markerItems.map(({ id, name, group, position, deletable }) => (
          <Marker
            key={id}
            position={position}
            icon={measureIds.includes(id) ? measureIcon : defaultIcon}
            // While measuring, a click picks the marker instead of opening its popup.
            eventHandlers={{ click: () => isMeasuring && handleMeasurePick(id) }}
          >
            {!isMeasuring && (
              <Popup>
                <div className="font-semibold">{name}</div>
                <div>
                  {t('map.group')}: {groupLabel(group)}
                </div>
                <div className="text-subtle">{formatPosition(position)}</div>
                {deletable && (
                  <Button
                    danger
                    size="small"
                    type="text"
                    icon={<Trash2 size={14} />}
                    onClick={() => handleDeleteMarker(id)}
                    className="mt-(--c-spacing-xxs) px-0!"
                  >
                    {t('map.deleteMarker')}
                  </Button>
                )}
              </Popup>
            )}
          </Marker>
        ))}
        {distance !== undefined && (
          // The straight line stays as a faint reference once the road route
          // is shown, and carries the label while there is no route.
          <Polyline
            positions={[measured[0].position, measured[1].position]}
            pathOptions={{
              color: route ? token.colorTextTertiary : token.colorPrimary,
              weight: route ? 2 : 3,
              dashArray: '8 8',
            }}
          >
            {!route && (
              <MapTooltip permanent direction="center">
                {formatDistance(distance)}
              </MapTooltip>
            )}
          </Polyline>
        )}
        {alternativeRoutes.map((alternative, index) => (
          <Polyline
            key={index}
            positions={alternative.positions}
            pathOptions={{ color: token.colorPrimary, weight: 5, opacity: 0.3 }}
          >
            <MapTooltip sticky>
              {t('map.alternativeRoute')}: {formatDistance(alternative.distance)} ·{' '}
              {formatDuration(alternative.duration)}
            </MapTooltip>
          </Polyline>
        ))}
        {route && (
          <>
            <Polyline positions={route.positions} pathOptions={{ color: token.colorPrimary, weight: 5, opacity: 0.85 }}>
              <MapTooltip permanent direction="center">
                {formatDistance(route.distance)} · {formatDuration(route.duration)}
              </MapTooltip>
            </Polyline>
            <FitRoute positions={route.positions} />
          </>
        )}
      </MapContainer>

      <Modal
        title={t('map.newMarker')}
        open={!!pendingPosition}
        okText={t('map.save')}
        cancelText={t('map.cancel')}
        onOk={() => form.submit()}
        onCancel={() => setPendingPosition(undefined)}
        afterClose={() => form.resetFields()}
      >
        {pendingPosition && <div className="mb-(--c-spacing-sm) text-subtle">{formatPosition(pendingPosition)}</div>}
        <Form form={form} layout="vertical" onFinish={handleAddMarker}>
          <Form.Item
            name="name"
            label={t('map.markerName')}
            rules={[{ required: true, whitespace: true, message: t('map.markerNameRequired') }]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="groupName" label={t('map.groupNameLabel')}>
            <Input placeholder={t('map.groupName', { number: newGroup })} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
