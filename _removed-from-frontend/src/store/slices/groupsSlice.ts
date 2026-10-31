import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import type { Group, GroupPayload, GroupsState } from '@/types/group.types';

const GROUPS_KEY = 'groups';

function loadPersistedState(): GroupsState {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (raw) {
      const items = JSON.parse(raw) as Group[];
      if (Array.isArray(items)) return { items };
    }
  } catch {
    localStorage.removeItem(GROUPS_KEY);
  }

  return { items: [] };
}

function persist(items: Group[]) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(items));
}

const initialState: GroupsState = loadPersistedState();

const groupsSlice = createSlice({
  name: 'groups',
  initialState,
  reducers: {
    addGroup: {
      reducer(state, action: PayloadAction<Group>) {
        state.items.push(action.payload);
        persist(state.items);
      },
      prepare(payload: GroupPayload) {
        return {
          payload: {
            id: nanoid(),
            name: payload.name.trim(),
            description: payload.description?.trim() || undefined,
            icon: payload.icon,
            color: payload.color,
            createdAt: new Date().toISOString(),
          },
        };
      },
    },
    updateGroup(state, action: PayloadAction<{ id: string } & GroupPayload>) {
      const group = state.items.find((item) => item.id === action.payload.id);
      if (!group) return;

      group.name = action.payload.name.trim();
      group.description = action.payload.description?.trim() || undefined;
      group.icon = action.payload.icon;
      group.color = action.payload.color;
      persist(state.items);
    },
    removeGroup(state, action: PayloadAction<string>) {
      state.items = state.items.filter((item) => item.id !== action.payload);
      persist(state.items);
    },
  },
});

export const { addGroup, updateGroup, removeGroup } = groupsSlice.actions;
export default groupsSlice.reducer;
