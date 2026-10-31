import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { fetchStatus } from '@/api/system';
import type { SystemState, SystemStatus } from '@/types/system.types';

// How things stand on this computer: its connection to the shared database
// and its gateway. Asked again every few seconds by the layout.

export const loadStatus = createAsyncThunk<SystemStatus>('system/loadStatus', () => fetchStatus());

const initialState: SystemState = { reachable: true };

const systemSlice = createSlice({
  name: 'system',
  initialState,
  reducers: {
    /** For whoever just changed the settings and was answered with the new status. */
    statusChanged(state, action: { payload: SystemStatus }) {
      state.status = action.payload;
      state.reachable = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadStatus.fulfilled, (state, action) => {
        state.status = action.payload;
        state.reachable = true;
      })
      .addCase(loadStatus.rejected, (state) => {
        state.reachable = false;
      });
  },
});

export const { statusChanged } = systemSlice.actions;
export default systemSlice.reducer;
