import {
  Anchor,
  Bike,
  Building2,
  Bus,
  Car,
  Caravan,
  Container,
  Cpu,
  Forklift,
  Fuel,
  HardHat,
  MapPin,
  Navigation,
  Package,
  Plane,
  Radio,
  Route,
  Satellite,
  SatelliteDish,
  Ship,
  Smartphone,
  Tablet,
  Tractor,
  Train,
  Truck,
  TruckElectric,
  Users,
  Warehouse,
  Watch,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** Icon keys are stored on the group, so keep them stable once released. */
export const GROUP_ICONS: Record<string, LucideIcon> = {
  users: Users,
  car: Car,
  truck: Truck,
  'truck-electric': TruckElectric,
  bus: Bus,
  bike: Bike,
  tractor: Tractor,
  forklift: Forklift,
  caravan: Caravan,
  train: Train,
  ship: Ship,
  plane: Plane,
  anchor: Anchor,
  'map-pin': MapPin,
  navigation: Navigation,
  route: Route,
  satellite: Satellite,
  'satellite-dish': SatelliteDish,
  radio: Radio,
  smartphone: Smartphone,
  tablet: Tablet,
  watch: Watch,
  cpu: Cpu,
  zap: Zap,
  fuel: Fuel,
  container: Container,
  package: Package,
  warehouse: Warehouse,
  building: Building2,
  'hard-hat': HardHat,
  wrench: Wrench,
};

export const GROUP_ICON_KEYS = Object.keys(GROUP_ICONS);

export const DEFAULT_GROUP_ICON = 'users';
export const DEFAULT_GROUP_COLOR = '#2563eb';

/** Preset swatches offered in the color picker. */
export const GROUP_COLORS = [
  '#2563eb',
  '#0ea5e9',
  '#06b6d4',
  '#10b981',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#6366f1',
  '#64748b',
];

export function getGroupIcon(icon?: string): LucideIcon {
  return GROUP_ICONS[icon ?? ''] ?? GROUP_ICONS[DEFAULT_GROUP_ICON];
}
