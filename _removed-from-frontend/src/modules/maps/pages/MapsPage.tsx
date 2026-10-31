import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, Empty, Form, Input, Modal, Select, Tooltip, theme } from 'antd';
import { MapPinPlus, Ruler, Trash2 } from 'lucide-react';
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
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import { UZBEKISTAN_POLYGONS } from '@/modules/map/uzbekistan';
import { distanceBetween, findUzbekistanRoute, type RouteResult } from '@/modules/map/routing';
import { useAppSelector } from '@/store';
import { DEFAULT_GROUP_COLOR, getGroupIcon } from '@/modules/groups/constants/groupIcons';
import type { Group } from '@/types/group.types';

const MARKER_COLORS = ['#2a81cb', '#cb2b3e', '#ea8a1e', '#2aad27', '#9c2bcb', '#5b6b7c'];

const DEFAULT_COLOR = MARKER_COLORS[0];

// Marks the pair picked for measuring, whatever colour they were given.
const MEASURE_COLOR = '#9c2bcb';

// Markers are drawn as the bare group icon: no pin, no plate behind it.
const GLYPH_SIZE = 28;

// Leaflet resolves its default marker images from the CSS url, which breaks
// under Vite bundling, so point it at the imported asset explicitly.
// Leaflet's own marker is 25x41; this keeps its proportions, a little smaller.
const PIN_SIZE: [number, number] = [19, 31];

// Leaflet ships a single blue marker image, so other colours are produced by
// hue-rotating it away from that blue. The result is close to the picked
// colour rather than an exact match.
const MARKER_BLUE_HUE = 205;

function hueOf(hex: string) {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  if (span === 0) return { hue: MARKER_BLUE_HUE, flat: true };

  let hue: number;
  if (max === r) hue = ((g - b) / span) % 6;
  else if (max === g) hue = (b - r) / span + 2;
  else hue = (r - g) / span + 4;

  return { hue: (hue * 60 + 360) % 360, flat: span < 0.15 };
}

const pinCache = new Map<string, L.DivIcon>();

// Leaflet's own pin, worn by markers that belong to no group.
function defaultPinIcon(color: string = DEFAULT_COLOR) {
  const cached = pinCache.get(color);
  if (cached) return cached;

  const { hue, flat } = hueOf(color);
  const filter = flat
    ? 'grayscale(1) brightness(0.8)'
    : `hue-rotate(${Math.round(hue - MARKER_BLUE_HUE)}deg)`;

  const divIcon = L.divIcon({
    // Width and height go in the style so Tailwind's `img { height: auto }`
    // cannot stretch the marker past the size Leaflet positions it by.
    html: `<img src="${markerIcon2x}" alt="" style="width:${PIN_SIZE[0]}px;height:${PIN_SIZE[1]}px;filter:${filter} drop-shadow(0 1px 2px rgb(0 0 0 / 0.4))">`,
    className: 'border-none! bg-transparent!',
    iconSize: PIN_SIZE,
    // The tip of the marker, and the point popups and labels hang off.
    iconAnchor: [PIN_SIZE[0] / 2, PIN_SIZE[1]],
    popupAnchor: [0, -PIN_SIZE[1]],
    tooltipAnchor: [0, -PIN_SIZE[1]],
  });

  pinCache.set(color, divIcon);
  return divIcon;
}

const iconCache = new Map<string, L.DivIcon>();

function groupMarkerIcon(color: string, icon?: string) {
  const key = `${color}|${icon ?? ''}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const Icon = getGroupIcon(icon);
  // Lucide icons are outlines, so filling them with the colour and drawing the
  // strokes in white turns the glyph into a solid, readable shape.
  const glyph = renderToStaticMarkup(
    <Icon
      size={GLYPH_SIZE}
      fill={color}
      color="#fff"
      strokeWidth={1.6}
      absoluteStrokeWidth
      style={{ filter: 'drop-shadow(0 0 1.5px rgb(255 255 255 / 0.9)) drop-shadow(0 1px 2px rgb(0 0 0 / 0.4))' }}
    />,
  );

  const divIcon = L.divIcon({
    html: glyph,
    className: 'border-none! bg-transparent!',
    iconSize: [GLYPH_SIZE, GLYPH_SIZE],
    // Centred on the spot it marks, with labels and popups above it.
    iconAnchor: [GLYPH_SIZE / 2, GLYPH_SIZE / 2],
    popupAnchor: [0, -GLYPH_SIZE / 2],
    tooltipAnchor: [0, -GLYPH_SIZE / 2],
  });

  iconCache.set(key, divIcon);
  return divIcon;
}

// Grouped markers wear the group icon; the rest keep Leaflet's own pin.
function iconForMarker(marker: PlacedMarker, group: Group | undefined, measuring: boolean) {
  const color = measuring ? MEASURE_COLOR : marker.color;
  return group ? groupMarkerIcon(color, group.icon) : defaultPinIcon(color);
}

// Tashkent
const DEFAULT_CENTER: LatLngTuple = [41.3111, 69.2797];
const DEFAULT_ZOOM = 12;

// Zoom used when the picked group has a single marker to fly to.
const GROUP_FOCUS_ZOOM = 15;

type PlacedMarker = {
  id: string;
  title: string;
  groupId?: string;
  color: string;
  position: LatLngTuple;
};

type MarkerForm = { title: string; groupId?: string; color: string };

const MARKERS_STORAGE_KEY = 'maps.markers';

function loadMarkers(): PlacedMarker[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MARKERS_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as PlacedMarker[]) : [];
  } catch {
    return [];
  }
}

function saveMarkers(markers: PlacedMarker[]) {
  try {
    localStorage.setItem(MARKERS_STORAGE_KEY, JSON.stringify(markers));
  } catch {
    // Storage can be unavailable (private mode, blocked site data); markers
    // then simply last until the page is reloaded.
  }
}

function formatPosition([lat, lng]: LatLngTuple) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// crypto.randomUUID() only exists in secure contexts, so it is missing when
// the dev server is opened by its network IP; the id only has to be unique
// within this page's markers.
function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// The sidebar collapsing resizes the content area without a window resize
// event, which would leave Leaflet rendering grey tiles.
function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

// Renders React children inside a real Leaflet control, so the button sits on
// the map and its clicks never reach the map underneath.
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

// On the first render the view is framed around the saved markers, so they
// are all in sight instead of hiding outside the default Tashkent view.
// Bumping `token` frames them again, which is how the page returns to its
// opening view after a filter is dropped.
function FitSavedMarkers({ markers, token = 0 }: { markers: PlacedMarker[]; token?: number }) {
  const map = useMap();
  const markersRef = useRef(markers);
  markersRef.current = markers;

  useEffect(() => {
    const positions = markersRef.current.map((marker) => marker.position);
    if (positions.length === 0) return;

    if (positions.length === 1) {
      map.setView(positions[0], GROUP_FOCUS_ZOOM);
    } else {
      map.fitBounds(L.latLngBounds(positions), { padding: [48, 48] });
    }
  }, [map, token]);

  return null;
}

// Moves the map to the picked group: flies to a lone marker, or fits all of
// the group's markers into view when there are several.
function FlyToGroup({ groupId, markers }: { groupId?: string; markers: PlacedMarker[] }) {
  const map = useMap();

  // Read through a ref so the move happens when the group changes, not every
  // time one of its markers is edited.
  const positions = markers.filter((marker) => marker.groupId === groupId).map((marker) => marker.position);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  useEffect(() => {
    if (!groupId) return;

    const current = positionsRef.current;
    if (current.length === 0) return;

    if (current.length === 1) {
      map.flyTo(current[0], GROUP_FOCUS_ZOOM);
    } else {
      map.flyToBounds(L.latLngBounds(current), { padding: [48, 48] });
    }
  }, [groupId, map]);

  return null;
}

// Form.Item hands a control its value and onChange; this one is just a row of
// swatches, so the choice stays visible without opening a picker.
function ColorChoice({ value, onChange }: { value?: string; onChange?: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-(--c-spacing-xs)">
      {MARKER_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          aria-pressed={value === color}
          onClick={() => onChange?.(color)}
          style={{ background: color }}
          className={`size-7 rounded-full transition-transform ${
            value === color ? 'ring-2 ring-offset-2 ring-(--c-color-text) scale-110' : 'hover:scale-110'
          }`}
        />
      ))}
    </div>
  );
}

// Brings a freshly calculated route fully into view.
function FitRoute({ positions }: { positions: LatLngTuple[] }) {
  const map = useMap();

  useEffect(() => {
    map.flyToBounds(L.latLngBounds(positions), { padding: [60, 60] });
  }, [positions, map]);

  return null;
}

// Only picks a spot while the add tool is on, and shows a crosshair meanwhile.
function AddMarkerOnClick({ active, onPick }: { active: boolean; onPick: (position: LatLngTuple) => void }) {
  const map = useMapEvents({
    click: (event) => {
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

export function MapsPage() {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [form] = Form.useForm<MarkerForm>();
  const groups = useAppSelector((state) => state.groups.items);

  const [markers, setMarkers] = useState<PlacedMarker[]>(loadMarkers);
  const [isAdding, setIsAdding] = useState(false);
  // Ids of the markers picked for the distance tool; two of them measure.
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureIds, setMeasureIds] = useState<string[]>([]);
  // Undefined shows every marker; otherwise only the picked group's.
  const [filterGroup, setFilterGroup] = useState<string>();
  // Bumped to frame every marker again once a filter is gone.
  const [fitToken, setFitToken] = useState(0);
  // The spot waiting for a title; the modal is open while it is set.
  const [pendingPosition, setPendingPosition] = useState<LatLngTuple>();
  // Set once the colour is chosen by hand, so the group stops overriding it.
  const colorPickedRef = useRef(false);
  // A group deleted from the groups section leaves the filter pointing at
  // nothing, which would hide every marker; fall back to showing them all.
  useEffect(() => {
    if (filterGroup && !groups.some((group) => group.id === filterGroup)) {
      setFilterGroup(undefined);
      setFitToken((current) => current + 1);
    }
  }, [filterGroup, groups]);

  // Markers outlive leaving the page, so they are mirrored into storage.
  useEffect(() => {
    saveMarkers(markers);
  }, [markers]);

  const groupOptions = groups.map((group) => ({ value: group.id, label: group.name }));
  const groupById = new Map(groups.map((group) => [group.id, group]));

  // Shown in every group dropdown so the icon is recognisable off the map too.
  const renderGroupItem = (id?: string | number | null) => {
    const group = typeof id === 'string' ? groupById.get(id) : undefined;
    if (!group) return null;

    const Icon = getGroupIcon(group.icon);
    return (
      <span className="flex items-center gap-(--c-spacing-xxs)">
        <Icon size={14} color={group.color ?? DEFAULT_GROUP_COLOR} />
        {group.name}
      </span>
    );
  };

  // Shared by the filter, the popup and the new-marker form.
  const groupSelectProps = {
    options: groupOptions,
    optionRender: (option: { value?: string | number | null }) => renderGroupItem(option.value),
    labelRender: (props: { value: string | number }) => renderGroupItem(props.value),
    notFoundContent: <Empty description={t('maps.noGroups')} image={Empty.PRESENTED_IMAGE_SIMPLE} />,
  };

  const visibleMarkers = filterGroup ? markers.filter((marker) => marker.groupId === filterGroup) : markers;

  const measured = markers.filter((marker) => measureIds.includes(marker.id));
  const straightDistance =
    measured.length === 2 ? distanceBetween(measured[0].position, measured[1].position) : undefined;

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

  const formatDistance = (meters: number) =>
    meters < 1000
      ? t('maps.distanceM', { value: Math.round(meters) })
      : t('maps.distanceKm', { value: (meters / 1000).toFixed(2) });

  const formatDuration = (seconds: number) => {
    const totalMinutes = Math.max(1, Math.round(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? t('maps.durationHours', { hours, minutes }) : t('maps.durationMinutes', { minutes });
  };

  // What the ruler button's tooltip says while the tool is on.
  const measureResult = () => {
    if (straightDistance === undefined) return t('maps.measureHint');

    const straight = formatDistance(straightDistance);
    if (!currentResult) return t('maps.routeLoading', { straight });
    if (currentResult.status === 'outside') return t('maps.routeOutside', { straight });
    if (currentResult.status === 'failed') return t('maps.routeFailed', { straight });

    return t('maps.routeSummary', {
      distance: formatDistance(currentResult.main.distance),
      duration: formatDuration(currentResult.main.duration),
      straight,
    });
  };

  // Picking a third marker starts a new measurement from it.
  const handleMeasurePick = (id: string) => {
    setMeasureIds((current) =>
      current.includes(id) ? current.filter((each) => each !== id) : [...current, id].slice(-2),
    );
  };

  const toggleMeasuring = () => {
    setMeasureIds([]);
    setIsMeasuring((current) => {
      if (!current) setIsAdding(false);
      return !current;
    });
  };

  // Picking a group pre-fills the marker colour from it, until the colour is
  // picked by hand — then the choice is left alone.
  const handleFormChange = (changed: Partial<MarkerForm>) => {
    if ('color' in changed) {
      colorPickedRef.current = true;
      return;
    }

    if ('groupId' in changed && !colorPickedRef.current) {
      const group = changed.groupId ? groupById.get(changed.groupId) : undefined;
      form.setFieldValue('color', group?.color ?? DEFAULT_COLOR);
    }
  };

  const handleSave = ({ title, groupId, color }: MarkerForm) => {
    if (!pendingPosition) return;

    setMarkers((current) => [
      ...current,
      { id: createId(), title: title.trim(), groupId, color, position: pendingPosition },
    ]);
    setPendingPosition(undefined);
    setIsAdding(false);
  };

  const handleChangeGroup = (id: string, groupId?: string) => {
    setMarkers((current) => current.map((marker) => (marker.id === id ? { ...marker, groupId } : marker)));
  };

  const handleDelete = (id: string) => {
    setMarkers((current) => current.filter((marker) => marker.id !== id));
  };

  return (
    <div className="h-full">
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
            <Tooltip title={t('maps.addMarkerHint')} open={isAdding && !pendingPosition} placement="bottom">
              <Button
                type={isAdding ? 'primary' : 'default'}
                icon={<MapPinPlus size={16} />}
                aria-label={t('maps.addMarker')}
                onClick={() => {
                  setIsMeasuring(false);
                  setMeasureIds([]);
                  setIsAdding((current) => !current);
                }}
                className="shadow-(--c-box-shadow-card)"
              />
            </Tooltip>
            <Tooltip title={measureResult()} open={isMeasuring} placement="bottom">
              <Button
                type={isMeasuring ? 'primary' : 'default'}
                icon={<Ruler size={16} />}
                aria-label={t('maps.measure')}
                onClick={toggleMeasuring}
                className="shadow-(--c-box-shadow-card)"
              />
            </Tooltip>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={filterGroup}
              onChange={(value?: string) => {
                setFilterGroup(value);
                // Clearing the filter brings the whole set back into view.
                if (!value) setFitToken((current) => current + 1);
              }}
              placeholder={t('maps.filterByGroup')}
              {...groupSelectProps}
              className="w-48 bg-light"
            />
          </div>
        </MapControl>
        <FitSavedMarkers markers={markers} token={fitToken} />
        <FlyToGroup groupId={filterGroup} markers={markers} />
        <AddMarkerOnClick active={isAdding} onPick={setPendingPosition} />
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
        {visibleMarkers.map(({ id, title, groupId, color, position }) => (
          <Marker
            key={id}
            position={position}
            icon={iconForMarker({ id, title, groupId, color, position }, groupById.get(groupId ?? ''), measureIds.includes(id))}
            eventHandlers={{ click: () => isMeasuring && handleMeasurePick(id) }}
          >
            {/* The name rides above the pin instead of hiding inside the popup. */}
            <MapTooltip permanent direction="top">
              {title}
            </MapTooltip>
            {!isMeasuring && (
            <Popup>
              <div className="font-semibold">{title}</div>
              <div className="text-subtle">{formatPosition(position)}</div>
              <div className="mt-(--c-spacing-xs)">
                <div className="mb-(--c-spacing-xxs)">{t('maps.group')}</div>
                <Select
                  allowClear
                  showSearch
                  size="small"
                  optionFilterProp="label"
                  value={groupId}
                  placeholder={t('maps.selectGroup')}
                  {...groupSelectProps}
                  onChange={(value?: string) => handleChangeGroup(id, value)}
                  className="w-full min-w-40"
                />
              </div>
              <Button
                danger
                size="small"
                type="text"
                variant='filled'
                icon={<Trash2 size={14} />}
                onClick={() => handleDelete(id)}
                className="mt-(--c-spacing-xxs) px-0!"
                block
              >
                {t('maps.deleteMarker')}
              </Button>
            </Popup>
            )}
          </Marker>
        ))}

        {straightDistance !== undefined && (
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
                {formatDistance(straightDistance)}
              </MapTooltip>
            )}
          </Polyline>
        )}

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
        title={t('maps.newMarker')}
        open={!!pendingPosition}
        okText={t('maps.save')}
        cancelText={t('maps.cancel')}
        onOk={() => form.submit()}
        onCancel={() => setPendingPosition(undefined)}
        afterClose={() => {
          form.resetFields();
          colorPickedRef.current = false;
        }}
      >
        {pendingPosition && <div className="mb-(--c-spacing-sm) text-subtle">{formatPosition(pendingPosition)}</div>}
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={{ color: DEFAULT_COLOR }}
          onValuesChange={handleFormChange}
        >
          <Form.Item
            name="title"
            label={t('maps.markerTitle')}
            rules={[{ required: true, whitespace: true, message: t('maps.markerTitleRequired') }]}
          >
            <Input autoFocus placeholder={t('maps.markerTitlePlaceholder')} />
          </Form.Item>
          <Form.Item name="color" label={t('maps.color')}>
            <ColorChoice />
          </Form.Item>
          <Form.Item name="groupId" label={t('maps.group')}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('maps.selectGroup')}
              {...groupSelectProps}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
