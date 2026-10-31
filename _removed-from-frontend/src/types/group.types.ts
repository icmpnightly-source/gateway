export interface Group {
  id: string;
  name: string;
  description?: string;
  /** Key from the group icon registry; falls back to the default icon when unset. */
  icon?: string;
  /** Hex color applied to the group icon. */
  color?: string;
  /** ISO date string; set when the group is created. */
  createdAt: string;
}

export type GroupPayload = Pick<Group, 'name' | 'description' | 'icon' | 'color'>;

export interface GroupsState {
  items: Group[];
}
